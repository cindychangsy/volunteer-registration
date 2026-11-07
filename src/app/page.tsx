'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Calendar,
  MapPin,
  Clock,
  Users,
  ArrowRight,
  Search,
  AlertTriangle,
  Sparkles,
  CheckCircle2,
} from 'lucide-react';
import { supabase, formatTimeRange, getEventStatusMeta } from '@/lib/supabase';
import type { VolunteerEvent, EventShift } from '@/types/database';

export default function HomePage() {
  const [events, setEvents] = useState<VolunteerEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [dbNotInitialized, setDbNotInitialized] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'closed'>('all');

  useEffect(() => {
    fetchEvents();
  }, []);

  async function fetchEvents() {
    setLoading(true);
    setErrorMsg('');
    setDbNotInitialized(false);

    const { data, error } = await supabase
      .from('events')
      .select(
        `
        *,
        event_shifts (*)
      `
      )
      .in('status', ['open', 'closed'])
      .order('event_date', { ascending: true });

    if (error) {
      if (
        error.code === '42P01' ||
        error.code === 'PGRST205' ||
        error.message?.includes('events')
      ) {
        setDbNotInitialized(true);
      } else {
        setErrorMsg(error.message || '無法載入活動資料');
      }
      setLoading(false);
      return;
    }

    const sorted = (data as VolunteerEvent[]).map((ev) => ({
      ...ev,
      event_shifts: (ev.event_shifts || []).sort(
        (a: EventShift, b: EventShift) => a.sort_order - b.sort_order
      ),
    }));

    setEvents(sorted);
    setLoading(false);
  }

  const filteredEvents = events.filter((ev) => {
    const matchesStatus = statusFilter === 'all' || ev.status === statusFilter;
    const q = searchQuery.trim().toLowerCase();
    const matchesQuery =
      !q ||
      ev.title.toLowerCase().includes(q) ||
      ev.location.toLowerCase().includes(q) ||
      (ev.description && ev.description.toLowerCase().includes(q));
    return matchesStatus && matchesQuery;
  });

  return (
    <div className="space-y-8">
      {/* Hero Banner */}
      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-700 via-emerald-600 to-teal-700 px-6 py-10 text-white shadow-md sm:px-10">
        <div className="relative z-10 max-w-2xl space-y-4">
          <div className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3.5 py-1 text-xs font-medium backdrop-blur-sm">
            <Sparkles className="h-3.5 w-3.5" />
            <span>免註冊快速報名 · 額滿自動候補 · 投保平安險</span>
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight sm:text-4xl">
            一起投入志願服務，讓改變發生
          </h1>
          <p className="text-sm leading-relaxed text-emerald-50 sm:text-base">
            選擇您感興趣的志工活動與服務時段組別，填寫基本資料與餐點需求即可完成報名。隨時可透過手機號碼與信箱查詢錄取或候補狀態。
          </p>
          <div className="flex flex-wrap gap-3 pt-2">
            <Link
              href="/lookup"
              className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-emerald-800 shadow-sm transition hover:bg-emerald-50"
            >
              <Search className="h-4 w-4" />
              查詢或取消已報名活動
            </Link>
          </div>
        </div>
      </section>

      {/* 若尚未在 Supabase 執行 schema.sql 的引導提示 */}
      {dbNotInitialized && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-6 text-amber-900 shadow-sm">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-6 w-6 shrink-0 text-amber-600" />
            <div className="space-y-2 text-sm">
              <h2 className="text-base font-bold text-amber-950">
                尚未在 Supabase 初始化志工報名系統資料表
              </h2>
              <p>
                系統已成功連線至您的 Supabase 專案，但尚未偵測到{' '}
                <code className="rounded bg-amber-100 px-1.5 py-0.5 font-mono text-xs">
                  events
                </code>{' '}
                資料表。請依照以下步驟完成資料庫初始化：
              </p>
              <ol className="list-decimal space-y-1 pl-5">
                <li>
                  打開專案目錄下的{' '}
                  <code className="rounded bg-amber-100 px-1.5 py-0.5 font-mono text-xs">
                    supabase/schema.sql
                  </code>{' '}
                  檔案並複製全部內容。
                </li>
                <li>
                  前往您的 <strong>Supabase Dashboard &rarr; SQL Editor</strong>，貼上腳本並點擊{' '}
                  <strong>Run</strong>。
                </li>
                <li>執行完成後，點擊下方按鈕重新整理即可看到範例志工活動！</li>
              </ol>
              <button
                onClick={fetchEvents}
                className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-amber-700"
              >
                我已執行 SQL，重新載入資料
              </button>
            </div>
          </div>
        </div>
      )}

      {errorMsg && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          載入失敗：{errorMsg}
        </div>
      )}

      {/* 搜尋與狀態篩選列 */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜尋活動名稱、地點或關鍵字..."
            className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-4 text-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
          />
        </div>

        <div className="flex items-center gap-1.5 self-start rounded-xl bg-slate-200/70 p-1">
          {(
            [
              { key: 'all', label: '全部活動' },
              { key: 'open', label: '招募中' },
              { key: 'closed', label: '已截止' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.key}
              onClick={() => setStatusFilter(tab.key)}
              className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition ${
                statusFilter === tab.key
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* 活動卡片列表 */}
      {loading ? (
        <div className="grid gap-6 md:grid-cols-2">
          {[1, 2].map((n) => (
            <div
              key={n}
              className="h-72 animate-pulse rounded-2xl border border-slate-200 bg-white p-6"
            />
          ))}
        </div>
      ) : filteredEvents.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white py-16 text-center">
          <p className="text-base font-medium text-slate-600">
            目前沒有符合條件的志工活動
          </p>
          <p className="mt-1 text-xs text-slate-400">
            管理員可至「管理員後台」新增志工招募活動與時段組別
          </p>
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          {filteredEvents.map((event) => {
            const statusMeta = getEventStatusMeta(event.status);
            const shifts = event.event_shifts || [];
            const totalQuota = shifts.reduce((acc, s) => acc + s.quota, 0);
            const totalConfirmed = shifts.reduce((acc, s) => acc + s.confirmed_count, 0);

            return (
              <article
                key={event.id}
                className="flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:border-emerald-300 hover:shadow-md"
              >
                <div className="space-y-4">
                  {/* 狀態與日期 */}
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${statusMeta.badgeClass}`}
                    >
                      {statusMeta.label}
                    </span>
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500">
                      <Users className="h-3.5 w-3.5 text-emerald-600" />
                      總報名正取 {totalConfirmed} / {totalQuota} 名
                    </span>
                  </div>

                  {/* 標題與說明 */}
                  <div>
                    <h2 className="text-xl font-bold text-slate-900 line-clamp-2">
                      {event.title}
                    </h2>
                    {event.description && (
                      <p className="mt-2 text-sm text-slate-600 line-clamp-2">
                        {event.description}
                      </p>
                    )}
                  </div>

                  {/* 活動時間與地點 */}
                  <div className="space-y-1.5 rounded-xl bg-slate-50 p-3.5 text-xs text-slate-600">
                    <div className="flex items-center gap-2">
                      <Calendar className="h-4 w-4 shrink-0 text-emerald-600" />
                      <span className="font-medium text-slate-800">
                        活動日期：{event.event_date}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <MapPin className="h-4 w-4 shrink-0 text-emerald-600" />
                      <span>集合地點：{event.location}</span>
                    </div>
                  </div>

                  {/* 多時段組別名額概覽 */}
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-slate-700">
                      服務時段與組別名額（共 {shifts.length} 組）：
                    </p>
                    <div className="space-y-1.5">
                      {shifts.map((shift) => {
                        const remaining = Math.max(0, shift.quota - shift.confirmed_count);
                        const waitlistRemaining = Math.max(
                          0,
                          shift.waitlist_quota - shift.waitlist_count
                        );

                        return (
                          <div
                            key={shift.id}
                            className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50/70 px-3 py-2 text-xs"
                          >
                            <div className="space-y-0.5 pr-2">
                              <div className="font-semibold text-slate-800">
                                {shift.group_name}
                              </div>
                              <div className="flex items-center gap-1 text-slate-500">
                                <Clock className="h-3 w-3" />
                                {formatTimeRange(shift.start_time, shift.end_time)}
                              </div>
                            </div>

                            <div className="text-right shrink-0">
                              {remaining > 0 ? (
                                <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700">
                                  <CheckCircle2 className="h-3 w-3" />
                                  尚餘 {remaining} 名
                                </span>
                              ) : waitlistRemaining > 0 ? (
                                <span className="inline-flex items-center rounded-md bg-amber-50 px-2 py-0.5 font-semibold text-amber-700">
                                  正取額滿・可排候補 ({ waitlistRemaining })
                                </span>
                              ) : (
                                <span className="inline-flex items-center rounded-md bg-slate-200 px-2 py-0.5 font-semibold text-slate-600">
                                  已完全額滿
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* 底部報名按鈕 */}
                <div className="mt-6 pt-4 border-t border-slate-100">
                  <Link
                    href={`/events/${event.id}`}
                    className={`flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition ${
                      event.status === 'open'
                        ? 'bg-emerald-600 text-white shadow-sm hover:bg-emerald-700'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    <span>
                      {event.status === 'open' ? '查看詳情與選擇組別報名' : '查看活動詳情'}
                    </span>
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
