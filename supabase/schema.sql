-- ============================================================================
-- 志工報名系統 (Volunteer Registration System) - Supabase PostgreSQL Schema
-- 包含：資料表、自動計數 Trigger、志工權限欄位 (role)、管理員密碼設定與稽核紀錄表、RPC 函數
-- 請複製本檔案全部內容，貼上至 Supabase Dashboard -> SQL Editor 並點擊 Run 執行
-- ============================================================================

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

-- 1.2 活動時段與組別表 (event_shifts)
CREATE TABLE IF NOT EXISTS public.event_shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  group_name TEXT NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  quota INTEGER NOT NULL DEFAULT 10 CHECK (quota >= 0),
  waitlist_quota INTEGER NOT NULL DEFAULT 5 CHECK (waitlist_quota >= 0),
  confirmed_count INTEGER NOT NULL DEFAULT 0 CHECK (confirmed_count >= 0),
  waitlist_count INTEGER NOT NULL DEFAULT 0 CHECK (waitlist_count >= 0),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 1.3 志工報名紀錄表 (registrations) - 含志工後台管理權限欄位 (role) 與密碼 (admin_pin)
CREATE TABLE IF NOT EXISTS public.registrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  shift_id UUID NOT NULL REFERENCES public.event_shifts(id) ON DELETE CASCADE,
  volunteer_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL,
  id_number TEXT NOT NULL,
  birth_date DATE NOT NULL,
  dietary TEXT NOT NULL DEFAULT 'meat' CHECK (dietary IN ('meat', 'vegetarian', 'none')),
  emergency_contact TEXT NOT NULL,
  emergency_phone TEXT NOT NULL,
  note TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'waitlist', 'cancelled')),
  checked_in BOOLEAN NOT NULL DEFAULT false,
  checked_in_at TIMESTAMPTZ,
  role TEXT NOT NULL DEFAULT 'volunteer' CHECK (role IN ('volunteer', 'staff_admin', 'super_admin')),
  admin_pin TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 若 registrations 表已存在，補齊 role 與 admin_pin 欄位
ALTER TABLE public.registrations
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'volunteer'
  CHECK (role IN ('volunteer', 'staff_admin', 'super_admin'));

ALTER TABLE public.registrations
  ADD COLUMN IF NOT EXISTS admin_pin TEXT DEFAULT '';

-- 1.4 管理員系統密碼設定表 (admin_settings)
CREATE TABLE IF NOT EXISTS public.admin_settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  admin_password TEXT NOT NULL DEFAULT 'admin8888',
  updated_by TEXT DEFAULT 'system',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.admin_settings (id, admin_password, updated_by)
VALUES (1, 'admin8888', 'system')
ON CONFLICT (id) DO NOTHING;

-- 1.5 管理員與志工幹部操作稽核紀錄表 (admin_audit_logs)
CREATE TABLE IF NOT EXISTS public.admin_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_name TEXT NOT NULL,
  action_type TEXT NOT NULL,
  action_label TEXT NOT NULL,
  target_name TEXT DEFAULT '',
  details TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_shifts_event_id ON public.event_shifts(event_id);
CREATE INDEX IF NOT EXISTS idx_registrations_event_id ON public.registrations(event_id);
CREATE INDEX IF NOT EXISTS idx_registrations_shift_id ON public.registrations(shift_id);
CREATE INDEX IF NOT EXISTS idx_registrations_phone_email ON public.registrations(phone, email);
CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_created_at ON public.admin_audit_logs(created_at DESC);

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
ALTER TABLE public.admin_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can view published events" ON public.events;
CREATE POLICY "Public can view published events" ON public.events FOR SELECT USING (true);

DROP POLICY IF EXISTS "Admins can manage events" ON public.events;
CREATE POLICY "Admins can manage events" ON public.events FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Public can view event shifts" ON public.event_shifts;
CREATE POLICY "Public can view event shifts" ON public.event_shifts FOR SELECT USING (true);

DROP POLICY IF EXISTS "Admins can manage event shifts" ON public.event_shifts;
CREATE POLICY "Admins can manage event shifts" ON public.event_shifts FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Admins can manage all registrations" ON public.registrations;
CREATE POLICY "Admins can manage all registrations" ON public.registrations FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow admin settings access" ON public.admin_settings;
CREATE POLICY "Allow admin settings access" ON public.admin_settings FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow admin audit logs access" ON public.admin_audit_logs;
CREATE POLICY "Allow admin audit logs access" ON public.admin_audit_logs FOR ALL USING (true) WITH CHECK (true);

-- ============================================================================
-- 4. 核心商業邏輯 RPC 函數 (SECURITY DEFINER)
-- ============================================================================

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

  SELECT * INTO v_shift
  FROM public.event_shifts
  WHERE id = p_shift_id AND event_id = p_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '找不到指定的活動時段或組別';
  END IF;

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

  IF v_shift.confirmed_count < v_shift.quota THEN
    v_new_status := 'confirmed';
  ELSIF v_shift.waitlist_count < v_shift.waitlist_quota THEN
    v_new_status := 'waitlist';
    v_waitlist_pos := v_shift.waitlist_count + 1;
  ELSE
    RAISE EXCEPTION '抱歉，本組別正取與候補名額皆已額滿！';
  END IF;

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

  UPDATE public.registrations
  SET status = 'cancelled'
  WHERE id = p_registration_id;

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

GRANT EXECUTE ON FUNCTION public.submit_registration TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lookup_volunteer_registrations TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_volunteer_registration TO anon, authenticated;
