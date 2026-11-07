-- ============================================================================
-- 志工報名系統 (Volunteer Registration System) - Supabase PostgreSQL Schema
-- 包含：資料表、自動計數 Trigger、RLS 安全政策、防超額與自動候補遞補 RPC 函數、範例資料
-- 請複製本檔案全部內容，貼上至 Supabase Dashboard -> SQL Editor 並點擊 Run 執行
-- ============================================================================

-- 啟用 UUID 擴充套件
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- 1. 建立資料表 (Tables)
-- ============================================================================

-- 1.1 志工活動主表 (events)
CREATE TABLE IF NOT EXISTS public.events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  location TEXT NOT NULL,
  event_date DATE NOT NULL,
  registration_deadline TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'draft')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 1.2 活動時段與組別表 (event_shifts) - 支援單一活動多時段/多組別
CREATE TABLE IF NOT EXISTS public.event_shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  group_name TEXT NOT NULL,           -- 例：「早班 - 報到組」、「午班 - 引導組」
  start_time TIME NOT NULL,           -- 例：08:30
  end_time TIME NOT NULL,             -- 例：12:30
  quota INTEGER NOT NULL DEFAULT 10 CHECK (quota >= 0),
  waitlist_quota INTEGER NOT NULL DEFAULT 5 CHECK (waitlist_quota >= 0),
  confirmed_count INTEGER NOT NULL DEFAULT 0 CHECK (confirmed_count >= 0),
  waitlist_count INTEGER NOT NULL DEFAULT 0 CHECK (waitlist_count >= 0),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 1.3 志工報名紀錄表 (registrations)
CREATE TABLE IF NOT EXISTS public.registrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  shift_id UUID NOT NULL REFERENCES public.event_shifts(id) ON DELETE CASCADE,
  volunteer_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL,
  id_number TEXT NOT NULL,            -- 身分證字號/居留證號 (辦理志工保險用)
  birth_date DATE NOT NULL,           -- 出生年月日 (辦理志工保險用)
  dietary TEXT NOT NULL DEFAULT 'meat' CHECK (dietary IN ('meat', 'vegetarian', 'none')),
  emergency_contact TEXT NOT NULL,    -- 緊急聯絡人姓名與關係
  emergency_phone TEXT NOT NULL,      -- 緊急聯絡人電話
  note TEXT DEFAULT '',               -- 備註或特殊專長
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'waitlist', 'cancelled')),
  checked_in BOOLEAN NOT NULL DEFAULT false,
  checked_in_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 建立索引加速查詢
CREATE INDEX IF NOT EXISTS idx_event_shifts_event_id ON public.event_shifts(event_id);
CREATE INDEX IF NOT EXISTS idx_registrations_event_id ON public.registrations(event_id);
CREATE INDEX IF NOT EXISTS idx_registrations_shift_id ON public.registrations(shift_id);
CREATE INDEX IF NOT EXISTS idx_registrations_phone_email ON public.registrations(phone, email);

-- ============================================================================
-- 2. 自動同步組別人數統計 Trigger
-- ============================================================================

CREATE OR REPLACE FUNCTION public.sync_shift_counts()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_shift_id UUID;
BEGIN
  v_shift_id := COALESCE(NEW.shift_id, OLD.shift_id);

  UPDATE public.event_shifts
  SET
    confirmed_count = (
      SELECT COUNT(*) FROM public.registrations
      WHERE shift_id = v_shift_id AND status = 'confirmed'
    ),
    waitlist_count = (
      SELECT COUNT(*) FROM public.registrations
      WHERE shift_id = v_shift_id AND status = 'waitlist'
    )
  WHERE id = v_shift_id;

  IF TG_OP = 'UPDATE' AND OLD.shift_id IS DISTINCT FROM NEW.shift_id THEN
    UPDATE public.event_shifts
    SET
      confirmed_count = (
        SELECT COUNT(*) FROM public.registrations
        WHERE shift_id = OLD.shift_id AND status = 'confirmed'
      ),
      waitlist_count = (
        SELECT COUNT(*) FROM public.registrations
        WHERE shift_id = OLD.shift_id AND status = 'waitlist'
      )
    WHERE id = OLD.shift_id;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_shift_counts ON public.registrations;
CREATE TRIGGER trg_sync_shift_counts
AFTER INSERT OR UPDATE OR DELETE ON public.registrations
FOR EACH ROW
EXECUTE FUNCTION public.sync_shift_counts();

-- ============================================================================
-- 3. Row Level Security (RLS) 權限控管政策
-- ============================================================================

ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.registrations ENABLE ROW LEVEL SECURITY;

-- events 政策：所有人可讀取公開活動，已驗證管理員 (authenticated) 可完整管理
DROP POLICY IF EXISTS "Public can view published events" ON public.events;
CREATE POLICY "Public can view published events"
  ON public.events FOR SELECT
  USING (status IN ('open', 'closed') OR auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Admins can manage events" ON public.events;
CREATE POLICY "Admins can manage events"
  ON public.events FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- event_shifts 政策：所有人可讀取各組別時段與名額，管理員可完整管理
DROP POLICY IF EXISTS "Public can view event shifts" ON public.event_shifts;
CREATE POLICY "Public can view event shifts"
  ON public.event_shifts FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Admins can manage event shifts" ON public.event_shifts;
CREATE POLICY "Admins can manage event shifts"
  ON public.event_shifts FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- registrations 政策：為保護志工身分證與保險個資，僅管理員可直接讀寫資料表；一般志工透過下方安全 RPC 函數報名與查詢
DROP POLICY IF EXISTS "Admins can manage all registrations" ON public.registrations;
CREATE POLICY "Admins can manage all registrations"
  ON public.registrations FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- 4. 核心商業邏輯 RPC 函數 (SECURITY DEFINER)
-- ============================================================================

-- 4.1 志工線上報名 RPC (含併發鎖定、防重複報名、額滿自動轉候補)
CREATE OR REPLACE FUNCTION public.submit_registration(
  p_event_id UUID,
  p_shift_id UUID,
  p_volunteer_name TEXT,
  p_phone TEXT,
  p_email TEXT,
  p_id_number TEXT,
  p_birth_date DATE,
  p_dietary TEXT,
  p_emergency_contact TEXT,
  p_emergency_phone TEXT,
  p_note TEXT DEFAULT ''
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event RECORD;
  v_shift RECORD;
  v_clean_phone TEXT;
  v_clean_email TEXT;
  v_existing_id UUID;
  v_new_status TEXT;
  v_new_reg_id UUID;
  v_waitlist_pos INTEGER := 0;
BEGIN
  v_clean_phone := regexp_replace(trim(p_phone), '\D', '', 'g');
  v_clean_email := lower(trim(p_email));

  -- 1. 檢查活動狀態與截止時間
  SELECT * INTO v_event FROM public.events WHERE id = p_event_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '找不到該活動資訊';
  END IF;

  IF v_event.status <> 'open' THEN
    RAISE EXCEPTION '此活動目前未開放報名';
  END IF;

  IF v_event.registration_deadline IS NOT NULL AND now() > v_event.registration_deadline THEN
    RAISE EXCEPTION '此活動報名已截止';
  END IF;

  -- 2. 鎖定該時段組別 (防止多人同時搶報超額)
  SELECT * INTO v_shift
  FROM public.event_shifts
  WHERE id = p_shift_id AND event_id = p_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '找不到指定的活動時段或組別';
  END IF;

  -- 3. 檢查同一時段組別是否已重複報名 (以手機號碼或身分證字號比對)
  SELECT id INTO v_existing_id
  FROM public.registrations
  WHERE shift_id = p_shift_id
    AND status IN ('confirmed', 'waitlist')
    AND (
      regexp_replace(phone, '\D', '', 'g') = v_clean_phone
      OR upper(trim(id_number)) = upper(trim(p_id_number))
    )
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    RAISE EXCEPTION '您已經報名過本時段組別，請勿重複報名（可至「報名查詢」確認狀態）';
  END IF;

  -- 4. 判斷正取或自動轉候補
  IF v_shift.confirmed_count < v_shift.quota THEN
    v_new_status := 'confirmed';
  ELSIF v_shift.waitlist_count < v_shift.waitlist_quota THEN
    v_new_status := 'waitlist';
    v_waitlist_pos := v_shift.waitlist_count + 1;
  ELSE
    RAISE EXCEPTION '抱歉，本組別正取與候補名額皆已額滿！';
  END IF;

  -- 5. 寫入報名紀錄 (Trigger 會自動同步更新 event_shifts 人數)
  INSERT INTO public.registrations (
    event_id,
    shift_id,
    volunteer_name,
    phone,
    email,
    id_number,
    birth_date,
    dietary,
    emergency_contact,
    emergency_phone,
    note,
    status
  ) VALUES (
    p_event_id,
    p_shift_id,
    trim(p_volunteer_name),
    trim(p_phone),
    v_clean_email,
    upper(trim(p_id_number)),
    p_birth_date,
    p_dietary,
    trim(p_emergency_contact),
    trim(p_emergency_phone),
    COALESCE(trim(p_note), ''),
    v_new_status
  )
  RETURNING id INTO v_new_reg_id;

  RETURN jsonb_build_object(
    'registration_id', v_new_reg_id,
    'status', v_new_status,
    'waitlist_position', v_waitlist_pos,
    'event_title', v_event.title,
    'group_name', v_shift.group_name
  );
END;
$$;

-- 4.2 志工免登入查詢個人報名紀錄 RPC (需同時驗證手機號碼 + Email，並自動遮罩身分證字號)
CREATE OR REPLACE FUNCTION public.lookup_volunteer_registrations(
  p_phone TEXT,
  p_email TEXT
)
RETURNS TABLE (
  registration_id UUID,
  event_id UUID,
  event_title TEXT,
  event_date DATE,
  event_location TEXT,
  shift_id UUID,
  group_name TEXT,
  start_time TIME,
  end_time TIME,
  volunteer_name TEXT,
  phone TEXT,
  email TEXT,
  masked_id_number TEXT,
  dietary TEXT,
  emergency_contact TEXT,
  status TEXT,
  checked_in BOOLEAN,
  checked_in_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clean_phone TEXT;
  v_clean_email TEXT;
BEGIN
  v_clean_phone := regexp_replace(trim(p_phone), '\D', '', 'g');
  v_clean_email := lower(trim(p_email));

  IF length(v_clean_phone) < 8 OR v_clean_email = '' THEN
    RAISE EXCEPTION '請輸入有效的手機號碼與電子信箱';
  END IF;

  RETURN QUERY
  SELECT
    r.id AS registration_id,
    e.id AS event_id,
    e.title AS event_title,
    e.event_date,
    e.location AS event_location,
    s.id AS shift_id,
    s.group_name,
    s.start_time,
    s.end_time,
    r.volunteer_name,
    r.phone,
    r.email,
    CASE
      WHEN length(r.id_number) >= 7 THEN
        substr(r.id_number, 1, 3) || '****' || substr(r.id_number, length(r.id_number) - 2, 3)
      ELSE '****'
    END AS masked_id_number,
    r.dietary,
    r.emergency_contact,
    r.status,
    r.checked_in,
    r.checked_in_at,
    r.created_at
  FROM public.registrations r
  JOIN public.events e ON e.id = r.event_id
  JOIN public.event_shifts s ON s.id = r.shift_id
  WHERE regexp_replace(r.phone, '\D', '', 'g') = v_clean_phone
    AND lower(trim(r.email)) = v_clean_email
  ORDER BY e.event_date DESC, r.created_at DESC;
END;
$$;

-- 4.3 志工取消報名 RPC (含正取取消時，自動將第一順位候補遞補為正取)
CREATE OR REPLACE FUNCTION public.cancel_volunteer_registration(
  p_registration_id UUID,
  p_phone TEXT,
  p_email TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reg RECORD;
  v_clean_phone TEXT;
  v_clean_email TEXT;
  v_promoted_id UUID;
BEGIN
  v_clean_phone := regexp_replace(trim(p_phone), '\D', '', 'g');
  v_clean_email := lower(trim(p_email));

  SELECT * INTO v_reg
  FROM public.registrations
  WHERE id = p_registration_id
    AND regexp_replace(phone, '\D', '', 'g') = v_clean_phone
    AND lower(trim(email)) = v_clean_email
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '找不到符合條件的報名紀錄，或驗證資訊不正確';
  END IF;

  IF v_reg.status = 'cancelled' THEN
    RAISE EXCEPTION '此筆報名已經是取消狀態';
  END IF;

  IF v_reg.checked_in THEN
    RAISE EXCEPTION '已完成現場簽到的報名紀錄無法取消';
  END IF;

  -- 更新為已取消
  UPDATE public.registrations
  SET status = 'cancelled'
  WHERE id = p_registration_id;

  -- 若原本為正取 (confirmed)，檢查同組別是否有候補 (waitlist) 可自動遞補
  IF v_reg.status = 'confirmed' THEN
    SELECT id INTO v_promoted_id
    FROM public.registrations
    WHERE shift_id = v_reg.shift_id
      AND status = 'waitlist'
    ORDER BY created_at ASC
    LIMIT 1
    FOR UPDATE;

    IF v_promoted_id IS NOT NULL THEN
      UPDATE public.registrations
      SET status = 'confirmed'
      WHERE id = v_promoted_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'cancelled_id', p_registration_id,
    'promoted_waitlist_id', v_promoted_id
  );
END;
$$;

-- 開放匿名與已登入使用者呼叫上述 3 個 RPC 函數
GRANT EXECUTE ON FUNCTION public.submit_registration TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lookup_volunteer_registrations TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_volunteer_registration TO anon, authenticated;

-- ============================================================================
-- 5. 預設範例活動與多組別時段資料 (若資料庫尚無活動則自動建立)
-- ============================================================================

DO $$
DECLARE
  v_event1_id UUID;
  v_event2_id UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.events LIMIT 1) THEN
    -- 範例活動 1
    INSERT INTO public.events (title, description, location, event_date, registration_deadline, status)
    VALUES (
      '2026 海岸守護・秋季大型淨灘志工招募',
      '邀請熱愛環境的志工夥伴一同參與海岸清潔與海洋廢棄物分類統計（ICC 國際淨灘行動紀錄）。現場提供手套、夾子、飲水補充與午餐便當，並為全體志工投保公共意外與志工平安保險。',
      '新北市石門區白沙灣海水浴場（第一停車場集合）',
      (CURRENT_DATE + INTERVAL '14 days')::DATE,
      (CURRENT_DATE + INTERVAL '10 days')::TIMESTAMPTZ,
      'open'
    )
    RETURNING id INTO v_event1_id;

    INSERT INTO public.event_shifts (event_id, group_name, start_time, end_time, quota, waitlist_quota, sort_order)
    VALUES
      (v_event1_id, '早班 - 報到與物資引導組', '08:00', '12:00', 5, 3, 1),
      (v_event1_id, '早班 - 海岸清潔行動組', '08:30', '12:30', 20, 5, 2),
      (v_event1_id, '午班 - 海廢分類統計與環保回收組', '13:00', '16:30', 10, 3, 3);

    -- 範例活動 2
    INSERT INTO public.events (title, description, location, event_date, registration_deadline, status)
    VALUES (
      '社區長者關懷暨愛心共餐伴讀服務',
      '陪伴社區長者進行健康促進手作課程、智慧手機教學，以及中午愛心共餐備餐與送餐服務。歡迎具耐心與熱忱的志工報名參加！',
      '台北市大安區社區活動中心 2 樓禮堂',
      (CURRENT_DATE + INTERVAL '21 days')::DATE,
      (CURRENT_DATE + INTERVAL '18 days')::TIMESTAMPTZ,
      'open'
    )
    RETURNING id INTO v_event2_id;

    INSERT INTO public.event_shifts (event_id, group_name, start_time, end_time, quota, waitlist_quota, sort_order)
    VALUES
      (v_event2_id, '早班 - 報到接待與樂齡手作陪伴組', '09:00', '12:00', 8, 3, 1),
      (v_event2_id, '午班 - 愛心共餐打菜與關懷送餐組', '11:30', '14:30', 6, 2, 2);
  END IF;
END;
$$;
