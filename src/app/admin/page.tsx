'use client';

import { useEffect, useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Plus,
  Trash2,
  Users,
  Calendar,
  MapPin,
  LogOut,
  ClipboardList,
  Clock,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { supabase, formatTimeRange, getEventStatusMeta } from '@/lib/supabase';
import type { VolunteerEvent, EventShift, EventStatus } from '@/types/database';

interface ShiftInput {
  group_name: string;
  start_time: string;
  end_time: string;
  quota: number;
  waitlist_quota: number;
}

export default function AdminDashboardPage() {
  const router = useRouter();
  const [adminEmail, setAdminEmail] = useState<string>('');
  const [events, setEvents] = useState<VolunteerEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // 新增活動表單狀態
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
    checkAuthAndFetch();
  }, []);

  async function checkAuthAndFetch() {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) {
      router.replace('/admin/login');
      return;
    }

    setAdminEmail(session.user.email || '管理員');
    await fetchAllEvents();
  }

  async function fetchAllEvents() {
    setLoading(true);
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
      setLoading(false);
      return;
    }

    const sorted = ((data as VolunteerEvent[]) || []).map((ev) => ({
      ...ev,
      event_shifts: (ev.event_shifts || []).sort(
        (a: EventShift, b: EventShift) => a.sort_order - b.sort_order
      ),
    }));

    setEvents(sorted);
    setLoading(false);
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    router.replace('/admin/login');
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

  function updateShiftRow(index: number, field: keyof ShiftInput, value: string | number) {
    setShiftInputs((prev) =>
      prev.map((row, i) => (i === index ? { ...row, [field]: value } : row))
    );
  }

  async function handleCreateEvent(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setErrorMsg('');
    setSuccessMsg('');

    // 1. 新增活動主檔
    const { data: createdEvent, error: evError } = await supabase
      .from('events')
      .insert([
        {
          title: title.trim(),
          description: description.trim(),
          location: location.trim(),
          event_date: eventDate,
          registration_deadline: deadline ? new Date(deadline).toISOString() : null,
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

    // 2. 新增多筆時段組別
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

    setSuccessMsg(`已成功建立活動「${createdEvent.title}」與 ${shiftsPayload.length} 個時段組別！`);
    setTitle('');
    setDescription('');
    setLocation('');
    setEventDate('');
    setDeadline('');
    setShowCreateForm(false);
    await fetchAllEvents();
  }

  async function handleStatusChange(eventId: string, newStatus: EventStatus) {
    const { error } = await supabase
      .from('events')
      .update({ status: newStatus })
      .eq('id', eventId);

    if (error) {
      setErrorMsg(`更新狀態失敗：${error.message}`);
      return;
    }

    await fetchAllEvents();
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

    setSuccessMsg(`已刪除活動「${eventTitle}」`);
    await fetchAllEvents();
  }

  const totalConfirmed = events.reduce(
    (sum, ev) =>
      sum +
      (ev.event_shifts || []).reduce((sAcc, s) => sAcc + s.confirmed_count, 0),
    0
  );
  const totalWaitlist = events.reduce(
    (sum, ev) =>
      sum +
      (ev.event_shifts || []).reduce((sAcc, s) => sAcc + s.waitlist_count, 0),
    0
  );

  return (
    <div className="space-y-8">
      {/* 頂部管理員資訊列 */}
      <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900">
            志工系統管理員後台
          </h1>
          <p className="mt-1 text-xs text-slate-500">
            目前登入帳號：<span className="font-semibold text-slate-800">{adminEmail}</span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => setShowCreateForm((prev) => !prev)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-700"
          >
            <Plus className="h-4 w-4" />
            {showCreateForm ? '收起新增表單' : '新增志工招募活動'}
          </button>

          <button
            type="button"
            onClick={handleLogout}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            <LogOut className="h-4 w-4" />
            登出
          </button>
        </div>
      </div>

      {/* 統計資訊卡 */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-xs font-medium text-slate-500">總活動場次</div>
          <div className="mt-1 text-2xl font-extrabold text-slate-900">{events.length}</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-xs font-medium text-slate-500">開放招募中</div>
          <div className="mt-1 text-2xl font-extrabold text-emerald-600">
            {events.filter((e) => e.status === 'open').length}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-xs font-medium text-slate-500">累計正取志工</div>
          <div className="mt-1 text-2xl font-extrabold text-slate-900">{totalConfirmed} 人</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-xs font-medium text-slate-500">累計候補志工</div>
          <div className="mt-1 text-2xl font-extrabold text-amber-600">{totalWaitlist} 人</div>
        </div>
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

      {/* 新增活動與多時段組別表單 */}
      {showCreateForm && (
        <form
          onSubmit={handleCreateEvent}
          className="rounded-2xl border-2 border-emerald-500/40 bg-white p-6 sm:p-8 shadow-md space-y-6"
        >
          <div className="border-b border-slate-100 pb-4">
            <h2 className="text-lg font-extrabold text-slate-900">
              建立新志工招募活動与時段組別
            </h2>
            <p className="text-xs text-slate-500">
              可自由為單一活動設定多個班別與組別（如：早班報到組、午班引導組），並分別設定正取與候補人數上限。
            </p>
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
                初始發布狀態
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

          {/* 動態多時段與組別設定 */}
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
                  key={idx}
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
                      onChange={(e) => updateShiftRow(idx, 'group_name', e.target.value)}
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
                      onChange={(e) => updateShiftRow(idx, 'start_time', e.target.value)}
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
                      onChange={(e) => updateShiftRow(idx, 'end_time', e.target.value)}
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
                      onChange={(e) => updateShiftRow(idx, 'quota', Number(e.target.value))}
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
                        updateShiftRow(idx, 'waitlist_quota', Number(e.target.value))
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
              onClick={() => setShowCreateForm(false)}
              className="rounded-xl border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-xl bg-emerald-600 px-6 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
            >
              {submitting ? '儲存中...' : '確認建立活動'}
            </button>
          </div>
        </form>
      )}

      {/* 活動管理列表 */}
      <div className="space-y-4">
        <h2 className="text-lg font-bold text-slate-900">所有志工活動與場次管理</h2>

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
                          handleStatusChange(event.id, e.target.value as EventStatus)
                        }
                        className="rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 outline-none focus:border-emerald-600"
                      >
                        <option value="open">狀態：招募中</option>
                        <option value="closed">狀態：已截止</option>
                        <option value="draft">狀態：草稿</option>
                      </select>

                      <Link
                        href={`/admin/events/${event.id}`}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-emerald-700"
                      >
                        <ClipboardList className="h-4 w-4" />
                        名單管理・現場簽到・匯出 CSV
                      </Link>

                      <button
                        type="button"
                        onClick={() => handleDeleteEvent(event.id, event.title)}
                        className="inline-flex items-center gap-1 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-100"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        刪除
                      </button>
                    </div>
                  </div>

                  {/* 各組別報名概況 */}
                  <div className="grid gap-2.5 sm:grid-cols-3">
                    {shifts.map((shift) => (
                      <div
                        key={shift.id}
                        className="rounded-xl border border-slate-100 bg-slate-50 p-3 text-xs space-y-1"
                      >
                        <div className="font-bold text-slate-800">{shift.group_name}</div>
                        <div className="flex items-center gap-1 text-slate-500">
                          <Clock className="h-3 w-3" />
                          {formatTimeRange(shift.start_time, shift.end_time)}
                        </div>
                        <div className="flex items-center justify-between pt-1 text-[11px]">
                          <span className="font-semibold text-emerald-700">
                            正取：{shift.confirmed_count} / {shift.quota}
                          </span>
                          <span className="font-semibold text-amber-700">
                            候補：{shift.waitlist_count} / {shift.waitlist_quota}
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
    </div>
  );
}
