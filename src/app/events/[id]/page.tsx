'use client';

import { useEffect, useState, FormEvent } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Calendar,
  MapPin,
  Clock,
  CheckCircle2,
  AlertCircle,
  ShieldAlert,
  Utensils,
  UserCheck,
  Sparkles,
} from 'lucide-react';
import { supabase, formatTimeRange, getEventStatusMeta } from '@/lib/supabase';
import type { VolunteerEvent, EventShift, DietaryType } from '@/types/database';

interface SubmitResult {
  registration_id: string;
  status: 'confirmed' | 'waitlist';
  waitlist_position: number;
  event_title: string;
  group_name: string;
}

export default function EventRegistrationPage() {
  const params = useParams();
  const eventId = params?.id as string;

  const [event, setEvent] = useState<VolunteerEvent | null>(null);
  const [shifts, setShifts] = useState<EventShift[]>([]);
  const [selectedShiftId, setSelectedShiftId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [submitResult, setSubmitResult] = useState<SubmitResult | null>(null);

  // 表單欄位狀態
  const [volunteerName, setVolunteerName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [idNumber, setIdNumber] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [dietary, setDietary] = useState<DietaryType>('meat');
  const [emergencyContact, setEmergencyContact] = useState('');
  const [emergencyPhone, setEmergencyPhone] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (eventId) {
      fetchEventDetail();
    }
  }, [eventId]);

  async function fetchEventDetail() {
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
      .eq('id', eventId)
      .single();

    if (error || !data) {
      setErrorMsg(error?.message || '找不到此活動資訊');
      setLoading(false);
      return;
    }

    const ev = data as VolunteerEvent;
    const sortedShifts = (ev.event_shifts || []).sort(
      (a, b) => a.sort_order - b.sort_order
    );

    setEvent(ev);
    setShifts(sortedShifts);

    // 預設選取第一個尚未完全額滿的組別
    const firstAvailable = sortedShifts.find(
      (s) =>
        s.confirmed_count < s.quota || s.waitlist_count < s.waitlist_quota
    );
    if (firstAvailable) {
      setSelectedShiftId(firstAvailable.id);
    }

    setLoading(false);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!selectedShiftId) {
      setErrorMsg('請先選擇您要報名的「服務時段與組別」');
      return;
    }

    setSubmitting(true);
    setErrorMsg('');

    const { data, error } = await supabase.rpc('submit_registration', {
      p_event_id: eventId,
      p_shift_id: selectedShiftId,
      p_volunteer_name: volunteerName,
      p_phone: phone,
      p_email: email,
      p_id_number: idNumber,
      p_birth_date: birthDate,
      p_dietary: dietary,
      p_emergency_contact: emergencyContact,
      p_emergency_phone: emergencyPhone,
      p_note: note,
    });

    setSubmitting(false);

    if (error) {
      setErrorMsg(error.message || '報名送出失敗，請稍後再試');
      return;
    }

    setSubmitResult(data as SubmitResult);
    await fetchEventDetail();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-40 animate-pulse rounded-2xl bg-white p-6 border border-slate-200" />
        <div className="h-96 animate-pulse rounded-2xl bg-white p-6 border border-slate-200" />
      </div>
    );
  }

  if (!event) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center">
        <p className="text-slate-600">{errorMsg || '找不到此活動'}</p>
        <Link
          href="/"
          className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-600 hover:underline"
        >
          <ArrowLeft className="h-4 w-4" /> 返回活動列表
        </Link>
      </div>
    );
  }

  const statusMeta = getEventStatusMeta(event.status);
  const selectedShift = shifts.find((s) => s.id === selectedShiftId);

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      {/* 返回按鈕 */}
      <div>
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 transition hover:text-emerald-600"
        >
          <ArrowLeft className="h-4 w-4" />
          返回志工活動列表
        </Link>
      </div>

      {/* 報名成功畫面 */}
      {submitResult && (
        <div className="rounded-2xl border-2 border-emerald-500 bg-emerald-50/70 p-6 sm:p-8 shadow-sm space-y-4">
          <div className="flex items-start gap-3.5">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white">
              <CheckCircle2 className="h-6 w-6" />
            </div>
            <div className="space-y-1">
              <div className="inline-flex items-center gap-2">
                <span className="text-lg font-extrabold text-slate-900">
                  報名資料已成功送出！
                </span>
                <span
                  className={`rounded-full px-3 py-0.5 text-xs font-bold ${
                    submitResult.status === 'confirmed'
                      ? 'bg-emerald-600 text-white'
                      : 'bg-amber-500 text-white'
                  }`}
                >
                  {submitResult.status === 'confirmed'
                    ? '🎉 正取成功'
                    : `⏳ 候補第 ${submitResult.waitlist_position} 順位`}
                </span>
              </div>
              <p className="text-sm text-slate-700">
                {submitResult.status === 'confirmed'
                  ? '您已成功錄取本場次志工！請於活動當日準時至集合地點辦理簽到。'
                  : '目前該組別正取名額已滿，系統已自動將您列入候補名單。若有正取志工取消，系統將依序自動遞補為正取！'}
              </p>
            </div>
          </div>

          <div className="rounded-xl bg-white p-4 text-sm border border-emerald-200 grid gap-2 sm:grid-cols-2">
            <div>
              <span className="text-slate-500">報名活動：</span>
              <span className="font-semibold text-slate-900">{submitResult.event_title}</span>
            </div>
            <div>
              <span className="text-slate-500">報名組別：</span>
              <span className="font-semibold text-emerald-700">{submitResult.group_name}</span>
            </div>
            <div>
              <span className="text-slate-500">志工姓名：</span>
              <span className="font-semibold text-slate-900">{volunteerName}</span>
            </div>
            <div>
              <span className="text-slate-500">查詢憑證：</span>
              <span className="font-semibold text-slate-900">
                {phone} / {email}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap gap-3 pt-2">
            <Link
              href={`/lookup?phone=${encodeURIComponent(phone)}&email=${encodeURIComponent(email)}`}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700"
            >
              前往「報名查詢 / 取消」頁面查看
            </Link>
            <button
              type="button"
              onClick={() => setSubmitResult(null)}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              繼續報名其他時段組別
            </button>
          </div>
        </div>
      )}

      {/* 活動主資訊卡 */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 shadow-sm space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span
            className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${statusMeta.badgeClass}`}
          >
            {statusMeta.label}
          </span>
          {event.registration_deadline && (
            <span className="text-xs text-slate-500">
              報名截止：{new Date(event.registration_deadline).toLocaleDateString('zh-TW')}
            </span>
          )}
        </div>

        <h1 className="text-2xl font-extrabold text-slate-900 sm:text-3xl">
          {event.title}
        </h1>

        {event.description && (
          <p className="whitespace-pre-line text-sm leading-relaxed text-slate-600">
            {event.description}
          </p>
        )}

        <div className="grid gap-3 rounded-xl bg-slate-50 p-4 text-sm sm:grid-cols-2">
          <div className="flex items-center gap-2.5">
            <Calendar className="h-5 w-5 text-emerald-600 shrink-0" />
            <div>
              <div className="text-xs text-slate-500">活動舉辦日期</div>
              <div className="font-semibold text-slate-900">{event.event_date}</div>
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            <MapPin className="h-5 w-5 text-emerald-600 shrink-0" />
            <div>
              <div className="text-xs text-slate-500">集合與服務地點</div>
              <div className="font-semibold text-slate-900">{event.location}</div>
            </div>
          </div>
        </div>
      </section>

      {/* 線上報名表單 */}
      {event.status === 'open' ? (
        <form
          onSubmit={handleSubmit}
          className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 shadow-sm space-y-8"
        >
          <div className="border-b border-slate-100 pb-4">
            <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
              <UserCheck className="h-5 w-5 text-emerald-600" />
              填寫志工報名表
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              免註冊帳號即可直接報名。正取名額額滿時，系統將自動為您排入候補名單。
            </p>
          </div>

          {errorMsg && (
            <div className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              <AlertCircle className="h-5 w-5 shrink-0 text-red-600 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Step 1: 選擇時段與組別 */}
          <div className="space-y-3">
            <label className="block text-sm font-bold text-slate-900">
              1. 選擇服務時段與組別 <span className="text-red-500">*</span>
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              {shifts.map((shift) => {
                const remaining = Math.max(0, shift.quota - shift.confirmed_count);
                const waitlistRemaining = Math.max(
                  0,
                  shift.waitlist_quota - shift.waitlist_count
                );
                const isFull = remaining === 0 && waitlistRemaining === 0;
                const isSelected = selectedShiftId === shift.id;

                return (
                  <label
                    key={shift.id}
                    className={`relative flex cursor-pointer flex-col justify-between rounded-xl border-2 p-4 transition ${
                      isFull
                        ? 'cursor-not-allowed border-slate-200 bg-slate-100 opacity-60'
                        : isSelected
                        ? 'border-emerald-600 bg-emerald-50/40 ring-2 ring-emerald-500/20'
                        : 'border-slate-200 bg-white hover:border-emerald-300'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="shift"
                          value={shift.id}
                          disabled={isFull}
                          checked={isSelected}
                          onChange={() => setSelectedShiftId(shift.id)}
                          className="h-4 w-4 text-emerald-600 focus:ring-emerald-500"
                        />
                        <span className="font-bold text-slate-900 text-sm">
                          {shift.group_name}
                        </span>
                      </div>
                    </div>

                    <div className="mt-3 flex items-center justify-between text-xs pl-6">
                      <span className="inline-flex items-center gap-1 text-slate-600">
                        <Clock className="h-3.5 w-3.5 text-emerald-600" />
                        {formatTimeRange(shift.start_time, shift.end_time)}
                      </span>

                      {remaining > 0 ? (
                        <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 font-semibold text-emerald-800">
                          正取尚餘 {remaining} 名 (共 {shift.quota} 名)
                        </span>
                      ) : waitlistRemaining > 0 ? (
                        <span className="rounded-full bg-amber-100 px-2.5 py-0.5 font-semibold text-amber-800">
                          正取已滿・開放候補 (尚餘 {waitlistRemaining} 名)
                        </span>
                      ) : (
                        <span className="rounded-full bg-slate-200 px-2.5 py-0.5 font-semibold text-slate-600">
                          名額與候補皆已滿
                        </span>
                      )}
                    </div>
                  </label>
                );
              })}
            </div>
            {selectedShift && selectedShift.confirmed_count >= selectedShift.quota && (
              <div className="flex items-center gap-2 rounded-lg bg-amber-50 px-3.5 py-2 text-xs text-amber-800 border border-amber-200">
                <Sparkles className="h-4 w-4 shrink-0 text-amber-600" />
                <span>
                  注意：您選擇的「{selectedShift.group_name}」目前正取已滿，送出後系統將自動為您排入<strong>候補名單</strong>。
                </span>
              </div>
            )}
          </div>

          {/* Step 2: 志工基本聯絡資料 */}
          <div className="space-y-4">
            <h3 className="text-sm font-bold text-slate-900">
              2. 志工基本與聯絡資料
            </h3>

            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label htmlFor="volunteerName" className="block text-xs font-semibold text-slate-700">
                  志工姓名 <span className="text-red-500">*</span>
                </label>
                <span id="name-hint" className="block text-[11px] text-slate-500 mb-1">
                  請填寫真實中文或英文全名
                </span>
                <input
                  id="volunteerName"
                  type="text"
                  required
                  value={volunteerName}
                  onChange={(e) => setVolunteerName(e.target.value)}
                  aria-describedby="name-hint"
                  placeholder="例：王大明"
                  className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/20"
                />
              </div>

              <div>
                <label htmlFor="phone" className="block text-xs font-semibold text-slate-700">
                  手機號碼 <span className="text-red-500">*</span>
                </label>
                <span id="phone-hint" className="block text-[11px] text-slate-500 mb-1">
                  格式：0912345678（供查詢與聯繫）
                </span>
                <input
                  id="phone"
                  type="tel"
                  required
                  pattern="09[0-9]{2}[-\s]?[0-9]{3}[-\s]?[0-9]{3}"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  aria-describedby="phone-hint"
                  placeholder="0912345678"
                  className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/20"
                />
                <p className="field-error-msg mt-1 text-xs text-red-600">
                  請輸入有效的 10 碼台灣手機號碼（09 開頭）
                </p>
              </div>

              <div>
                <label htmlFor="email" className="block text-xs font-semibold text-slate-700">
                  電子信箱 Email <span className="text-red-500">*</span>
                </label>
                <span id="email-hint" className="block text-[11px] text-slate-500 mb-1">
                  供日後查詢或取消報名雙重驗證
                </span>
                <input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  aria-describedby="email-hint"
                  placeholder="you@example.com"
                  className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/20"
                />
                <p className="field-error-msg mt-1 text-xs text-red-600">
                  請輸入正確的 Email 格式
                </p>
              </div>
            </div>
          </div>

          {/* Step 3: 志工平安保險與緊急聯絡人 */}
          <div className="space-y-4 rounded-xl border border-slate-200 bg-slate-50/70 p-4 sm:p-5">
            <div className="flex items-start gap-2">
              <ShieldAlert className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  3. 志工保險與緊急聯絡人資料
                </h3>
                <p className="text-xs text-slate-500">
                  本資料僅供主辦單位辦理活動當日「志工團體平安保險」與緊急聯繫使用，受資料庫 RLS 權限嚴格保護，不對外公開。
                </p>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="idNumber" className="block text-xs font-semibold text-slate-700">
                  身分證字號 / 居留證號 <span className="text-red-500">*</span>
                </label>
                <span id="id-hint" className="block text-[11px] text-slate-500 mb-1">
                  投保平安險必填，前台查詢時將自動遮罩保護
                </span>
                <input
                  id="idNumber"
                  type="text"
                  required
                  minLength={8}
                  maxLength={12}
                  value={idNumber}
                  onChange={(e) => setIdNumber(e.target.value.toUpperCase())}
                  aria-describedby="id-hint"
                  placeholder="例：A123456789"
                  className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm uppercase outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/20"
                />
              </div>

              <div>
                <label htmlFor="birthDate" className="block text-xs font-semibold text-slate-700">
                  出生年月日 <span className="text-red-500">*</span>
                </label>
                <span id="birth-hint" className="block text-[11px] text-slate-500 mb-1">
                  辦理志工保險必填
                </span>
                <input
                  id="birthDate"
                  type="date"
                  required
                  value={birthDate}
                  onChange={(e) => setBirthDate(e.target.value)}
                  aria-describedby="birth-hint"
                  className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/20"
                />
              </div>

              <div>
                <label htmlFor="emergencyContact" className="block text-xs font-semibold text-slate-700">
                  緊急聯絡人姓名與關係 <span className="text-red-500">*</span>
                </label>
                <span id="ec-hint" className="block text-[11px] text-slate-500 mb-1">
                  例：王美麗（母親）
                </span>
                <input
                  id="emergencyContact"
                  type="text"
                  required
                  value={emergencyContact}
                  onChange={(e) => setEmergencyContact(e.target.value)}
                  aria-describedby="ec-hint"
                  placeholder="例：王美麗（母親）"
                  className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/20"
                />
              </div>

              <div>
                <label htmlFor="emergencyPhone" className="block text-xs font-semibold text-slate-700">
                  緊急聯絡人電話 <span className="text-red-500">*</span>
                </label>
                <span id="ep-hint" className="block text-[11px] text-slate-500 mb-1">
                  請填寫可隨時聯繫之手機或市話
                </span>
                <input
                  id="emergencyPhone"
                  type="tel"
                  required
                  value={emergencyPhone}
                  onChange={(e) => setEmergencyPhone(e.target.value)}
                  aria-describedby="ep-hint"
                  placeholder="例：0987654321"
                  className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/20"
                />
              </div>
            </div>
          </div>

          {/* Step 4: 餐點需求與備註 */}
          <div className="space-y-4">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
              <Utensils className="h-4 w-4 text-emerald-600" />
              4. 活動餐點需求與備註
            </h3>

            <div className="grid gap-3 sm:grid-cols-3">
              {(
                [
                  { value: 'meat', label: '🍱 葷食便當', desc: '一般葷食餐點' },
                  { value: 'vegetarian', label: '🥗 素食便當', desc: '全素 / 蛋奶素皆可食用' },
                  { value: 'none', label: '🚫 不需供餐', desc: '自行準備或該時段無須用餐' },
                ] as const
              ).map((option) => (
                <label
                  key={option.value}
                  className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3.5 text-sm transition ${
                    dietary === option.value
                      ? 'border-emerald-600 bg-emerald-50/50 ring-1 ring-emerald-600'
                      : 'border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <input
                    type="radio"
                    name="dietary"
                    value={option.value}
                    checked={dietary === option.value}
                    onChange={() => setDietary(option.value)}
                    className="h-4 w-4 text-emerald-600"
                  />
                  <div>
                    <div className="font-semibold text-slate-900">{option.label}</div>
                    <div className="text-xs text-slate-500">{option.desc}</div>
                  </div>
                </label>
              ))}
            </div>

            <div>
              <label htmlFor="note" className="block text-xs font-semibold text-slate-700 mb-1">
                備註或相關服務專長（選填）
              </label>
              <textarea
                id="note"
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="例如：具急救證照、外語能力、食物過敏說明或同行親友姓名..."
                className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/20"
              />
            </div>
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={submitting || !selectedShiftId}
              className="w-full rounded-xl bg-emerald-600 px-6 py-3.5 text-base font-bold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? '正在送出報名資料...' : '確認送出志工報名'}
            </button>
          </div>
        </form>
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-slate-100 p-8 text-center text-slate-600">
          本活動目前已截止報名。若您先前已完成報名，可前往{' '}
          <Link href="/lookup" className="font-semibold text-emerald-700 underline">
            報名查詢 / 取消
          </Link>{' '}
          查看錄取狀態。
        </div>
      )}
    </div>
  );
}
