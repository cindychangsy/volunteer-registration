-- ============================================================================
-- 管理員密碼保護、志工管理權限欄位與操作稽核紀錄擴充腳本
-- 請將此段 SQL 貼至 Supabase Dashboard -> SQL Editor 並點擊 Run 執行
-- ============================================================================

-- 1. 為 registrations (志工報名表) 新增「權限角色 (role)」與「個人後台密碼 (admin_pin)」欄位
ALTER TABLE public.registrations
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'volunteer'
  CHECK (role IN ('volunteer', 'staff_admin', 'super_admin'));

ALTER TABLE public.registrations
  ADD COLUMN IF NOT EXISTS admin_pin TEXT DEFAULT '';

-- 2. 建立管理員系統設定表 (儲存系統總管理員密碼)
CREATE TABLE IF NOT EXISTS public.admin_settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  admin_password TEXT NOT NULL DEFAULT 'admin8888',
  updated_by TEXT DEFAULT 'system',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.admin_settings (id, admin_password, updated_by)
VALUES (1, 'admin8888', 'system')
ON CONFLICT (id) DO NOTHING;

-- 3. 建立管理員操作稽核紀錄表 (admin_audit_logs)
CREATE TABLE IF NOT EXISTS public.admin_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_name TEXT NOT NULL,           -- 操作的管理員姓名/帳號與角色
  action_type TEXT NOT NULL,          -- 動作類型 (如 LOGIN, UPDATE_EVENT, CHECK_IN, CHANGE_ROLE 等)
  action_label TEXT NOT NULL,         -- 動作中文名稱
  target_name TEXT DEFAULT '',        -- 操作對象 (如活動名稱或志工姓名)
  details TEXT DEFAULT '',            -- 詳細變更紀錄
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_created_at
  ON public.admin_audit_logs(created_at DESC);

-- 4. 設定 RLS 權限，允許後台讀取與寫入操作紀錄、權限欄位及管理活動
ALTER TABLE public.admin_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow admin settings access" ON public.admin_settings;
CREATE POLICY "Allow admin settings access"
  ON public.admin_settings FOR ALL
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Allow admin audit logs access" ON public.admin_audit_logs;
CREATE POLICY "Allow admin audit logs access"
  ON public.admin_audit_logs FOR ALL
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Public can view published events" ON public.events;
CREATE POLICY "Public can view published events"
  ON public.events FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Admins can manage events" ON public.events;
CREATE POLICY "Admins can manage events"
  ON public.events FOR ALL
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Admins can manage event shifts" ON public.event_shifts;
CREATE POLICY "Admins can manage event shifts"
  ON public.event_shifts FOR ALL
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Admins can manage all registrations" ON public.registrations;
CREATE POLICY "Admins can manage all registrations"
  ON public.registrations FOR ALL
  USING (true)
  WITH CHECK (true);
