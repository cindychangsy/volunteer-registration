'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Download,
  Upload,
  UserPlus,
  Search,
  CheckCircle2,
  UserCheck,
  Utensils,
  Calendar,
  MapPin,
  Clock,
  AlertCircle,
  RefreshCw,
  Shield,
  PhoneCall,
  FileSpreadsheet,
  X,
  HelpCircle,
} from 'lucide-react';
import {
  supabase,
  formatTimeRange,
  getDietaryLabel,
  getRegistrationStatusMeta,
  getVolunteerRoleMeta,
} from '@/lib/supabase';
import {
  getAdminSession,
  recordAdminAction,
  getEffectiveRegistrationRole,
  updateVolunteerRole,
} from '@/lib/audit';
import type {
  VolunteerEvent,
  EventShift,
  Registration,
  RegistrationStatus,
  DietaryType,
  VolunteerRole,
} from '@/types/database';

// 正規化電話號碼（自動去除單引號、空白、破折號，並修補 Excel 吃掉開頭 0 的 9 碼手機號碼）
function normalizePhoneNumber(raw: string): string {
  const cleaned = (raw || '')
    .trim()
    .replace(/^'+/, '')
    .replace(/[\s\-()]/g, '');
  if (/^9\d{8}$/.test(cleaned)) {
    return `0${cleaned}`;
  }
  return cleaned;
}

// 解析生日（支援西元年 YYYY-MM-DD、YYYY/MM/DD、8碼數字，以及台灣長輩常用的民國年如 42/05/10、民國42年5月10日）
function normalizeBirthDate(raw: string): string {
  const trimmed = (raw || '').trim().replace(/^'+/, '');
  if (!trimmed) return '1955-01-01';

  // 處理「民國42年5月10日」或「42年5月10日」格式
  const rocChineseMatch = trimmed.match(
    /(?:民國)?\s*(\d{2,3})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?/
  );
  if (rocChineseMatch) {
    const year = parseInt(rocChineseMatch[1], 10) + 1911;
    const month = rocChineseMatch[2].padStart(2, '0');
    const day = rocChineseMatch[3].padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  // 處理以 / 或 - 或 . 分隔的日期 (如 1953/5/10 或 42/05/10)
  const parts = trimmed.split(/[\/\-.]/);
  if (parts.length === 3) {
    let y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    const d = parseInt(parts[2], 10);
    if (!isNaN(y) && !isNaN(m) && !isNaN(d) && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      if (y < 1900) {
        y += 1911; // 民國年轉西元年
      }
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }

  // 處理 Excel 日期序列值 (5 碼數字，例如在 Excel 往下拉複製時 2015/1/1 變成 42005)
  const digits = trimmed.replace(/\D/g, '');
  if (/^\d{5}$/.test(trimmed)) {
    const excelSerial = parseInt(trimmed, 10);
    if (excelSerial >= 10000 && excelSerial <= 65000) {
      const utcDays = excelSerial - 25569;
      const dateObj = new Date(utcDays * 86400 * 1000);
      if (!isNaN(dateObj.getTime())) {
        return dateObj.toISOString().slice(0, 10);
      }
    }
  }

  // 處理純數字 7 碼 (如 0420510) 或 8 碼 (如 19530510)
  if (digits.length === 7) {
    const y = parseInt(digits.slice(0, 3), 10) + 1911;
    const m = digits.slice(3, 5);
    const d = digits.slice(5, 7);
    return `${y}-${m}-${d}`;
  }
  if (digits.length === 8) {
    const y = digits.slice(0, 4);
    const m = digits.slice(4, 6);
    const d = digits.slice(6, 8);
    return `${y}-${m}-${d}`;
  }

  return '1955-01-01';
}

// 解析飲食需求文字
function parseDietaryText(raw: string): DietaryType {
  const t = (raw || '').trim().toLowerCase();
  if (t.includes('素') || t === 'vegetarian' || t === 'veg') {
    return 'vegetarian';
  }
  if (t.includes('不') || t.includes('無') || t === 'none') {
    return 'none';
  }
  return 'meat';
}

// 解析錄取狀態文字
function parseRegistrationStatusText(raw: string): RegistrationStatus | null {
  const t = (raw || '').trim().toLowerCase();
  if (!t) return null;
  if (t.includes('候補') || t === 'waitlist') return 'waitlist';
  if (t.includes('取消') || t === 'cancelled' || t === 'canceled') {
    return 'cancelled';
  }
  if (t.includes('正取') || t === 'confirmed') return 'confirmed';
  return null;
}

// 解析後台管理權限文字
function parseVolunteerRoleText(raw: string): VolunteerRole {
  const t = (raw || '').trim().toLowerCase();
  if (t.includes('最高') || t === 'super_admin') return 'super_admin';
  if (t.includes('幹部') || t.includes('管理') || t === 'staff_admin') {
    return 'staff_admin';
  }
  return 'volunteer';
}

// RFC-4180 標準 CSV 解析器（支援引號內逗號、換行與雙引號跳脫）
function parseCsvRows(csvText: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = '';
  let inQuotes = false;

  const text = csvText.replace(/^\uFEFF/, '');

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const nextCh = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && nextCh === '"') {
        currentCell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        currentCell += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        currentRow.push(currentCell.trim());
        currentCell = '';
      } else if (ch === '\r' && nextCh === '\n') {
        currentRow.push(currentCell.trim());
        if (currentRow.some((cell) => cell !== '')) {
          rows.push(currentRow);
        }
        currentRow = [];
        currentCell = '';
        i++;
      } else if (ch === '\n' || ch === '\r') {
        currentRow.push(currentCell.trim());
        if (currentRow.some((cell) => cell !== '')) {
          rows.push(currentRow);
        }
        currentRow = [];
        currentCell = '';
      } else {
        currentCell += ch;
      }
    }
  }

  currentRow.push(currentCell.trim());
  if (currentRow.some((cell) => cell !== '')) {
    rows.push(currentRow);
  }

  return rows;
}

export default function AdminEventRegistrationsPage() {
  const params = useParams();
  const router = useRouter();
  const eventId = params?.id as string;
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [adminName, setAdminName] = useState<string>('');
  const [adminRole, setAdminRole] = useState<VolunteerRole>('super_admin');
  const [event, setEvent] = useState<VolunteerEvent | null>(null);
  const [shifts, setShifts] = useState<EventShift[]>([]);
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [loading, setLoading] = useState(true);
  const [importingCsv, setImportingCsv] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [showCsvGuide, setShowCsvGuide] = useState(false);

  // 電話代客報名 (人工單筆新增) 表單狀態
  const [showManualModal, setShowManualModal] = useState(false);
  const [manualSubmitting, setManualSubmitting] = useState(false);
  const [manualShiftId, setManualShiftId] = useState('');
  const [manualName, setManualName] = useState('');
  const [manualPhone, setManualPhone] = useState('');
  const [manualIdNumber, setManualIdNumber] = useState('');
  const [manualBirthDate, setManualBirthDate] = useState('');
  const [manualDietary, setManualDietary] = useState<DietaryType>('meat');
  const [manualEmergencyName, setManualEmergencyName] = useState('');
  const [manualEmergencyPhone, setManualEmergencyPhone] = useState('');
  const [manualEmail, setManualEmail] = useState('');
  const [manualStatus, setManualStatus] =
    useState<RegistrationStatus>('confirmed');
  const [manualNote, setManualNote] = useState('長輩來電・管理員人工代客報名');

  // 篩選條件
  const [selectedShiftId, setSelectedShiftId] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | RegistrationStatus>(
    'all'
  );
  const [checkinFilter, setCheckinFilter] = useState<
    'all' | 'checked' | 'unchecked'
  >('all');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    const session = getAdminSession();
    if (!session) {
      router.replace('/admin/login');
      return;
    }
    setAdminName(session.adminName);
    setAdminRole(session.role || 'super_admin');

    if (eventId) {
      fetchEventAndRegistrations();
    }
  }, [eventId, router]);

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
    if (sortedShifts.length > 0 && !manualShiftId) {
      setManualShiftId(sortedShifts[0].id);
    }
    setRegistrations((regRes.data as Registration[]) || []);
    setLoading(false);
  }

  // 共用單筆寫入或更新邏輯（同時支援直接 INSERT 與 RPC 備援，確保資料庫皆可寫入）
  async function upsertSingleRegistration(
    params: {
      shiftId: string;
      volunteerName: string;
      phone: string;
      email: string;
      idNumber: string;
      birthDate: string;
      dietary: DietaryType;
      emergencyContact: string;
      emergencyPhone: string;
      note: string;
      status: RegistrationStatus;
      checkedIn: boolean;
      checkedInAt: string | null;
      role?: VolunteerRole;
    },
    currentRegsList: Registration[] = registrations
  ): Promise<{ mode: 'inserted' | 'updated'; regId?: string; error?: string }> {
    const cleanName = (params.volunteerName || '').trim();
    const cleanPhone = normalizePhoneNumber(params.phone);
    const cleanIdNum = (params.idNumber || '').trim().toUpperCase();

    // 重要防呆：只有當「同一組別」且「志工姓名相同」時，才視為更新既有志工資料！
    // 避免管理員在 Excel 往下拉複製上一列（忘記改身分證字號或家人共用電話）時，誤把前一位志工覆蓋掉。
    const existing = currentRegsList.find(
      (r) =>
        r.shift_id === params.shiftId &&
        r.volunteer_name.trim() === cleanName &&
        ((cleanPhone && normalizePhoneNumber(r.phone) === cleanPhone) ||
          (cleanIdNum &&
            !cleanIdNum.startsWith('TEMP') &&
            r.id_number.trim().toUpperCase() === cleanIdNum) ||
          true)
    );

    if (existing) {
      const { error: upErr } = await supabase
        .from('registrations')
        .update({
          volunteer_name: params.volunteerName,
          phone: cleanPhone,
          email: params.email,
          id_number: cleanIdNum || existing.id_number,
          birth_date: params.birthDate || existing.birth_date,
          dietary: params.dietary,
          emergency_contact:
            params.emergencyContact || existing.emergency_contact,
          emergency_phone: params.emergencyPhone || existing.emergency_phone,
          note: params.note !== undefined ? params.note : existing.note,
          status: params.status,
          checked_in: params.checkedIn,
          checked_in_at: params.checkedIn
            ? params.checkedInAt || existing.checked_in_at || new Date().toISOString()
            : null,
        })
        .eq('id', existing.id);

      if (upErr) {
        return { mode: 'updated', error: upErr.message };
      }

      if (params.role && params.role !== 'volunteer') {
        await updateVolunteerRole({
          operatorName: adminName || '管理員',
          reg: { ...existing, volunteer_name: params.volunteerName, phone: cleanPhone },
          newRole: params.role,
        });
      }

      return { mode: 'updated', regId: existing.id };
    }

    // 新增報名：優先直接寫入 registrations 資料表
    const { data: insData, error: insErr } = await supabase
      .from('registrations')
      .insert([
        {
          event_id: eventId,
          shift_id: params.shiftId,
          volunteer_name: params.volunteerName,
          phone: cleanPhone,
          email: params.email,
          id_number: cleanIdNum,
          birth_date: params.birthDate,
          dietary: params.dietary,
          emergency_contact: params.emergencyContact,
          emergency_phone: params.emergencyPhone,
          note: params.note,
          status: params.status,
          checked_in: params.checkedIn,
          checked_in_at: params.checkedIn
            ? params.checkedInAt || new Date().toISOString()
            : null,
        },
      ])
      .select('id')
      .single();

    let newRegId = insData?.id as string | undefined;

    // 若因尚未執行 admin_audit.sql 的 RLS 政策而無法直接 insert，自動退回呼叫 SECURITY DEFINER 的 submit_registration RPC
    if (insErr) {
      const { data: rpcData, error: rpcErr } = await supabase.rpc(
        'submit_registration',
        {
          p_event_id: eventId,
          p_shift_id: params.shiftId,
          p_volunteer_name: params.volunteerName,
          p_phone: cleanPhone,
          p_email: params.email,
          p_id_number: cleanIdNum,
          p_birth_date: params.birthDate,
          p_dietary: params.dietary,
          p_emergency_contact: params.emergencyContact,
          p_emergency_phone: params.emergencyPhone,
          p_note: params.note,
        }
      );

      if (rpcErr) {
        return { mode: 'inserted', error: rpcErr.message || insErr.message };
      }

      newRegId = (rpcData as { registration_id?: string })?.registration_id;

      // 若管理員指定了特定錄取狀態或已簽到，補做一次 update
      if (newRegId && (params.status !== 'confirmed' || params.checkedIn)) {
        await supabase
          .from('registrations')
          .update({
            status: params.status,
            checked_in: params.checkedIn,
            checked_in_at: params.checkedIn
              ? params.checkedInAt || new Date().toISOString()
              : null,
          })
          .eq('id', newRegId);
      }
    }

    if (newRegId && params.role && params.role !== 'volunteer') {
      await updateVolunteerRole({
        operatorName: adminName || '管理員',
        reg: {
          id: newRegId,
          event_id: eventId,
          shift_id: params.shiftId,
          volunteer_name: params.volunteerName,
          phone: cleanPhone,
          email: params.email,
          id_number: cleanIdNum,
          birth_date: params.birthDate,
          dietary: params.dietary,
          emergency_contact: params.emergencyContact,
          emergency_phone: params.emergencyPhone,
          note: params.note,
          status: params.status,
          checked_in: params.checkedIn,
          checked_in_at: null,
          created_at: new Date().toISOString(),
        },
        newRole: params.role,
      });
    }

    return { mode: 'inserted', regId: newRegId };
  }

  // 處理電話代客報名 (單筆人工登錄)
  async function handleManualRegisterSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');

    const cleanName = manualName.trim();
    const cleanPhone = normalizePhoneNumber(manualPhone);
    const targetShiftId = manualShiftId || shifts[0]?.id;

    if (!targetShiftId) {
      setErrorMsg('請選擇要報名的服務組別與時段');
      return;
    }
    if (!cleanName || !cleanPhone) {
      setErrorMsg('請至少填寫「志工姓名」與「聯絡電話/手機」');
      return;
    }

    setManualSubmitting(true);

    const finalEmail =
      manualEmail.trim() || `phone-${cleanPhone}@volunteer.local`;
    const finalIdNumber =
      manualIdNumber.trim().toUpperCase() || `TEMP${cleanPhone.slice(-6)}`;
    const finalBirthDate = normalizeBirthDate(manualBirthDate);
    const finalEmergencyName =
      manualEmergencyName.trim() || `${cleanName}家屬(電話代填)`;
    const finalEmergencyPhone =
      normalizePhoneNumber(manualEmergencyPhone) || cleanPhone;

    const result = await upsertSingleRegistration({
      shiftId: targetShiftId,
      volunteerName: cleanName,
      phone: cleanPhone,
      email: finalEmail,
      idNumber: finalIdNumber,
      birthDate: finalBirthDate,
      dietary: manualDietary,
      emergencyContact: finalEmergencyName,
      emergencyPhone: finalEmergencyPhone,
      note: manualNote.trim() || '長輩來電・管理員人工代客報名',
      status: manualStatus,
      checkedIn: false,
      checkedInAt: null,
    });

    setManualSubmitting(false);

    if (result.error) {
      setErrorMsg(`人工代客報名失敗：${result.error}`);
      return;
    }

    const shiftObj = shifts.find((s) => s.id === targetShiftId);
    await recordAdminAction({
      adminName: adminName || '管理員',
      actionType: 'MANUAL_REGISTER',
      actionLabel: '電話代客報名 (人工登錄)',
      targetName: `${cleanName} (${cleanPhone})`,
      details: `管理員「${adminName}」為長輩/志工「${cleanName}」人工登錄報名活動「${
        event?.title || ''
      }」組別「${shiftObj?.group_name || ''}」（${
        result.mode === 'inserted' ? '新增報名' : '更新既有報名'
      }）`,
    });

    setSuccessMsg(
      `已成功為志工「${cleanName} (${cleanPhone})」完成${
        result.mode === 'inserted' ? '電話代客報名' : '報名資料更新'
      }！`
    );

    // 重置表單並關閉視窗
    setManualName('');
    setManualPhone('');
    setManualIdNumber('');
    setManualBirthDate('');
    setManualEmergencyName('');
    setManualEmergencyPhone('');
    setManualEmail('');
    setShowManualModal(false);

    await fetchEventAndRegistrations();
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

    await recordAdminAction({
      adminName: adminName || '管理員',
      actionType: nextChecked ? 'CHECK_IN' : 'UNCHECK_IN',
      actionLabel: nextChecked ? '志工簽到打卡' : '取消志工簽到',
      targetName: `${reg.volunteer_name} (${reg.phone})`,
      details: `活動「${event?.title || ''}」- 組別「${
        reg.event_shifts?.group_name || ''
      }」：將志工「${reg.volunteer_name}」設為${
        nextChecked ? '已簽到' : '未簽到'
      }`,
    });

    setRegistrations((prev) =>
      prev.map((r) =>
        r.id === reg.id
          ? { ...r, checked_in: nextChecked, checked_in_at: nextTime }
          : r
      )
    );
  }

  async function handleChangeStatus(
    reg: Registration,
    newStatus: RegistrationStatus
  ) {
    const oldLabel = getRegistrationStatusMeta(reg.status).label;
    const newLabel = getRegistrationStatusMeta(newStatus).label;

    const { error } = await supabase
      .from('registrations')
      .update({ status: newStatus })
      .eq('id', reg.id);

    if (error) {
      setErrorMsg(`變更錄取狀態失敗：${error.message}`);
      return;
    }

    await recordAdminAction({
      adminName: adminName || '管理員',
      actionType: 'CHANGE_REG_STATUS',
      actionLabel: '變更志工錄取狀態',
      targetName: `${reg.volunteer_name} (${reg.phone})`,
      details: `活動「${event?.title || ''}」：將志工「${
        reg.volunteer_name
      }」的狀態由「${oldLabel}」變更為「${newLabel}」`,
    });

    await fetchEventAndRegistrations();
  }

  async function handleRoleChange(reg: Registration, newRole: VolunteerRole) {
    setErrorMsg('');
    setSuccessMsg('');

    await updateVolunteerRole({
      operatorName: adminName || '管理員',
      reg,
      newRole,
    });

    const roleMeta = getVolunteerRoleMeta(newRole);
    const { adminPin } = getEffectiveRegistrationRole(reg);
    setSuccessMsg(
      newRole === 'volunteer'
        ? `已將志工「${reg.volunteer_name}」的權限設為「一般志工」（無後台進入權限）。`
        : `已將志工「${reg.volunteer_name}」授權為「${roleMeta.shortLabel}」！該志工可憑姓名「${reg.volunteer_name}」（或手機 ${reg.phone}）與密碼「${adminPin}」登入管理後台。`
    );

    setRegistrations((prev) => [...prev]);
  }

  // 篩選後的名單
  const filteredList = registrations.filter((reg) => {
    const matchShift =
      selectedShiftId === 'all' || reg.shift_id === selectedShiftId;
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

  // 匯出 CSV (含 UTF-8 BOM 防止 Excel 中文亂碼；若目前為 0 筆資料也會匯出欄位標題與範例列，方便人工輸入後再匯入)
  async function handleExportCSV() {
    if (!event) return;

    const headers = [
      '錄取狀態',
      '後台管理權限',
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

    let rows: string[] = [];

    if (filteredList.length > 0) {
      rows = filteredList.map((r) => {
        const statusLabel = getRegistrationStatusMeta(r.status).label;
        const effRole = getEffectiveRegistrationRole(r).role;
        const roleLabel = getVolunteerRoleMeta(effRole).shortLabel;
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
          escapeCsv(roleLabel),
          escapeCsv(checkedLabel),
          escapeCsv(checkedTime),
          escapeCsv(groupName),
          escapeCsv(timeRange),
          escapeCsv(r.volunteer_name),
          escapeCsv(`'${r.phone}`),
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
    } else {
      // 當目前尚無志工報名時，自動產生一列範例格式，方便管理員在 Excel 直接往下新增長輩資料
      const defaultShift = shifts[0];
      const sampleGroupName = defaultShift?.group_name || '早班 - 報到引導組';
      const sampleTimeRange = defaultShift
        ? formatTimeRange(defaultShift.start_time, defaultShift.end_time)
        : '08:00 - 12:00';
      rows = [
        [
          escapeCsv('正取'),
          escapeCsv('一般志工'),
          escapeCsv('未簽到'),
          escapeCsv(''),
          escapeCsv(sampleGroupName),
          escapeCsv(sampleTimeRange),
          escapeCsv('王長輩(範例列-匯入時會自動略過)'),
          escapeCsv("'0912345678"),
          escapeCsv(''),
          escapeCsv('A123456789'),
          escapeCsv('1950-05-15'),
          escapeCsv('葷食便當'),
          escapeCsv('王小明'),
          escapeCsv("'0987654321"),
          escapeCsv('電話代客報名範例'),
          escapeCsv(''),
        ].join(','),
      ];
    }

    const csvContent = '\uFEFF' + [headers.join(','), ...rows].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `${event.event_date}_${event.title}_志工名單(可新增後再匯入).csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    await recordAdminAction({
      adminName: adminName || '管理員',
      actionType: 'EXPORT_CSV',
      actionLabel: '匯出 CSV 名單',
      targetName: event.title,
      details: `管理員「${adminName}」匯出了活動「${event.title}」的志工名單 CSV（共 ${filteredList.length} 筆，可於 Excel 新增長輩資料後再匯入）`,
    });
  }

  // 匯入 CSV 名單（支援把匯出的 CSV 在 Excel 人工新增或修改後再匯入，自動防呆 UTF-8 / Big5 編碼）
  async function handleImportCSVFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !event) return;

    setErrorMsg('');
    setSuccessMsg('');
    setImportingCsv(true);

    try {
      const buffer = await file.arrayBuffer();
      let csvText = '';

      // 自動偵測 UTF-8 或 Windows Excel 預設的 Big5 (繁體中文 ANSI) 編碼
      try {
        csvText = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
      } catch {
        csvText = new TextDecoder('big5').decode(buffer);
      }

      const parsedRows = parseCsvRows(csvText);
      if (parsedRows.length < 2) {
        setErrorMsg('CSV 檔案內沒有可匯入的志工資料列，請確認已在 Excel 輸入資料並存檔。');
        setImportingCsv(false);
        e.target.value = '';
        return;
      }

      const headerRow = parsedRows[0].map((h) => h.replace(/^\uFEFF/, '').trim());

      // 智慧尋找欄位索引（支援本系統匯出之標準欄位名稱與常見簡稱）
      const findColIndex = (keywords: string[]) =>
        headerRow.findIndex((h) =>
          keywords.some((kw) => h.toLowerCase().includes(kw.toLowerCase()))
        );

      const idxStatus = findColIndex(['錄取狀態', '報名狀態', 'status']);
      const idxRole = findColIndex(['後台管理權限', '權限', 'role']);
      const idxCheckIn = findColIndex(['現場簽到', '簽到狀態', '簽到']);
      const idxGroup = findColIndex(['組別名稱', '服務組別', '組別', '時段組別']);
      const idxName = findColIndex(['志工姓名', '姓名', 'name']);
      const idxPhone = findColIndex(['手機號碼', '電話', '手機', '聯絡電話', 'phone']);
      const idxEmail = findColIndex(['電子信箱', '信箱', 'email']);
      const idxIdNum = findColIndex(['身分證', '居留證', 'id_number']);
      const idxBirth = findColIndex(['出生年月日', '出生日期', '生日', 'birth']);
      const idxDietary = findColIndex(['餐點需求', '飲食需求', '餐點', '飲食', '便當']);
      const idxEmgName = findColIndex(['緊急聯絡人']);
      // 區分「緊急聯絡人」與「緊急聯絡人電話」
      const idxEmgPhone = headerRow.findIndex(
        (h) => h.includes('緊急') && (h.includes('電話') || h.includes('手機'))
      );
      const idxNote = findColIndex(['備註', 'note']);

      if (idxName === -1 || idxPhone === -1) {
        setErrorMsg(
          'CSV 標題列缺少「志工姓名」或「手機號碼」欄位！建議直接點擊「匯出 CSV 名單」，在該檔案下方新增資料後再匯入。'
        );
        setImportingCsv(false);
        e.target.value = '';
        return;
      }

      let insertedCount = 0;
      let updatedCount = 0;
      let skippedCount = 0;
      const rowErrors: string[] = [];
      const workingRegs: Registration[] = [...registrations];

      for (let rIdx = 1; rIdx < parsedRows.length; rIdx++) {
        const row = parsedRows[rIdx];
        const rawName = (row[idxName] || '').trim();
        const rawPhone = idxPhone >= 0 ? row[idxPhone] || '' : '';
        const cleanPhone = normalizePhoneNumber(rawPhone);

        // 略過空白列或範例列
        if (!rawName && !cleanPhone) {
          continue;
        }
        if (rawName.includes('範例列') || rawName.includes('請刪除此列')) {
          skippedCount++;
          continue;
        }
        if (!rawName || !cleanPhone) {
          rowErrors.push(`第 ${rIdx + 1} 列：缺少志工姓名或手機號碼`);
          continue;
        }

        // 比對組別名稱（若留白或找不到完全相符，支援部分關鍵字比對或自動歸入第一個組別）
        const rawGroup = idxGroup >= 0 ? (row[idxGroup] || '').trim() : '';
        let matchedShift: EventShift | undefined;

        if (rawGroup) {
          matchedShift =
            shifts.find((s) => s.group_name.trim() === rawGroup) ||
            shifts.find(
              (s) =>
                s.group_name.includes(rawGroup) || rawGroup.includes(s.group_name)
            );
        }
        if (!matchedShift) {
          matchedShift =
            (selectedShiftId !== 'all'
              ? shifts.find((s) => s.id === selectedShiftId)
              : undefined) || shifts[0];
        }

        if (!matchedShift) {
          rowErrors.push(`第 ${rIdx + 1} 列（${rawName}）：此活動尚無任何服務組別`);
          continue;
        }

        const rawEmail = idxEmail >= 0 ? (row[idxEmail] || '').trim() : '';
        const finalEmail = rawEmail || `phone-${cleanPhone}@volunteer.local`;

        const rawIdNum =
          idxIdNum >= 0 ? (row[idxIdNum] || '').trim().toUpperCase() : '';
        const finalIdNum = rawIdNum || `TEMP${cleanPhone.slice(-6)}`;

        const rawBirth = idxBirth >= 0 ? row[idxBirth] || '' : '';
        const finalBirth = normalizeBirthDate(rawBirth);

        const rawDietary = idxDietary >= 0 ? row[idxDietary] || '' : '';
        const finalDietary = parseDietaryText(rawDietary);

        const rawEmgName =
          idxEmgName >= 0 && idxEmgName !== idxEmgPhone
            ? (row[idxEmgName] || '').trim()
            : '';
        const finalEmgName = rawEmgName || `${rawName}家屬(CSV匯入)`;

        const rawEmgPhone = idxEmgPhone >= 0 ? row[idxEmgPhone] || '' : '';
        const finalEmgPhone = normalizePhoneNumber(rawEmgPhone) || cleanPhone;

        const rawNote = idxNote >= 0 ? (row[idxNote] || '').trim() : '';
        const finalNote = rawNote || 'CSV名單匯入(管理員代登)';

        const rawStatus = idxStatus >= 0 ? row[idxStatus] || '' : '';
        const parsedStatus = parseRegistrationStatusText(rawStatus) || 'confirmed';

        const rawCheckIn = idxCheckIn >= 0 ? (row[idxCheckIn] || '').trim() : '';
        const isCheckedIn =
          rawCheckIn === '已簽到' ||
          rawCheckIn === '是' ||
          rawCheckIn.toLowerCase() === 'v' ||
          rawCheckIn.toLowerCase() === 'true' ||
          rawCheckIn === '1';

        const rawRole = idxRole >= 0 ? row[idxRole] || '' : '';
        const parsedRole = parseVolunteerRoleText(rawRole);

        const res = await upsertSingleRegistration(
          {
            shiftId: matchedShift.id,
            volunteerName: rawName,
            phone: cleanPhone,
            email: finalEmail,
            idNumber: finalIdNum,
            birthDate: finalBirth,
            dietary: finalDietary,
            emergencyContact: finalEmgName,
            emergencyPhone: finalEmgPhone,
            note: finalNote,
            status: parsedStatus,
            checkedIn: isCheckedIn,
            checkedInAt: isCheckedIn ? new Date().toISOString() : null,
            role: parsedRole,
          },
          workingRegs
        );

        if (res.error) {
          rowErrors.push(`第 ${rIdx + 1} 列（${rawName}）：${res.error}`);
        } else if (res.mode === 'inserted') {
          insertedCount++;
          workingRegs.push({
            id: res.regId || `temp-${rIdx}`,
            event_id: eventId,
            shift_id: matchedShift.id,
            volunteer_name: rawName,
            phone: cleanPhone,
            email: finalEmail,
            id_number: finalIdNum,
            birth_date: finalBirth,
            dietary: finalDietary,
            emergency_contact: finalEmgName,
            emergency_phone: finalEmgPhone,
            note: finalNote,
            status: parsedStatus,
            checked_in: isCheckedIn,
            checked_in_at: isCheckedIn ? new Date().toISOString() : null,
            created_at: new Date().toISOString(),
          });
        } else {
          updatedCount++;
        }
      }

      await recordAdminAction({
        adminName: adminName || '管理員',
        actionType: 'IMPORT_CSV',
        actionLabel: '匯入 CSV 志工名單',
        targetName: event.title,
        details: `管理員「${adminName}」於活動「${event.title}」匯入 CSV 檔案「${file.name}」：新增 ${insertedCount} 筆、同步更新既有資料 ${updatedCount} 筆${
          rowErrors.length > 0 ? `、失敗 ${rowErrors.length} 筆` : ''
        }`,
      });

      if (insertedCount > 0 || updatedCount > 0) {
        setSuccessMsg(
          `CSV 匯入完成！成功新增報名 ${insertedCount} 筆、同步更新既有志工資料 ${updatedCount} 筆${
            skippedCount > 0 ? `（自動略過範例列 ${skippedCount} 筆）` : ''
          }。`
        );
      }

      if (rowErrors.length > 0) {
        setErrorMsg(
          `部分資料列匯入提醒（共 ${rowErrors.length} 筆）：${rowErrors
            .slice(0, 3)
            .join('；')}`
        );
      }

      await fetchEventAndRegistrations();
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? `CSV 解析匯入失敗：${err.message}` : 'CSV 匯入發生錯誤'
      );
    } finally {
      setImportingCsv(false);
      e.target.value = '';
    }
  }

  // 統計數據（以正取志工統計餐點與簽到）
  const confirmedRegs = registrations.filter((r) => r.status === 'confirmed');
  const waitlistRegs = registrations.filter((r) => r.status === 'waitlist');
  const checkedInCount = confirmedRegs.filter((r) => r.checked_in).length;
  const meatCount = confirmedRegs.filter((r) => r.dietary === 'meat').length;
  const vegCount = confirmedRegs.filter(
    (r) => r.dietary === 'vegetarian'
  ).length;

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

        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-500">
            目前操作：<strong className="text-emerald-700">{adminName}</strong>{' '}
            ({getVolunteerRoleMeta(adminRole).shortLabel})
          </span>
          <button
            type="button"
            onClick={fetchEventAndRegistrations}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            重新整理名單
          </button>
        </div>
      </div>

      {/* 活動標題、電話代客報名、CSV 匯出與匯入操作區 */}
      {event && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
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

            {/* 三大核心按鈕：電話代客報名、匯入 CSV、匯出 CSV */}
            <div className="flex flex-wrap items-center gap-2.5">
              {/* 隱藏的 CSV 檔案上傳 Input */}
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                onChange={handleImportCSVFile}
                className="hidden"
              />

              <button
                type="button"
                onClick={() => setShowManualModal(true)}
                className="inline-flex items-center justify-center gap-2 rounded-xl border-2 border-emerald-600 bg-emerald-50 px-4 py-2.5 text-xs sm:text-sm font-bold text-emerald-800 shadow-sm transition hover:bg-emerald-100"
              >
                <PhoneCall className="h-4 w-4 text-emerald-700" />
                電話代客報名 (人工新增)
              </button>

              <button
                type="button"
                disabled={importingCsv}
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-xs sm:text-sm font-bold text-white shadow-sm transition hover:bg-indigo-700 disabled:opacity-50"
              >
                <Upload className="h-4 w-4" />
                {importingCsv ? '正在匯入 CSV...' : '匯入 CSV 名單 (新增/更新)'}
              </button>

              <button
                type="button"
                onClick={handleExportCSV}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs sm:text-sm font-bold text-white shadow-sm transition hover:bg-emerald-700"
              >
                <Download className="h-4 w-4" />
                匯出 CSV 名單 ({filteredList.length} 筆)
              </button>

              <button
                type="button"
                onClick={() => setShowCsvGuide((prev) => !prev)}
                className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-100"
                title="查看 CSV 匯出修改再匯入說明"
              >
                <HelpCircle className="h-4 w-4 text-slate-500" />
                CSV 匯入說明
              </button>
            </div>
          </div>

          {/* 貼心提示列：長輩來電人工登錄與 CSV 雙向匯入說明 */}
          <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 px-4 py-3 text-xs text-indigo-950 flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 font-bold text-indigo-900">
                <FileSpreadsheet className="h-4 w-4 shrink-0 text-indigo-600" />
                <span>
                  長輩不會操作手機？支援「電話代客報名」與「匯出 CSV 用 Excel 填寫後再匯入」！
                </span>
              </div>
              <button
                type="button"
                onClick={() => setShowCsvGuide((prev) => !prev)}
                className="text-indigo-700 underline font-semibold hover:text-indigo-900"
              >
                {showCsvGuide ? '收合詳細步驟' : '點此查看 Excel 修改再匯入步驟'}
              </button>
            </div>

            {showCsvGuide && (
              <div className="grid gap-2 border-t border-indigo-200/70 pt-2.5 text-slate-700 sm:grid-cols-3">
                <div className="rounded-lg bg-white p-2.5 border border-indigo-100">
                  <div className="font-bold text-indigo-800">
                    步驟 1：匯出 CSV 用 Excel 開啟
                  </div>
                  <p className="mt-0.5 text-[11px] leading-relaxed">
                    點擊右上方「<strong>匯出 CSV 名單</strong>」（即使目前 0 人報名也會提供含標題與範例的 CSV 檔）。
                  </p>
                </div>
                <div className="rounded-lg bg-white p-2.5 border border-indigo-100">
                  <div className="font-bold text-indigo-800">
                    步驟 2：在最下方人工輸入長輩資料
                  </div>
                  <p className="mt-0.5 text-[11px] leading-relaxed">
                    必填僅需「<strong>志工姓名</strong>」與「<strong>手機號碼</strong>」。生日可直接填<strong>民國年（如 42/05/10）</strong>或西元年；無信箱或緊急聯絡人可留白。
                  </p>
                </div>
                <div className="rounded-lg bg-white p-2.5 border border-indigo-100">
                  <div className="font-bold text-indigo-800">
                    步驟 3：存檔後點「匯入 CSV 名單」
                  </div>
                  <p className="mt-0.5 text-[11px] leading-relaxed">
                    系統會自動比對手機與身分證：<strong>原本已在名單內的志工不會重複新增</strong>（若有修改會同步更新），新輸入的長輩則會立即完成報名！
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 電話代客報名 (人工單筆新增) 彈出視窗 */}
      {showManualModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <div className="flex items-center gap-2.5">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
                  <UserPlus className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-lg font-extrabold text-slate-900">
                    電話代客報名（管理員人工登錄）
                  </h2>
                  <p className="text-xs text-slate-500">
                    專為來電報名之年長志工設計，信箱與緊急聯絡人若未知可留白，系統將自動補齊。
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowManualModal(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleManualRegisterSubmit} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    選擇報名組別與時段 *
                  </label>
                  <select
                    value={manualShiftId}
                    onChange={(e) => setManualShiftId(e.target.value)}
                    required
                    className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm font-medium outline-none focus:border-emerald-600"
                  >
                    {shifts.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.group_name} ({formatTimeRange(s.start_time, s.end_time)}) — 目前正取 {s.confirmed_count}/{s.quota} 名
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    志工姓名 *
                  </label>
                  <input
                    type="text"
                    required
                    value={manualName}
                    onChange={(e) => setManualName(e.target.value)}
                    placeholder="例：陳金水 阿公"
                    className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm outline-none focus:border-emerald-600"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    手機號碼或市話 *
                  </label>
                  <input
                    type="tel"
                    required
                    value={manualPhone}
                    onChange={(e) => setManualPhone(e.target.value)}
                    placeholder="例：0912345678 或 0223456789"
                    className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm outline-none focus:border-emerald-600"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    身分證字號（投保用，若未知可先留白）
                  </label>
                  <input
                    type="text"
                    value={manualIdNumber}
                    onChange={(e) => setManualIdNumber(e.target.value.toUpperCase())}
                    placeholder="例：A123456789"
                    className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm uppercase outline-none focus:border-emerald-600"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    出生年月日（支援民國年如 42/05/10 或西元年）
                  </label>
                  <input
                    type="text"
                    value={manualBirthDate}
                    onChange={(e) => setManualBirthDate(e.target.value)}
                    placeholder="例：42/05/10 或 1953-05-10"
                    className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm outline-none focus:border-emerald-600"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    餐點需求
                  </label>
                  <select
                    value={manualDietary}
                    onChange={(e) =>
                      setManualDietary(e.target.value as DietaryType)
                    }
                    className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm outline-none focus:border-emerald-600"
                  >
                    <option value="meat">葷食便當</option>
                    <option value="vegetarian">素食便當</option>
                    <option value="none">不需供餐</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    錄取狀態
                  </label>
                  <select
                    value={manualStatus}
                    onChange={(e) =>
                      setManualStatus(e.target.value as RegistrationStatus)
                    }
                    className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm outline-none focus:border-emerald-600"
                  >
                    <option value="confirmed">正取 (confirmed)</option>
                    <option value="waitlist">候補 (waitlist)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    緊急聯絡人姓名（選填）
                  </label>
                  <input
                    type="text"
                    value={manualEmergencyName}
                    onChange={(e) => setManualEmergencyName(e.target.value)}
                    placeholder="留白將自動帶入「家屬(電話代填)」"
                    className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm outline-none focus:border-emerald-600"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    緊急聯絡人電話（選填）
                  </label>
                  <input
                    type="tel"
                    value={manualEmergencyPhone}
                    onChange={(e) => setManualEmergencyPhone(e.target.value)}
                    placeholder="留白將自動帶入志工本人電話"
                    className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm outline-none focus:border-emerald-600"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    備註事項
                  </label>
                  <input
                    type="text"
                    value={manualNote}
                    onChange={(e) => setManualNote(e.target.value)}
                    placeholder="例：長輩來電・管理員人工代客報名"
                    className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm outline-none focus:border-emerald-600"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 border-t border-slate-100 pt-4">
                <button
                  type="button"
                  onClick={() => setShowManualModal(false)}
                  className="rounded-xl border border-slate-300 px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={manualSubmitting}
                  className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-xs sm:text-sm font-bold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
                >
                  <UserPlus className="h-4 w-4" />
                  {manualSubmitting ? '正在儲存報名...' : '確認新增志工報名'}
                </button>
              </div>
            </form>
          </div>
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

      {successMsg && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
          <span>{successMsg}</span>
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
          onChange={(e) =>
            setStatusFilter(e.target.value as 'all' | RegistrationStatus)
          }
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
          <div className="p-12 text-center text-sm text-slate-500">
            載入報名名單中...
          </div>
        ) : filteredList.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <div className="text-sm text-slate-500">
              目前沒有符合篩選條件的報名資料
            </div>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => setShowManualModal(true)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700"
              >
                <PhoneCall className="h-3.5 w-3.5" />
                立即新增第一筆電話代客報名
              </button>
              <button
                type="button"
                onClick={handleExportCSV}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
              >
                <Download className="h-3.5 w-3.5" />
                下載空白 CSV 範本 (用 Excel 填寫後匯入)
              </button>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-3.5 font-bold">現場簽到打卡</th>
                  <th className="px-4 py-3.5 font-bold">
                    志工姓名 / 聯絡資訊
                  </th>
                  <th className="px-4 py-3.5 font-bold">報名組別與時段</th>
                  <th className="px-4 py-3.5 font-bold">
                    保險資料 (身分證 / 生日)
                  </th>
                  <th className="px-4 py-3.5 font-bold">餐點 / 緊急聯絡人</th>
                  <th className="px-4 py-3.5 font-bold">錄取狀態管理</th>
                  <th className="px-4 py-3.5 font-bold">
                    <span className="inline-flex items-center gap-1 text-indigo-700">
                      <Shield className="h-3.5 w-3.5" />
                      後台管理權限欄位
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredList.map((reg) => {
                  const statusMeta = getRegistrationStatusMeta(reg.status);
                  const { role: effRole, adminPin } =
                    getEffectiveRegistrationRole(reg);
                  const roleMeta = getVolunteerRoleMeta(effRole);

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
                            {new Date(reg.checked_in_at).toLocaleTimeString(
                              'zh-TW',
                              {
                                hour: '2-digit',
                                minute: '2-digit',
                              }
                            )}
                          </div>
                        )}
                      </td>

                      {/* 姓名與聯絡 */}
                      <td className="px-4 py-3.5 align-middle space-y-0.5">
                        <div className="text-sm font-bold text-slate-900">
                          {reg.volunteer_name}
                        </div>
                        <div className="font-mono text-slate-600">
                          {reg.phone}
                        </div>
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
                        <div className="text-slate-500">
                          生日：{reg.birth_date}
                        </div>
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
                              reg,
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

                      {/* 後台管理權限欄位 (role) */}
                      <td className="px-4 py-3.5 align-middle space-y-1.5">
                        <div>
                          <span
                            className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${roleMeta.badgeClass}`}
                          >
                            {roleMeta.shortLabel}
                          </span>
                        </div>
                        <select
                          value={effRole}
                          disabled={adminRole !== 'super_admin'}
                          onChange={(e) =>
                            handleRoleChange(
                              reg,
                              e.target.value as VolunteerRole
                            )
                          }
                          className="rounded-lg border border-indigo-200 bg-indigo-50/40 px-2 py-1 text-xs font-semibold text-slate-800 outline-none focus:border-indigo-600 disabled:opacity-50"
                        >
                          <option value="volunteer">權限：一般志工</option>
                          <option value="staff_admin">
                            權限：🛡️ 志工幹部管理員
                          </option>
                          <option value="super_admin">
                            權限：👑 最高管理員
                          </option>
                        </select>
                        {effRole !== 'volunteer' && (
                          <div className="text-[11px] text-indigo-700 font-mono">
                            登入密碼：{adminPin}
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
  );
}
