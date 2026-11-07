'use client';

import { Suspense, useEffect, useState, FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  Search,
  Calendar,
  MapPin,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Utensils,
  ShieldCheck,
} from 'lucide-react';
import {
  supabase,
  formatTimeRange,
  getDietaryLabel,
  getRegistrationStatusMeta,
} from '@/lib/supabase';
import type { LookupRegistrationResult } from '@/types/database';

function LookupContent() {
  const searchParams = useSearchParams();
  const initialPhone = searchParams.get('phone') || '';
  const initialEmail = searchParams.get('email') || '';

  const [phone, setPhone] = useState(initialPhone);
  const [email, setEmail] = useState(initialEmail);
  const [results, setResults] = useState<LookupRegistrationResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  useEffect(() => {
    if (initialPhone && initialEmail) {
      performLookup(initialPhone, initialEmail);
    }
  }, [initialPhone, initialEmail]);

  async function performLookup(qPhone: string, qEmail: string) {
    setLoading(true);
    setErrorMsg('');

    const { data, error } = await supabase.rpc('lookup_volunteer_registrations', {
      p_phone: qPhone,
      p_email: qEmail,
    });

    setLoading(false);

    if (error) {
      setErrorMsg(error.message || '查詢失敗，請確認輸入的手機號碼與信箱是否正確');
      return;
    }

    setResults((data as LookupRegistrationResult[]) || []);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSuccessMsg('');
    await performLookup(phone, email);
  }

  async function handleCancelRegistration(regId: string, eventTitle: string, groupName: string) {
    const confirmed = window.confirm(
      `確定要取消「${eventTitle} - ${groupName}」的報名嗎？\n取消後若該組別有候補志工，系統將自動遞補名額。`
    );
    if (!confirmed) return;

    setCancellingId(regId);
    setErrorMsg('');
    setSuccessMsg('');

    const { data, error } = await supabase.rpc('cancel_volunteer_registration', {
      p_registration_id: regId,
      p_phone: phone,
      p_email: email,
    });

    setCancellingId(null);

    if (error) {
      setErrorMsg(error.message || '取消報名失敗');
      return;
    }

    const promoted = (data as { promoted_waitlist_id?: string | null })?.promoted_waitlist_id;
    setSuccessMsg(
      promoted
        ? '已成功取消您的報名，系統並已自動將第一順位候補志工遞補為正取！'
        : '已成功取消您的報名紀錄。'
    );

    await performLookup(phone, email);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      {/* 標題與查詢表單 */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 shadow-sm space-y-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-extrabold text-slate-900 flex items-center gap-2">
            <Search className="h-6 w-6 text-emerald-600" />
            志工報名查詢與取消
          </h1>
          <p className="text-sm text-slate-500">
            請輸入您報名時填寫的「手機號碼」與「電子信箱」，即可查看正取/候補狀態或取消報名。
          </p>
        </div>

        <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-5">
          <div className="sm:col-span-2">
            <label htmlFor="lookupPhone" className="block text-xs font-semibold text-slate-700 mb-1">
              手機號碼 <span className="text-red-500">*</span>
            </label>
            <input
              id="lookupPhone"
              type="tel"
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="0912345678"
              className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/20"
            />
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="lookupEmail" className="block text-xs font-semibold text-slate-700 mb-1">
              電子信箱 Email <span className="text-red-500">*</span>
            </label>
            <input
              id="lookupEmail"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/20"
            />
          </div>

          <div className="flex items-end">
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50"
            >
              {loading ? '查詢中...' : '立即查詢'}
            </button>
          </div>
        </form>

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
      </section>

      {/* 查詢結果清單 */}
      {results !== null && (
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-slate-900">
              查詢結果（共 {results.length} 筆報名紀錄）
            </h2>
          </div>

          {results.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center space-y-2">
              <p className="text-base font-medium text-slate-600">
                查無相符的報名紀錄
              </p>
              <p className="text-xs text-slate-400">
                請確認手機號碼與電子信箱是否與報名時完全一致，或前往首頁挑選志工活動報名。
              </p>
              <div className="pt-2">
                <Link
                  href="/"
                  className="inline-flex items-center rounded-xl bg-emerald-50 px-4 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
                >
                  瀏覽招募中的志工活動
                </Link>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {results.map((item) => {
                const statusMeta = getRegistrationStatusMeta(item.status);

                return (
                  <div
                    key={item.registration_id}
                    className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 pb-4">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span
                            className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-bold ${statusMeta.badgeClass}`}
                          >
                            {statusMeta.label}
                          </span>
                          {item.checked_in && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-bold text-blue-800">
                              <ShieldCheck className="h-3.5 w-3.5" />
                              已完成現場簽到
                            </span>
                          )}
                        </div>
                        <h3 className="text-lg font-bold text-slate-900 pt-1">
                          {item.event_title}
                        </h3>
                      </div>

                      <span className="text-xs text-slate-400">
                        報名時間：{new Date(item.created_at).toLocaleString('zh-TW')}
                      </span>
                    </div>

                    <div className="grid gap-3 text-sm sm:grid-cols-2">
                      <div className="flex items-center gap-2 text-slate-700">
                        <Calendar className="h-4 w-4 text-emerald-600 shrink-0" />
                        <span>活動日期：{item.event_date}</span>
                      </div>
                      <div className="flex items-center gap-2 text-slate-700">
                        <Clock className="h-4 w-4 text-emerald-600 shrink-0" />
                        <span className="font-semibold text-emerald-800">
                          {item.group_name} ({formatTimeRange(item.start_time, item.end_time)})
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-slate-700 sm:col-span-2">
                        <MapPin className="h-4 w-4 text-emerald-600 shrink-0" />
                        <span>集合地點：{item.event_location}</span>
                      </div>
                    </div>

                    <div className="grid gap-2 rounded-xl bg-slate-50 p-3.5 text-xs text-slate-600 sm:grid-cols-3">
                      <div>
                        <span className="text-slate-400">志工姓名：</span>
                        <span className="font-semibold text-slate-800">{item.volunteer_name}</span>
                      </div>
                      <div>
                        <span className="text-slate-400">身分證號：</span>
                        <span className="font-mono text-slate-800">{item.masked_id_number}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Utensils className="h-3.5 w-3.5 text-slate-400" />
                        <span className="text-slate-400">餐點：</span>
                        <span className="font-semibold text-slate-800">
                          {getDietaryLabel(item.dietary)}
                        </span>
                      </div>
                    </div>

                    {item.status !== 'cancelled' && !item.checked_in && (
                      <div className="flex justify-end pt-2">
                        <button
                          type="button"
                          disabled={cancellingId === item.registration_id}
                          onClick={() =>
                            handleCancelRegistration(
                              item.registration_id,
                              item.event_title,
                              item.group_name
                            )
                          }
                          className="inline-flex items-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-xs font-semibold text-red-700 transition hover:bg-red-100 disabled:opacity-50"
                        >
                          <XCircle className="h-4 w-4" />
                          {cancellingId === item.registration_id ? '取消處理中...' : '取消此筆報名'}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

export default function LookupPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-3xl h-64 animate-pulse rounded-2xl bg-white border border-slate-200 p-8" />
      }
    >
      <LookupContent />
    </Suspense>
  );
}
