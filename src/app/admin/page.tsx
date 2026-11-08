'use client';

import { useEffect, useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Plus,
  Trash2,
  Pencil,
  Calendar,
  MapPin,
  LogOut,
  ClipboardList,
  Clock,
  CheckCircle2,
  AlertCircle,
  KeyRound,
  History,
  Download,
  Search,
  RefreshCw,
  Shield,
  Users,
  Copy,
  ExternalLink,
  AlertTriangle,
} from 'lucide-react';
import {
  supabase,
  formatTimeRange,
  getEventStatusMeta,
  getVolunteerRoleMeta,
} from '@/lib/supabase';
import {
  getAdminSession,
  clearAdminSession,
  recordAdminAction,
  fetchAdminAuditLogs,
  updateAdminPassword,
  getActionBadgeClass,
  getEffectiveRegistrationRole,
  updateVolunteerRole,
  type AdminAuditLog,
} from '@/lib/audit';
import type {
  VolunteerEvent,
  EventShift,
  EventStatus,
  Registration,
  VolunteerRole,
} from '@/types/database';

const UPGRADE_SQL = `-- 請貼上至 Supabase SQL Editor 並點擊 Run 執行
ALTER TABLE public.registrations
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'volunteer'
  CHECK (role IN ('volunteer', 'staff_admin', 'super_admin'));

ALTER TABLE public.registrations
  ADD COLUMN IF NOT EXISTS admin_pin TEXT DEFAULT '';

CREATE TABLE IF NOT EXISTS public.admin_settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  admin_password TEXT NOT NULL DEFAULT 'admin8888',
  updated_by TEXT DEFAULT 'system',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.admin_settings (id, admin_password, updated_by)
VALUES (1, 'admin8888', 'system')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.admin_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_name TEXT NOT NULL,
  action_type TEXT NOT NULL,
  action_label TEXT NOT NULL,
  target_name TEXT DEFAULT '',
  details TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.admin_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow admin settings access" ON public.admin_settings;
CREATE POLICY "Allow admin settings access" ON public.admin_settings FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow admin audit logs access" ON public.admin_audit_logs;
CREATE POLICY "Allow admin audit logs access" ON public.admin_audit_logs FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Public can view published events" ON public.events;
CREATE POLICY "Public can view published events" ON public.events FOR SELECT USING (true);

DROP POLICY IF EXISTS "Admins can manage events" ON public.events;
CREATE POLICY "Admins can manage events" ON public.events FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Admins can manage event shifts" ON public.event_shifts;
CREATE POLICY "Admins can manage event shifts" ON public.event_shifts FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Admins can manage all registrations" ON public.registrations;
CREATE POLICY "Admins can manage all registrations" ON public.registrations FOR ALL USING (true) WITH CHECK (true);`;

interface ShiftInput {
  id?: string;
  group_name: string;
  start_time: string;
  end_time: string;
  quota: number;
  waitlist_quota: number;
}

export default function AdminDashboardPage() {
  const router = useRouter();
  const [adminName, setAdminName] = useState<string>('');
  const [adminRole, setAdminRole] = useState<VolunteerRole>('super_admin');
  const [activeTab, setActiveTab] = useState<
    'events' | 'permissions' | 'audit'
  >('events');

  const [events, setEvents] = useState<VolunteerEvent[]>([]);
  const [allRegistrations, setAllRegistrations] = useState<Registration[]>([]);
  const [auditLogs, setAuditLogs] = useState<AdminAuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [needsSqlUpgrade, setNeedsSqlUpgrade] = useState(false);
  const [copiedSql, setCopiedSql] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // 修改密碼狀態
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // 權限管理分頁搜尋與篩選
  const [permSearch, setPermSearch] = useState('');
  const [permRoleFilter, setPermRoleFilter] = useState<'all' | VolunteerRole>(
    'all'
  );
  const [customPinInputs, setCustomPinInputs] = useState<
    Record<string, string>
  >({});

  // 稽核紀錄篩選
  const [logSearch, setLogSearch] = useState('');
  const [logActionFilter, setLogActionFilter] = useState('all');

  // 活動表單狀態 (共用新增與編輯)
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [deadline, setDeadline] = useState('');
  const [status, setStatus] = useState<EventStatus>('open');
  const [shiftInputs, setShiftInputs] = useState<ShiftInput[]>([
    {
      group_name: '早班 - 報到引導組',
      start_time: '08:30',
      end_time: '12:00',
      quota: 10,
      waitlist_quota: 5,
    },
    {
      group_name: '午班 - 活動服務組',
      start_time: '13:00',
      end_time: '16:30',
      quota: 10,
      waitlist_quota: 5,
    },
  ]);

  useEffect(() => {
    const session = getAdminSession();
    if (!session) {
      router.replace('/admin/login');
      return;
    }
    setAdminName(session.adminName);
    setAdminRole(session.role || 'super_admin');
    loadAllData();
  }, [router]);

  async function loadAllData() {
    setLoading(true);
    await Promise.all([
      checkDatabaseUpgradeStatus(),
      fetchAllEvents(),
      fetchAllVolunteers(),
      loadAuditLogs(),
    ]);
    setLoading(false);
  }

  async function checkDatabaseUpgradeStatus() {
    const { error } = await supabase
      .from('admin_audit_logs')
      .select('id')
      .limit(1);
    setNeedsSqlUpgrade(Boolean(error));
  }

  async function handleCopyUpgradeSql() {
    await navigator.clipboard.writeText(UPGRADE_SQL);
    setCopiedSql(true);
    setTimeout(() => setCopiedSql(false), 3000);
  }

  async function loadAuditLogs() {
    const logs = await fetchAdminAuditLogs();
    setAuditLogs(logs);
  }

  async function fetchAllVolunteers() {
    const { data, error } = await supabase
      .from('registrations')
      .select(
        '*, events (title, event_date), event_shifts (group_name, start_time, end_time)'
      )
      .order('created_at', { ascending: false });

    if (!error && data) {
      setAllRegistrations(data as Registration[]);
    }
  }

  async function fetchAllEvents() {
    setErrorMsg('');

    const { data, error } = await supabase
      .from('events')
      .select(
        `
        *,
        event_shifts (*)
      `
      )
      .order('event_date', { ascending: false });

    if (error) {
      setErrorMsg(error.message || '載入活動資料失敗');
      return;
    }

    const sorted = ((data as VolunteerEvent[]) || []).map((ev) => ({
      ...ev,
      event_shifts: (ev.event_shifts || []).sort(
        (a: EventShift, b: EventShift) => a.sort_order - b.sort_order
      ),
    }));

    setEvents(sorted);
  }

  async function handleLogout() {
    await recordAdminAction({
      adminName: adminName || '管理員',
      actionType: 'LOGOUT',
      actionLabel: '登出管理後台',
      targetName: '管理後台系統',
      details: `管理員「${adminName}」主動登出並鎖定後台`,
    });
    clearAdminSession();
    await supabase.auth.signOut();
    router.replace('/admin/login');
  }

  async function handleChangePassword(e: FormEvent) {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');

    if (newPassword !== confirmPassword) {
      setErrorMsg('兩次輸入的新密碼不一致，請重新確認');
      return;
    }

    const res = await updateAdminPassword(adminName, oldPassword, newPassword);
    if (!res.success) {
      setErrorMsg(res.error || '修改密碼失敗');
      return;
    }

    setOldPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setShowPasswordModal(false);
    setSuccessMsg('管理員通行密碼已成功更新！下次登入請使用新密碼。');
    await loadAuditLogs();
  }

  async function handleVolunteerRoleChange(
    reg: Registration,
    newRole: VolunteerRole
  ) {
    setErrorMsg('');
    setSuccessMsg('');

    const customPin = customPinInputs[reg.id];
    await updateVolunteerRole({
      operatorName: adminName || '管理員',
      reg,
      newRole,
      newPin: customPin,
    });

    const roleMeta = getVolunteerRoleMeta(newRole);
    const { adminPin } = getEffectiveRegistrationRole(reg);
    setSuccessMsg(
      newRole === 'volunteer'
        ? `已將志工「${reg.volunteer_name}」的權限設為「一般志工」（無後台進入權限）。`
        : `已將志工「${reg.volunteer_name}」授權為「${roleMeta.shortLabel}」！該志工可憑姓名「${reg.volunteer_name}」（或手機 ${reg.phone}）與密碼「${adminPin}」登入管理後台。`
    );

    setAllRegistrations((prev) => [...prev]);
    await loadAuditLogs();
  }

  async function handleSaveVolunteerPin(reg: Registration) {
    const pinVal = (customPinInputs[reg.id] || '').trim();
    if (pinVal.length < 4) {
      setErrorMsg('志工專屬管理密碼至少需 4 個字元');
      return;
    }

    const { role } = getEffectiveRegistrationRole(reg);
    await updateVolunteerRole({
      operatorName: adminName || '管理員',
      reg,
      newRole: role === 'volunteer' ? 'staff_admin' : role,
      newPin: pinVal,
    });

    setSuccessMsg(
      `已更新志工「${reg.volunteer_name}」的後台登入密碼為「${pinVal}」！`
    );
    setAllRegistrations((prev) => [...prev]);
    await loadAuditLogs();
  }

  function openCreateMode() {
    setEditingEventId(null);
    setTitle('');
    setDescription('');
    setLocation('');
    setEventDate('');
    setDeadline('');
    setStatus('open');
    setShiftInputs([
      {
        group_name: '早班 - 報到引導組',
        start_time: '08:30',
        end_time: '12:00',
        quota: 10,
        waitlist_quota: 5,
      },
      {
        group_name: '午班 - 活動服務組',
        start_time: '13:00',
        end_time: '16:30',
        quota: 10,
        waitlist_quota: 5,
      },
    ]);
    setActiveTab('events');
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function openEditMode(ev: VolunteerEvent) {
    setEditingEventId(ev.id);
    setTitle(ev.title);
    setDescription(ev.description || '');
    setLocation(ev.location);
    setEventDate(ev.event_date);
    if (ev.registration_deadline) {
      const dt = new Date(ev.registration_deadline);
      const localIso = new Date(dt.getTime() - dt.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16);
      setDeadline(localIso);
    } else {
      setDeadline('');
    }
    setStatus(ev.status);

    const existingShifts = (ev.event_shifts || []).map((s) => ({
      id: s.id,
      group_name: s.group_name,
      start_time: s.start_time ? s.start_time.slice(0, 5) : '09:00',
      end_time: s.end_time ? s.end_time.slice(0, 5) : '12:00',
      quota: s.quota,
      waitlist_quota: s.waitlist_quota,
    }));

    setShiftInputs(
      existingShifts.length > 0
        ? existingShifts
        : [
            {
              group_name: '預設組別',
              start_time: '09:00',
              end_time: '12:00',
              quota: 10,
              waitlist_quota: 3,
            },
          ]
    );
    setActiveTab('events');
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function addShiftRow() {
    setShiftInputs((prev) => [
      ...prev,
      {
        group_name: '',
        start_time: '09:00',
        end_time: '12:00',
        quota: 10,
        waitlist_quota: 3,
      },
    ]);
  }

  function removeShiftRow(index: number) {
    if (shiftInputs.length <= 1) return;
    setShiftInputs((prev) => prev.filter((_, i) => i !== index));
  }

  function updateShiftRow(
    index: number,
    field: keyof ShiftInput,
    value: string | number
  ) {
    setShiftInputs((prev) =>
      prev.map((row, i) => (i === index ? { ...row, [field]: value } : row))
    );
  }

  async function handleSaveEvent(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setErrorMsg('');
    setSuccessMsg('');

    const shiftSummary = shiftInputs
      .map((s) => `${s.group_name}(正取${s.quota}/候補${s.waitlist_quota})`)
      .join('、');

    if (!editingEventId) {
      const { data: createdEvent, error: evError } = await supabase
        .from('events')
        .insert([
          {
            title: title.trim(),
            description: description.trim(),
            location: location.trim(),
            event_date: eventDate,
            registration_deadline: deadline
              ? new Date(deadline).toISOString()
              : null,
            status,
          },
        ])
        .select()
        .single();

      if (evError || !createdEvent) {
        setSubmitting(false);
        setErrorMsg(evError?.message || '建立活動失敗');
        return;
      }

      const shiftsPayload = shiftInputs.map((s, idx) => ({
        event_id: createdEvent.id,
        group_name: s.group_name.trim(),
        start_time: s.start_time,
        end_time: s.end_time,
        quota: Number(s.quota),
        waitlist_quota: Number(s.waitlist_quota),
        sort_order: idx + 1,
      }));

      const { error: shiftError } = await supabase
        .from('event_shifts')
        .insert(shiftsPayload);

      setSubmitting(false);

      if (shiftError) {
        setErrorMsg(`活動已建立，但建立組別失敗：${shiftError.message}`);
        return;
      }

      await recordAdminAction({
        adminName,
        actionType: 'CREATE_EVENT',
        actionLabel: '新增招募活動',
        targetName: createdEvent.title,
        details: `日期：${eventDate}｜地點：${location.trim()}｜組別：${shiftSummary}`,
      });

      setSuccessMsg(
        `已成功建立活動「${createdEvent.title}」與 ${shiftsPayload.length} 個時段組別！（已記錄至操作日誌）`
      );
    } else {
      const { error: evError } = await supabase
        .from('events')
        .update({
          title: title.trim(),
          description: description.trim(),
          location: location.trim(),
          event_date: eventDate,
          registration_deadline: deadline
            ? new Date(deadline).toISOString()
            : null,
          status,
        })
        .eq('id', editingEventId);

      if (evError) {
        setSubmitting(false);
        setErrorMsg(`更新活動失敗：${evError.message}`);
        return;
      }

      const targetEvent = events.find((ev) => ev.id === editingEventId);
      const oldShiftIds = (targetEvent?.event_shifts || []).map((s) => s.id);
      const keptShiftIds = shiftInputs
        .map((s) => s.id)
        .filter((id): id is string => Boolean(id));
      const removedShiftIds = oldShiftIds.filter(
        (id) => !keptShiftIds.includes(id)
      );

      if (removedShiftIds.length > 0) {
        await supabase.from('event_shifts').delete().in('id', removedShiftIds);
      }

      for (let idx = 0; idx < shiftInputs.length; idx++) {
        const s = shiftInputs[idx];
        if (s.id) {
          const { error: upErr } = await supabase
            .from('event_shifts')
            .update({
              group_name: s.group_name.trim(),
              start_time: s.start_time,
              end_time: s.end_time,
              quota: Number(s.quota),
              waitlist_quota: Number(s.waitlist_quota),
              sort_order: idx + 1,
            })
            .eq('id', s.id);
          if (upErr) {
            setSubmitting(false);
            setErrorMsg(`更新組別失敗：${upErr.message}`);
            return;
          }
        } else {
          const { error: insErr } = await supabase.from('event_shifts').insert([
            {
              event_id: editingEventId,
              group_name: s.group_name.trim(),
              start_time: s.start_time,
              end_time: s.end_time,
              quota: Number(s.quota),
              waitlist_quota: Number(s.waitlist_quota),
              sort_order: idx + 1,
            },
          ]);
          if (insErr) {
            setSubmitting(false);
            setErrorMsg(`新增組別失敗：${insErr.message}`);
            return;
          }
        }
      }

      await recordAdminAction({
        adminName,
        actionType: 'UPDATE_EVENT',
        actionLabel: '編輯招募內容',
        targetName: title.trim(),
        details: `更新活動日期：${eventDate}｜地點：${location.trim()}｜組別設定：${shiftSummary}`,
      });

      setSubmitting(false);
      setSuccessMsg(
        `已成功更新活動「${title.trim()}」的招募內容與組別設定！（已記錄至操作日誌）`
      );
    }

    setShowForm(false);
    setEditingEventId(null);
    await loadAllData();
  }

  async function handleStatusChange(
    ev: VolunteerEvent,
    newStatus: EventStatus
  ) {
    const oldMeta = getEventStatusMeta(ev.status).label;
    const newMeta = getEventStatusMeta(newStatus).label;

    const { error } = await supabase
      .from('events')
      .update({ status: newStatus })
      .eq('id', ev.id);

    if (error) {
      setErrorMsg(`更新狀態失敗：${error.message}`);
      return;
    }

    await recordAdminAction({
      adminName,
      actionType: 'CHANGE_EVENT_STATUS',
      actionLabel: '變更活動狀態',
      targetName: ev.title,
      details: `將活動狀態由「${oldMeta}」變更為「${newMeta}」`,
    });

    await loadAllData();
  }

  async function handleDeleteEvent(eventId: string, eventTitle: string) {
    const confirmed = window.confirm(
      `確定要刪除活動「${eventTitle}」嗎？\n這將會一併刪除該活動下所有組別與報名紀錄，且無法復原！`
    );
    if (!confirmed) return;

    const { error } = await supabase.from('events').delete().eq('id', eventId);

    if (error) {
      setErrorMsg(`刪除失敗：${error.message}`);
      return;
    }

    await recordAdminAction({
      adminName,
      actionType: 'DELETE_EVENT',
      actionLabel: '刪除招募活動',
      targetName: eventTitle,
      details: `管理員「${adminName}」永久刪除了活動「${eventTitle}」及其所有組別與報名資料`,
    });

    setSuccessMsg(`已刪除活動「${eventTitle}」（已記錄至操作日誌）`);
    await loadAllData();
  }

  // 匯出管理員操作稽核紀錄 CSV
  function handleExportAuditCSV() {
    const headers = [
      '操作時間',
      '管理員姓名',
      '動作代碼',
      '動作名稱',
      '操作對象',
      '詳細紀錄內容',
    ];
    const escapeCsv = (val: string) => `"${(val || '').replace(/"/g, '""')}"`;

    const rows = filteredLogs.map((log) =>
      [
        escapeCsv(new Date(log.created_at).toLocaleString('zh-TW')),
        escapeCsv(log.admin_name),
        escapeCsv(log.action_type),
        escapeCsv(log.action_label),
        escapeCsv(log.target_name),
        escapeCsv(log.details),
      ].join(',')
    );

    const csvContent = '\uFEFF' + [headers.join(','), ...rows].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `管理員操作稽核紀錄_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  const filteredLogs = auditLogs.filter((log) => {
    const matchType =
      logActionFilter === 'all' || log.action_type === logActionFilter;
    const q = logSearch.trim().toLowerCase();
    const matchQuery =
      !q ||
      log.admin_name.toLowerCase().includes(q) ||
      log.action_label.toLowerCase().includes(q) ||
      log.target_name.toLowerCase().includes(q) ||
      log.details.toLowerCase().includes(q);
    return matchType && matchQuery;
  });

  const filteredVolunteers = allRegistrations.filter((reg) => {
    const effRole = getEffectiveRegistrationRole(reg).role;
    const matchRole = permRoleFilter === 'all' || effRole === permRoleFilter;
    const q = permSearch.trim().toLowerCase();
    const matchQuery =
      !q ||
      reg.volunteer_name.toLowerCase().includes(q) ||
      reg.phone.toLowerCase().includes(q) ||
      reg.email.toLowerCase().includes(q);
    return matchRole && matchQuery;
  });

  const authorizedAdminVolunteersCount = allRegistrations.filter(
    (r) => getEffectiveRegistrationRole(r).role !== 'volunteer'
  ).length;

  const totalConfirmed = events.reduce(
    (sum, ev) =>
      sum +
      (ev.event_shifts || []).reduce((sAcc, s) => sAcc + s.confirmed_count, 0),
    0
  );

  return (
    <div className="space-y-8">
      {/* 若尚未在 Supabase 執行擴充 SQL 的一鍵升級橫幅 */}
      {needsSqlUpgrade && (
        <div className="rounded-2xl border-2 border-amber-400 bg-amber-50 p-5 text-amber-950 shadow-sm space-y-3">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-6 w-6 shrink-0 text-amber-600 mt-0.5" />
            <div className="space-y-1.5 text-xs sm:text-sm">
              <div className="font-extrabold text-base">
                請執行一次資料庫權限升級 SQL，以啟用雲端志工名單讀取與權限欄位儲存
              </div>
              <p className="text-amber-900">
                為了讓後台能完整讀取已報名的志工清單、將志工的「<strong>後台管理權限欄位 (role)</strong>」與「<strong>管理員操作稽核紀錄</strong>」永久寫入 Supabase 雲端資料表，請依序點擊下方兩顆按鈕（僅需執行一次）：
              </p>
              <div className="flex flex-wrap items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={handleCopyUpgradeSql}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-amber-600 px-4 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-amber-700"
                >
                  <Copy className="h-4 w-4" />
                  {copiedSql ? '✅ 已複製 SQL！請點右方開啟貼上' : '步驟 1：點此一鍵複製升級 SQL'}
                </button>

                <a
                  href="https://supabase.com/dashboard/project/lsappuzizypupfvyiyxj/sql/new"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-xl border border-amber-600 bg-white px-4 py-2.5 text-xs font-bold text-amber-800 shadow-sm transition hover:bg-amber-100"
                >
                  <ExternalLink className="h-4 w-4" />
                  步驟 2：開啟 Supabase SQL Editor 貼上並按 Run
                </a>

                <button
                  type="button"
                  onClick={loadAllData}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  已執行完畢，點此重新整理
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 頂部管理員資訊列 */}
      <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-extrabold text-slate-900">
              志工系統管理員後台
            </h1>
            <span
              className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-bold ${
                getVolunteerRoleMeta(adminRole).badgeClass
              }`}
            >
              {getVolunteerRoleMeta(adminRole).shortLabel}
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            目前操作管理員：
            <span className="font-bold text-emerald-700">{adminName}</span>
            <span className="ml-2 text-slate-400">
              （所有操作皆自動寫入稽核紀錄）
            </span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => {
              if (showForm && !editingEventId) {
                setShowForm(false);
              } else {
                openCreateMode();
              }
            }}
            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs sm:text-sm font-bold text-white shadow-sm transition hover:bg-emerald-700"
          >
            <Plus className="h-4 w-4" />
            {showForm && !editingEventId ? '收起新增表單' : '新增志工招募活動'}
          </button>

          {adminRole === 'super_admin' && (
            <button
              type="button"
              onClick={() => setShowPasswordModal((prev) => !prev)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-xs sm:text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              <KeyRound className="h-4 w-4 text-amber-600" />
              修改總管理密碼
            </button>
          )}

          <button
            type="button"
            onClick={handleLogout}
            className="inline-flex items-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs sm:text-sm font-semibold text-red-700 transition hover:bg-red-100"
          >
            <LogOut className="h-4 w-4" />
            鎖定並登出
          </button>
        </div>
      </div>

      {/* 修改管理員密碼區塊 */}
      {showPasswordModal && (
        <form
          onSubmit={handleChangePassword}
          className="rounded-2xl border-2 border-amber-400 bg-amber-50/40 p-6 shadow-sm space-y-4"
        >
          <div className="flex items-center justify-between border-b border-amber-200/70 pb-3">
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-amber-600" />
              變更系統最高管理員通行密碼
            </h2>
            <button
              type="button"
              onClick={() => setShowPasswordModal(false)}
              className="text-xs font-semibold text-slate-500 hover:text-slate-800"
            >
              關閉
            </button>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                目前密碼 <span className="text-red-500">*</span>
              </label>
              <input
                type="password"
                required
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
                placeholder="請輸入目前密碼"
                className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-sm outline-none focus:border-emerald-600"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                新管理員密碼 <span className="text-red-500">*</span>
              </label>
              <input
                type="password"
                required
                minLength={4}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="請輸入新密碼 (至少 4 碼)"
                className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-sm outline-none focus:border-emerald-600"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                再次確認新密碼 <span className="text-red-500">*</span>
              </label>
              <input
                type="password"
                required
                minLength={4}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="請再次輸入新密碼"
                className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-sm outline-none focus:border-emerald-600"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowPasswordModal(false)}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700"
            >
              取消
            </button>
            <button
              type="submit"
              className="rounded-xl bg-amber-600 px-5 py-2 text-xs font-bold text-white shadow-sm hover:bg-amber-700"
            >
              確認更新密碼
            </button>
          </div>
        </form>
      )}

      {/* 統計資訊卡 */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-xs font-medium text-slate-500">總活動場次</div>
          <div className="mt-1 text-2xl font-extrabold text-slate-900">
            {events.length}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-xs font-medium text-slate-500">累計正取志工</div>
          <div className="mt-1 text-2xl font-extrabold text-emerald-600">
            {totalConfirmed} 人
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-xs font-medium text-slate-500">
            獲授權之志工管理員
          </div>
          <div className="mt-1 text-2xl font-extrabold text-indigo-600">
            {authorizedAdminVolunteersCount} 人
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-xs font-medium text-slate-500">
            管理員操作稽核紀錄
          </div>
          <div className="mt-1 text-2xl font-extrabold text-blue-600">
            {auditLogs.length} 筆
          </div>
        </div>
      </div>

      {/* 功能切換分頁 Tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200">
        <button
          type="button"
          onClick={() => setActiveTab('events')}
          className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-bold transition ${
            activeTab === 'events'
              ? 'border-emerald-600 text-emerald-700'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <ClipboardList className="h-4 w-4" />
          志工活動與招募內容管理 ({events.length})
        </button>

        <button
          type="button"
          onClick={() => {
            setActiveTab('permissions');
            fetchAllVolunteers();
          }}
          className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-bold transition ${
            activeTab === 'permissions'
              ? 'border-indigo-600 text-indigo-700'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Shield className="h-4 w-4" />
          志工後台管理權限設定 ({allRegistrations.length})
        </button>

        <button
          type="button"
          onClick={() => {
            setActiveTab('audit');
            loadAuditLogs();
          }}
          className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-bold transition ${
            activeTab === 'audit'
              ? 'border-emerald-600 text-emerald-700'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <History className="h-4 w-4" />
          管理員操作稽核紀錄 ({auditLogs.length})
        </button>
      </div>

      {errorMsg && (
        <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <AlertCircle className="h-5 w-5 shrink-0 text-red-600" />
          <span>{errorMsg}</span>
        </div>
      )}

      {successMsg && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* ==================== 分頁 1：志工活動管理 ==================== */}
      {activeTab === 'events' && (
        <div className="space-y-6">
          {showForm && (
            <form
              onSubmit={handleSaveEvent}
              className="rounded-2xl border-2 border-emerald-500/40 bg-white p-6 sm:p-8 shadow-md space-y-6"
            >
              <div className="border-b border-slate-100 pb-4 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-extrabold text-slate-900">
                    {editingEventId
                      ? `✏️ 編輯志工招募活動：${title}`
                      : '➕ 建立新志工招募活動與時段組別'}
                  </h2>
                  <p className="text-xs text-slate-500">
                    修改並儲存後，系統將自動記錄「{adminName}」的修改內容與時間。
                  </p>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    活動名稱 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="例：2026 春季社區環保與關懷志工日"
                    className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm outline-none focus:border-emerald-600"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    活動舉辦日期 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="date"
                    required
                    value={eventDate}
                    onChange={(e) => setEventDate(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm outline-none focus:border-emerald-600"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    報名截止時間（選填）
                  </label>
                  <input
                    type="datetime-local"
                    value={deadline}
                    onChange={(e) => setDeadline(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm outline-none focus:border-emerald-600"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    集合與服務地點 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    placeholder="例：台北市中正區市民活動中心 1 樓大廳"
                    className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm outline-none focus:border-emerald-600"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    發布狀態
                  </label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as EventStatus)}
                    className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm outline-none focus:border-emerald-600"
                  >
                    <option value="open">公開招募中 (open)</option>
                    <option value="closed">報名截止 (closed)</option>
                    <option value="draft">草稿不公開 (draft)</option>
                  </select>
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    活動內容與注意事項說明
                  </label>
                  <textarea
                    rows={3}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="請輸入服務內容、服裝建議、是否提供便當與志工時數證明等說明..."
                    className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm outline-none focus:border-emerald-600"
                  />
                </div>
              </div>

              <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-slate-900">
                    服務時段與組別設定（共 {shiftInputs.length} 組）
                  </h3>
                  <button
                    type="button"
                    onClick={addShiftRow}
                    className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    新增一組時段/組別
                  </button>
                </div>

                <div className="space-y-3">
                  {shiftInputs.map((shift, idx) => (
                    <div
                      key={shift.id || idx}
                      className="grid gap-3 rounded-xl border border-slate-200 bg-white p-3.5 sm:grid-cols-12 items-end"
                    >
                      <div className="sm:col-span-4">
                        <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                          組別 / 班別名稱 *
                        </label>
                        <input
                          type="text"
                          required
                          value={shift.group_name}
                          onChange={(e) =>
                            updateShiftRow(idx, 'group_name', e.target.value)
                          }
                          placeholder="例：早班 - 報到組"
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                        />
                      </div>

                      <div className="sm:col-span-2">
                        <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                          開始時間 *
                        </label>
                        <input
                          type="time"
                          required
                          value={shift.start_time}
                          onChange={(e) =>
                            updateShiftRow(idx, 'start_time', e.target.value)
                          }
                          className="w-full rounded-lg border border-slate-300 px-2.5 py-2 text-xs"
                        />
                      </div>

                      <div className="sm:col-span-2">
                        <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                          結束時間 *
                        </label>
                        <input
                          type="time"
                          required
                          value={shift.end_time}
                          onChange={(e) =>
                            updateShiftRow(idx, 'end_time', e.target.value)
                          }
                          className="w-full rounded-lg border border-slate-300 px-2.5 py-2 text-xs"
                        />
                      </div>

                      <div className="sm:col-span-2">
                        <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                          正取名額上限 *
                        </label>
                        <input
                          type="number"
                          min={1}
                          required
                          value={shift.quota}
                          onChange={(e) =>
                            updateShiftRow(idx, 'quota', Number(e.target.value))
                          }
                          className="w-full rounded-lg border border-slate-300 px-2.5 py-2 text-xs"
                        />
                      </div>

                      <div className="sm:col-span-1">
                        <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                          候補上限
                        </label>
                        <input
                          type="number"
                          min={0}
                          required
                          value={shift.waitlist_quota}
                          onChange={(e) =>
                            updateShiftRow(
                              idx,
                              'waitlist_quota',
                              Number(e.target.value)
                            )
                          }
                          className="w-full rounded-lg border border-slate-300 px-2.5 py-2 text-xs"
                        />
                      </div>

                      <div className="sm:col-span-1 flex justify-end">
                        <button
                          type="button"
                          disabled={shiftInputs.length <= 1}
                          onClick={() => removeShiftRow(idx)}
                          title="刪除此組別"
                          className="rounded-lg border border-red-200 p-2 text-red-600 hover:bg-red-50 disabled:opacity-30"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowForm(false);
                    setEditingEventId(null);
                  }}
                  className="rounded-xl border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-xl bg-emerald-600 px-6 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
                >
                  {submitting
                    ? '儲存中...'
                    : editingEventId
                    ? '儲存修改內容'
                    : '確認建立活動'}
                </button>
              </div>
            </form>
          )}

          {/* 活動管理列表 */}
          {loading ? (
            <div className="space-y-4">
              {[1, 2].map((n) => (
                <div
                  key={n}
                  className="h-40 animate-pulse rounded-2xl border border-slate-200 bg-white p-6"
                />
              ))}
            </div>
          ) : events.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center text-slate-500">
              目前尚無任何志工活動，請點擊上方「新增志工招募活動」建立第一筆活動。
            </div>
          ) : (
            <div className="space-y-4">
              {events.map((event) => {
                const statusMeta = getEventStatusMeta(event.status);
                const shifts = event.event_shifts || [];

                return (
                  <div
                    key={event.id}
                    className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-4"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between border-b border-slate-100 pb-4">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-bold ${statusMeta.badgeClass}`}
                          >
                            {statusMeta.label}
                          </span>
                          <h3 className="text-lg font-bold text-slate-900">
                            {event.title}
                          </h3>
                        </div>

                        <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500 pt-1">
                          <span className="inline-flex items-center gap-1">
                            <Calendar className="h-3.5 w-3.5 text-emerald-600" />
                            {event.event_date}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="h-3.5 w-3.5 text-emerald-600" />
                            {event.location}
                          </span>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          value={event.status}
                          onChange={(e) =>
                            handleStatusChange(
                              event,
                              e.target.value as EventStatus
                            )
                          }
                          className="rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 outline-none focus:border-emerald-600"
                        >
                          <option value="open">狀態：招募中</option>
                          <option value="closed">狀態：已截止</option>
                          <option value="draft">狀態：草稿</option>
                        </select>

                        <button
                          type="button"
                          onClick={() => openEditMode(event)}
                          className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-300 bg-emerald-50 px-3.5 py-2 text-xs font-bold text-emerald-800 transition hover:bg-emerald-100"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          編輯招募內容
                        </button>

                        <Link
                          href={`/admin/events/${event.id}`}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-emerald-700"
                        >
                          <ClipboardList className="h-4 w-4" />
                          名單管理・現場簽到・匯出 CSV
                        </Link>

                        {adminRole === 'super_admin' && (
                          <button
                            type="button"
                            onClick={() =>
                              handleDeleteEvent(event.id, event.title)
                            }
                            className="inline-flex items-center gap-1 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-100"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            刪除
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="grid gap-2.5 sm:grid-cols-3">
                      {shifts.map((shift) => (
                        <div
                          key={shift.id}
                          className="rounded-xl border border-slate-100 bg-slate-50 p-3 text-xs space-y-1"
                        >
                          <div className="font-bold text-slate-800">
                            {shift.group_name}
                          </div>
                          <div className="flex items-center gap-1 text-slate-500">
                            <Clock className="h-3 w-3" />
                            {formatTimeRange(shift.start_time, shift.end_time)}
                          </div>
                          <div className="flex items-center justify-between pt-1 text-[11px]">
                            <span className="font-semibold text-emerald-700">
                              正取：{shift.confirmed_count} / {shift.quota}
                            </span>
                            <span className="font-semibold text-amber-700">
                              候補：{shift.waitlist_count} /{' '}
                              {shift.waitlist_quota}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ==================== 分頁 2：志工後台管理權限設定 ==================== */}
      {activeTab === 'permissions' && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-indigo-200 bg-indigo-50/60 p-4 text-xs text-indigo-900 space-y-1">
            <div className="font-bold text-sm flex items-center gap-1.5">
              <Users className="h-4 w-4 text-indigo-600" />
              如何讓志工擔任後台管理員？
            </div>
            <p>
              1. 在下方名單找到該志工，將「<strong>後台管理權限欄位</strong>
              」由「一般志工」改為「<strong>🛡️ 志工幹部管理員</strong>」或「
              <strong>👑 最高管理員</strong>」。
              <br />
              2. 授權後，該志工即可在後台登入頁輸入自己的「
              <strong>姓名或手機號碼</strong>」＋「
              <strong>個人管理密碼（預設為其手機號碼末 6 碼）</strong>
              」登入後台，而且他進入後做的所有動作也都會以他的名字記錄在稽核日誌中！
            </p>
          </div>

          <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-1 flex-wrap items-center gap-3">
              <div className="relative flex-1 min-w-[200px] max-w-sm">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="search"
                  value={permSearch}
                  onChange={(e) => setPermSearch(e.target.value)}
                  placeholder="搜尋志工姓名、手機號碼或 Email..."
                  className="w-full rounded-xl border border-slate-300 py-2 pl-9 pr-3 text-xs outline-none focus:border-indigo-600"
                />
              </div>

              <select
                value={permRoleFilter}
                onChange={(e) =>
                  setPermRoleFilter(e.target.value as 'all' | VolunteerRole)
                }
                className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-medium outline-none focus:border-indigo-600"
              >
                <option value="all">全部權限等級</option>
                <option value="volunteer">一般志工 (無後台權限)</option>
                <option value="staff_admin">🛡️ 志工幹部管理員</option>
                <option value="super_admin">👑 最高管理員</option>
              </select>
            </div>

            <button
              type="button"
              onClick={fetchAllVolunteers}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              重新整理志工名單
            </button>
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            {filteredVolunteers.length === 0 ? (
              <div className="p-12 text-center text-sm text-slate-500">
                {needsSqlUpgrade
                  ? '請先點擊頁面最上方的「步驟 1：一鍵複製升級 SQL」至 Supabase 執行，即可顯示與管理所有已報名的志工名單！'
                  : '目前尚無符合條件的志工資料（請先於前台報名至少一筆志工資料）'}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                    <tr>
                      <th className="px-4 py-3.5 font-bold">
                        志工姓名 / 手機號碼
                      </th>
                      <th className="px-4 py-3.5 font-bold">
                        所屬活動與報名組別
                      </th>
                      <th className="px-4 py-3.5 font-bold">目前權限等級</th>
                      <th className="px-4 py-3.5 font-bold">
                        設定後台管理權限欄位
                      </th>
                      <th className="px-4 py-3.5 font-bold">
                        志工專屬後台登入密碼
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredVolunteers.map((reg) => {
                      const { role: effRole, adminPin } =
                        getEffectiveRegistrationRole(reg);
                      const roleMeta = getVolunteerRoleMeta(effRole);

                      return (
                        <tr key={reg.id} className="hover:bg-slate-50/80">
                          <td className="px-4 py-3.5 align-middle space-y-0.5">
                            <div className="text-sm font-bold text-slate-900">
                              {reg.volunteer_name}
                            </div>
                            <div className="font-mono text-slate-600">
                              {reg.phone}
                            </div>
                            <div className="text-slate-400">{reg.email}</div>
                          </td>

                          <td className="px-4 py-3.5 align-middle space-y-0.5">
                            <div className="font-semibold text-slate-800">
                              {reg.events?.title || '-'}
                            </div>
                            <div className="text-emerald-700 font-medium">
                              {reg.event_shifts?.group_name || '-'}
                            </div>
                          </td>

                          <td className="px-4 py-3.5 align-middle">
                            <span
                              className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-bold ${roleMeta.badgeClass}`}
                            >
                              {roleMeta.label}
                            </span>
                          </td>

                          <td className="px-4 py-3.5 align-middle">
                            <select
                              value={effRole}
                              disabled={adminRole !== 'super_admin'}
                              onChange={(e) =>
                                handleVolunteerRoleChange(
                                  reg,
                                  e.target.value as VolunteerRole
                                )
                              }
                              className="rounded-xl border border-indigo-300 bg-white px-3 py-2 text-xs font-bold text-slate-800 outline-none focus:border-indigo-600 disabled:opacity-50"
                            >
                              <option value="volunteer">
                                一般志工 (無後台權限)
                              </option>
                              <option value="staff_admin">
                                🛡️ 志工幹部管理員 (可登入簽到/管理)
                              </option>
                              <option value="super_admin">
                                👑 最高管理員 (完整權限)
                              </option>
                            </select>
                          </td>

                          <td className="px-4 py-3.5 align-middle">
                            {effRole === 'volunteer' ? (
                              <span className="text-slate-400">
                                尚未開啟後台權限
                              </span>
                            ) : (
                              <div className="flex items-center gap-2">
                                <input
                                  type="text"
                                  disabled={adminRole !== 'super_admin'}
                                  value={
                                    customPinInputs[reg.id] !== undefined
                                      ? customPinInputs[reg.id]
                                      : adminPin
                                  }
                                  onChange={(e) =>
                                    setCustomPinInputs((prev) => ({
                                      ...prev,
                                      [reg.id]: e.target.value,
                                    }))
                                  }
                                  className="w-28 rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono text-xs outline-none focus:border-indigo-600"
                                />
                                {adminRole === 'super_admin' && (
                                  <button
                                    type="button"
                                    onClick={() => handleSaveVolunteerPin(reg)}
                                    className="rounded-lg bg-indigo-600 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-indigo-700"
                                  >
                                    更新密碼
                                  </button>
                                )}
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ==================== 分頁 3：管理員操作稽核紀錄 ==================== */}
      {activeTab === 'audit' && (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-1 flex-wrap items-center gap-3">
              <div className="relative flex-1 min-w-[200px] max-w-sm">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="search"
                  value={logSearch}
                  onChange={(e) => setLogSearch(e.target.value)}
                  placeholder="搜尋管理員姓名、動作或操作對象..."
                  className="w-full rounded-xl border border-slate-300 py-2 pl-9 pr-3 text-xs outline-none focus:border-emerald-600"
                />
              </div>

              <select
                value={logActionFilter}
                onChange={(e) => setLogActionFilter(e.target.value)}
                className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-medium outline-none focus:border-emerald-600"
              >
                <option value="all">全部動作類型</option>
                <option value="LOGIN">登入管理後台</option>
                <option value="LOGIN_FAILED">密碼錯誤攔截</option>
                <option value="LOGOUT">登出管理後台</option>
                <option value="CHANGE_VOLUNTEER_ROLE">變更志工後台權限</option>
                <option value="CREATE_EVENT">新增招募活動</option>
                <option value="UPDATE_EVENT">編輯招募內容</option>
                <option value="CHANGE_EVENT_STATUS">變更活動狀態</option>
                <option value="DELETE_EVENT">刪除招募活動</option>
                <option value="CHECK_IN">志工簽到打卡</option>
                <option value="UNCHECK_IN">取消志工簽到</option>
                <option value="CHANGE_REG_STATUS">變更志工錄取狀態</option>
                <option value="EXPORT_CSV">匯出 CSV 名單</option>
                <option value="CHANGE_PASSWORD">修改管理員密碼</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={loadAuditLogs}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                重新整理
              </button>
              <button
                type="button"
                onClick={handleExportAuditCSV}
                disabled={filteredLogs.length === 0}
                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
              >
                <Download className="h-3.5 w-3.5" />
                匯出稽核紀錄 CSV ({filteredLogs.length})
              </button>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            {filteredLogs.length === 0 ? (
              <div className="p-12 text-center text-sm text-slate-500">
                目前尚無符合條件的管理員操作紀錄
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                    <tr>
                      <th className="px-4 py-3.5 font-bold whitespace-nowrap">
                        操作時間
                      </th>
                      <th className="px-4 py-3.5 font-bold whitespace-nowrap">
                        管理員 / 志工幹部
                      </th>
                      <th className="px-4 py-3.5 font-bold whitespace-nowrap">
                        執行動作
                      </th>
                      <th className="px-4 py-3.5 font-bold whitespace-nowrap">
                        操作對象
                      </th>
                      <th className="px-4 py-3.5 font-bold">詳細變更內容</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredLogs.map((log) => (
                      <tr key={log.id} className="hover:bg-slate-50/80">
                        <td className="px-4 py-3 font-mono text-slate-500 whitespace-nowrap">
                          {new Date(log.created_at).toLocaleString('zh-TW')}
                        </td>
                        <td className="px-4 py-3 font-bold text-slate-900 whitespace-nowrap">
                          {log.admin_name}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span
                            className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${getActionBadgeClass(
                              log.action_type
                            )}`}
                          >
                            {log.action_label}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-semibold text-slate-800 whitespace-nowrap">
                          {log.target_name}
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {log.details}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
