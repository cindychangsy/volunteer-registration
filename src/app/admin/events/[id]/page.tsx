'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Download,
  Search,
  CheckCircle2,
  UserCheck,
  Utensils,
  Calendar,
  MapPin,
  Clock,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';
import {
  supabase,
  formatTimeRange,
  getDietaryLabel,
  getRegistrationStatusMeta,
} from '@/lib/supabase';
import type {
  VolunteerEvent,
  EventShift,
  Registration,
  RegistrationStatus,
} from '@/types/database';

export default function AdminEventRegistrationsPage() {
  const params = useParams();
  const router = useRouter();
  const eventId = params?.id as string;

  const [event, setEvent] = useState<VolunteerEvent | null>(null);
  const [shifts, setShifts] = useState<EventShift[]>([]);
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');

  // 篩選條件
  const [selectedShiftId, setSelectedShiftId] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | RegistrationStatus>('all');
  const [checkinFilter, setCheckinFilter] = useState<'all' | 'checked' | 'unchecked'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    checkAuthAndFetch();
  }, [eventId]);

  async function checkAuthAndFetch() {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) {
      router.replace('/admin/login');
      return;
    }

    if (eventId) {
      await fetchEventAndRegistrations();
    }
  }

  async function fetchEventAndRegistrations() {
    setLoading(true);
    setErrorMsg('');

    const [evRes, regRes] = await Promise.all([
      supabase
        .from('events')
        .select('*, event_shifts (*)')
        .eq('id', eventId)
        .single(),
      supabase
        .from('registrations')
        .select('*, event_shifts (group_name, start_time, end_time)')
        .eq('event_id', eventId)
        .order('created_at', { ascending: true }),
    ]);

    if (evRes.error || !evRes.data) {
      setErrorMsg(evRes.error?.message || '找不到此活動');
      setLoading(false);
      return;
    }

    if (regRes.error) {
      setErrorMsg(regRes.error.message || '載入報名名單失敗');
      setLoading(false);
      return;
    }

    const ev = evRes.data as VolunteerEvent;
    const sortedShifts = (ev.event_shifts || []).sort(
      (a: EventShift, b: EventShift) => a.sort_order - b.sort_order
    );

    setEvent(ev);
    setShifts(sortedShifts);
    setRegistrations((regRes.data as Registration[]) || []);
    setLoading(false);
  }

  async function handleToggleCheckIn(reg: Registration) {
    const nextChecked = !reg.checked_in;
    const nextTime = nextChecked ? new Date().toISOString() : null;

    const { error } = await supabase
      .from('registrations')
      .update({
        checked_in: nextChecked,
        checked_in_at: nextTime,
      })
      .eq('id', reg.id);

    if (error) {
      setErrorMsg(`更新簽到狀態失敗：${error.message}`);
      return;
    }

    setRegistrations((prev) =>
      prev.map((r) =>
        r.id === reg.id
          ? { ...r, checked_in: nextChecked, checked_in_at: nextTime }
          : r
      )
    );
  }

  async function handleChangeStatus(regId: string, newStatus: RegistrationStatus) {
    const { error } = await supabase
      .from('registrations')
      .update({ status: newStatus })
      .eq('id', regId);

    if (error) {
      setErrorMsg(`變更錄取狀態失敗：${error.message}`);
      return;
    }

    await fetchEventAndRegistrations();
  }

  // 篩選後的名單
  const filteredList = registrations.filter((reg) => {
    const matchShift = selectedShiftId === 'all' || reg.shift_id === selectedShiftId;
    const matchStatus = statusFilter === 'all' || reg.status === statusFilter;
    const matchCheckin =
      checkinFilter === 'all' ||
      (checkinFilter === 'checked' && reg.checked_in) ||
      (checkinFilter === 'unchecked' && !reg.checked_in);

    const q = searchQuery.trim().toLowerCase();
    const matchQuery =
      !q ||
      reg.volunteer_name.toLowerCase().includes(q) ||
      reg.phone.toLowerCase().includes(q) ||
      reg.email.toLowerCase().includes(q) ||
      reg.id_number.toLowerCase().includes(q);

    return matchShift && matchStatus && matchCheckin && matchQuery;
  });

  // 匯出 CSV (含 UTF-8 BOM 防止 Excel 中文亂碼)
  function handleExportCSV() {
    if (!event) return;

    const headers = [
      '錄取狀態',
      '現場簽到',
      '簽到時間',
      '組別名稱',
      '服務時段',
      '志工姓名',
      '手機號碼',
      '電子信箱',
      '身分證字號(保險用)',
      '出生年月日(保險用)',
      '餐點需求',
      '緊急聯絡人',
      '緊急聯絡人電話',
      '備註',
      '報名送出時間',
    ];

    const escapeCsv = (val: string) => `"${(val || '').replace(/"/g, '""')}"`;

    const rows = filteredList.map((r) => {
      const statusLabel = getRegistrationStatusMeta(r.status).label;
      const checkedLabel = r.checked_in ? '已簽到' : '未簽到';
      const checkedTime = r.checked_in_at
        ? new Date(r.checked_in_at).toLocaleString('zh-TW')
        : '';
      const groupName = r.event_shifts?.group_name || '';
      const timeRange = r.event_shifts
        ? formatTimeRange(r.event_shifts.start_time, r.event_shifts.end_time)
        : '';

      return [
        escapeCsv(statusLabel),
        escapeCsv(checkedLabel),
        escapeCsv(checkedTime),
        escapeCsv(groupName),
        escapeCsv(timeRange),
        escapeCsv(r.volunteer_name),
        escapeCsv(`'${r.phone}`), // 加上單引號或保留前導 0
        escapeCsv(r.email),
        escapeCsv(r.id_number),
        escapeCsv(r.birth_date),
        escapeCsv(getDietaryLabel(r.dietary)),
        escapeCsv(r.emergency_contact),
        escapeCsv(`'${r.emergency_phone}`),
        escapeCsv(r.note),
        escapeCsv(new Date(r.created_at).toLocaleString('zh-TW')),
      ].join(',');
    });

    const csvContent = '\uFEFF' + [headers.join(','), ...rows].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `${event.event_date}_${event.title}_志工名單.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // 統計數據（以正取志工統計餐點與簽到）
  const confirmedRegs = registrations.filter((r) => r.status === 'confirmed');
  const waitlistRegs = registrations.filter((r) => r.status === 'waitlist');
  const checkedInCount = confirmedRegs.filter((r) => r.checked_in).length;
  const meatCount = confirmedRegs.filter((r) => r.dietary === 'meat').length;
  const vegCount = confirmedRegs.filter((r) => r.dietary === 'vegetarian').length;

  return (
    <div className="space-y-6">
      {/* 返回與重新整理 */}
      <div className="flex items-center justify-between">
        <Link
          href="/admin"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-600 hover:text-emerald-600"
        >
          <ArrowLeft className="h-4 w-4" />
          返回管理後台總覽
        </Link>

        <button
          type="button"
          onClick={fetchEventAndRegistrations}
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          重新整理名單
        </button>
      </div>

      {/* 活動標題與匯出 CSV */}
      {event && (
        <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <h1 className="text-xl font-extrabold text-slate-900 sm:text-2xl">
              {event.title}
            </h1>
            <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500">
              <span className="inline-flex items-center gap-1">
                <Calendar className="h-3.5 w-3.5 text-emerald-600" />
                活動日期：{event.event_date}
              </span>
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5 text-emerald-600" />
                {event.location}
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={handleExportCSV}
            disabled={filteredList.length === 0}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            匯出目前篩選 CSV 名單 ({filteredList.length} 筆)
          </button>
        </div>
      )}

      {/* 簽到與便當統計看板 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs text-slate-500">正取志工數</div>
          <div className="mt-1 text-2xl font-extrabold text-emerald-600">
            {confirmedRegs.length} 人
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs text-slate-500">候補中人數</div>
          <div className="mt-1 text-2xl font-extrabold text-amber-600">
            {waitlistRegs.length} 人
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs text-slate-500">現場已簽到 (正取)</div>
          <div className="mt-1 text-2xl font-extrabold text-blue-600">
            {checkedInCount} / {confirmedRegs.length}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs text-slate-500 flex items-center gap-1">
            <Utensils className="h-3.5 w-3.5 text-emerald-600" />
            正取葷食便當
          </div>
          <div className="mt-1 text-2xl font-extrabold text-slate-900">
            {meatCount} 份
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs text-slate-500 flex items-center gap-1">
            <Utensils className="h-3.5 w-3.5 text-emerald-600" />
            正取素食便當
          </div>
          <div className="mt-1 text-2xl font-extrabold text-emerald-700">
            {vegCount} 份
          </div>
        </div>
      </div>

      {errorMsg && (
        <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <AlertCircle className="h-5 w-5 shrink-0 text-red-600" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* 篩選與搜尋工具列 */}
      <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜尋姓名、手機、身分證..."
            className="w-full rounded-xl border border-slate-300 py-2 pl-9 pr-3 text-xs outline-none focus:border-emerald-600"
          />
        </div>

        <select
          value={selectedShiftId}
          onChange={(e) => setSelectedShiftId(e.target.value)}
          className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-medium outline-none focus:border-emerald-600"
        >
          <option value="all">全部時段組別 ({shifts.length} 組)</option>
          {shifts.map((s) => (
            <option key={s.id} value={s.id}>
              {s.group_name} ({formatTimeRange(s.start_time, s.end_time)})
            </option>
          ))}
        </select>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as 'all' | RegistrationStatus)}
          className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-medium outline-none focus:border-emerald-600"
        >
          <option value="all">全部錄取狀態</option>
          <option value="confirmed">正取 (confirmed)</option>
          <option value="waitlist">候補中 (waitlist)</option>
          <option value="cancelled">已取消 (cancelled)</option>
        </select>

        <select
          value={checkinFilter}
          onChange={(e) =>
            setCheckinFilter(e.target.value as 'all' | 'checked' | 'unchecked')
          }
          className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-medium outline-none focus:border-emerald-600"
        >
          <option value="all">全部簽到狀態</option>
          <option value="checked">已完成簽到</option>
          <option value="unchecked">尚未簽到</option>
        </select>
      </div>

      {/* 報名志工名單表格 */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {loading ? (
          <div className="p-12 text-center text-sm text-slate-500">載入報名名單中...</div>
        ) : filteredList.length === 0 ? (
          <div className="p-12 text-center text-sm text-slate-500">
            目前沒有符合篩選條件的報名資料
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-3.5 font-bold">現場簽到打卡</th>
                  <th className="px-4 py-3.5 font-bold">志工姓名 / 聯絡資訊</th>
                  <th className="px-4 py-3.5 font-bold">報名組別與時段</th>
                  <th className="px-4 py-3.5 font-bold">保險資料 (身分證 / 生日)</th>
                  <th className="px-4 py-3.5 font-bold">餐點 / 緊急聯絡人</th>
                  <th className="px-4 py-3.5 font-bold">錄取狀態管理</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredList.map((reg) => {
                  const statusMeta = getRegistrationStatusMeta(reg.status);

                  return (
                    <tr key={reg.id} className="hover:bg-slate-50/80 transition">
                      {/* 簽到打卡欄 */}
                      <td className="px-4 py-3.5 align-middle">
                        <button
                          type="button"
                          onClick={() => handleToggleCheckIn(reg)}
                          className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold transition ${
                            reg.checked_in
                              ? 'bg-blue-600 text-white shadow-sm hover:bg-blue-700'
                              : 'border border-slate-300 bg-white text-slate-700 hover:border-emerald-500 hover:text-emerald-700'
                          }`}
                        >
                          {reg.checked_in ? (
                            <>
                              <CheckCircle2 className="h-4 w-4" />
                              已簽到
                            </>
                          ) : (
                            <>
                              <UserCheck className="h-4 w-4" />
                              點此簽到
                            </>
                          )}
                        </button>
                        {reg.checked_in_at && (
                          <div className="mt-1 text-[10px] text-slate-400">
                            {new Date(reg.checked_in_at).toLocaleTimeString('zh-TW', {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </div>
                        )}
                      </td>

                      {/* 姓名與聯絡 */}
                      <td className="px-4 py-3.5 align-middle space-y-0.5">
                        <div className="text-sm font-bold text-slate-900">
                          {reg.volunteer_name}
                        </div>
                        <div className="font-mono text-slate-600">{reg.phone}</div>
                        <div className="text-slate-400">{reg.email}</div>
                      </td>

                      {/* 組別時段 */}
                      <td className="px-4 py-3.5 align-middle space-y-1">
                        <div className="font-bold text-emerald-800">
                          {reg.event_shifts?.group_name || '-'}
                        </div>
                        {reg.event_shifts && (
                          <div className="inline-flex items-center gap-1 text-slate-500">
                            <Clock className="h-3 w-3" />
                            {formatTimeRange(
                              reg.event_shifts.start_time,
                              reg.event_shifts.end_time
                            )}
                          </div>
                        )}
                      </td>

                      {/* 保險資料 */}
                      <td className="px-4 py-3.5 align-middle space-y-0.5">
                        <div className="font-mono font-semibold text-slate-800">
                          {reg.id_number}
                        </div>
                        <div className="text-slate-500">生日：{reg.birth_date}</div>
                      </td>

                      {/* 餐點與緊急聯絡人 */}
                      <td className="px-4 py-3.5 align-middle space-y-1">
                        <div>
                          <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 font-semibold text-slate-700">
                            {getDietaryLabel(reg.dietary)}
                          </span>
                        </div>
                        <div className="text-slate-600">
                          緊急：{reg.emergency_contact} ({reg.emergency_phone})
                        </div>
                        {reg.note && (
                          <div className="text-amber-700 bg-amber-50 px-2 py-0.5 rounded">
                            備註：{reg.note}
                          </div>
                        )}
                      </td>

                      {/* 狀態管理 */}
                      <td className="px-4 py-3.5 align-middle space-y-1.5">
                        <div>
                          <span
                            className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${statusMeta.badgeClass}`}
                          >
                            {statusMeta.label}
                          </span>
                        </div>
                        <select
                          value={reg.status}
                          onChange={(e) =>
                            handleChangeStatus(
                              reg.id,
                              e.target.value as RegistrationStatus
                            )
                          }
                          className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 outline-none focus:border-emerald-600"
                        >
                          <option value="confirmed">設為：正取</option>
                          <option value="waitlist">設為：候補</option>
                          <option value="cancelled">設為：已取消</option>
                        </select>
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
  );
}
