import { supabase, getVolunteerRoleMeta } from './supabase';
import type { VolunteerRole, Registration } from '@/types/database';

export type AdminActionType =
  | 'LOGIN'
  | 'LOGIN_FAILED'
  | 'LOGOUT'
  | 'CREATE_EVENT'
  | 'UPDATE_EVENT'
  | 'CHANGE_EVENT_STATUS'
  | 'DELETE_EVENT'
  | 'CHECK_IN'
  | 'UNCHECK_IN'
  | 'CHANGE_REG_STATUS'
  | 'CHANGE_VOLUNTEER_ROLE'
  | 'EXPORT_CSV'
  | 'CHANGE_PASSWORD';

export interface AdminAuditLog {
  id: string;
  admin_name: string;
  action_type: AdminActionType | string;
  action_label: string;
  target_name: string;
  details: string;
  created_at: string;
}

export interface AdminSession {
  adminName: string;
  role: VolunteerRole;
  loginAt: string;
}

export interface LocalRoleOverride {
  role: VolunteerRole;
  admin_pin?: string;
  volunteer_name: string;
  phone: string;
}

const SESSION_KEY = 'volunteer_admin_session_v1';
const LOCAL_PWD_KEY = 'volunteer_admin_password_v1';
const LOCAL_LOGS_KEY = 'volunteer_admin_audit_logs_v1';
const LOCAL_ROLES_KEY = 'volunteer_roles_override_v1';
const DEFAULT_ADMIN_PASSWORD =
  process.env.NEXT_PUBLIC_ADMIN_DEFAULT_PASSWORD || 'admin8888';

// 取得本地保存的志工權限表 (支援尚未執行擴充 SQL 時即時生效)
export function getLocalRoleOverrides(): Record<string, LocalRoleOverride> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(LOCAL_ROLES_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function getEffectiveRegistrationRole(reg: Registration): {
  role: VolunteerRole;
  adminPin: string;
} {
  const overrides = getLocalRoleOverrides();
  const byId = overrides[reg.id];
  const cleanPhone = reg.phone.replace(/\D/g, '');
  const byPhone = overrides[`phone:${cleanPhone}`];

  const role: VolunteerRole =
    byId?.role || byPhone?.role || reg.role || 'volunteer';
  const defaultPin =
    cleanPhone.length >= 6 ? cleanPhone.slice(-6) : DEFAULT_ADMIN_PASSWORD;
  const adminPin =
    byId?.admin_pin || byPhone?.admin_pin || reg.admin_pin || defaultPin;

  return { role, adminPin };
}

// 更新志工的後台管理權限欄位與密碼
export async function updateVolunteerRole(params: {
  operatorName: string;
  reg: Registration;
  newRole: VolunteerRole;
  newPin?: string;
}): Promise<{ success: boolean; error?: string }> {
  const { operatorName, reg, newRole, newPin } = params;
  const current = getEffectiveRegistrationRole(reg);
  const finalPin =
    newPin !== undefined ? newPin.trim() : current.adminPin;

  // 1. 先寫入本地權限設定表 (以報名 ID 與手機號碼雙鍵索引，跨活動共用權限)
  if (typeof window !== 'undefined') {
    const overrides = getLocalRoleOverrides();
    const cleanPhone = reg.phone.replace(/\D/g, '');
    const entry: LocalRoleOverride = {
      role: newRole,
      admin_pin: finalPin,
      volunteer_name: reg.volunteer_name,
      phone: reg.phone,
    };
    overrides[reg.id] = entry;
    if (cleanPhone) {
      overrides[`phone:${cleanPhone}`] = entry;
    }
    localStorage.setItem(LOCAL_ROLES_KEY, JSON.stringify(overrides));
  }

  // 2. 同步嘗試更新 Supabase registrations 表中的 role 與 admin_pin 欄位
  try {
    await supabase
      .from('registrations')
      .update({
        role: newRole,
        admin_pin: finalPin,
      })
      .eq('id', reg.id);
  } catch {
    // 若使用者尚未執行新增 role 欄位的 SQL，本地備援已完整保存
  }

  const oldRoleLabel = getVolunteerRoleMeta(current.role).shortLabel;
  const newRoleLabel = getVolunteerRoleMeta(newRole).shortLabel;

  await recordAdminAction({
    adminName: operatorName,
    actionType: 'CHANGE_VOLUNTEER_ROLE',
    actionLabel: '變更志工後台權限',
    targetName: `${reg.volunteer_name} (${reg.phone})`,
    details: `將志工「${reg.volunteer_name}」的後台管理權限由「${oldRoleLabel}」變更為「${newRoleLabel}」${
      newRole !== 'volunteer' ? `（登入密碼：${finalPin}）` : ''
    }`,
  });

  return { success: true };
}

// 取得目前登入的管理員 Session
export function getAdminSession(): AdminSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AdminSession;
    return {
      ...parsed,
      role: parsed.role || 'super_admin',
    };
  } catch {
    return null;
  }
}

// 儲存管理員 Session
export function setAdminSession(
  adminName: string,
  role: VolunteerRole = 'super_admin'
): AdminSession {
  const session: AdminSession = {
    adminName: adminName.trim(),
    role,
    loginAt: new Date().toISOString(),
  };
  if (typeof window !== 'undefined') {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  }
  return session;
}

// 登出並清除管理員 Session
export function clearAdminSession(): void {
  if (typeof window !== 'undefined') {
    sessionStorage.removeItem(SESSION_KEY);
  }
}

// 取得目前有效的系統總管理員密碼
export async function getCurrentAdminPassword(): Promise<string> {
  try {
    const { data, error } = await supabase
      .from('admin_settings')
      .select('admin_password')
      .eq('id', 1)
      .single();

    if (!error && data?.admin_password) {
      if (typeof window !== 'undefined') {
        localStorage.setItem(LOCAL_PWD_KEY, data.admin_password);
      }
      return data.admin_password;
    }
  } catch {
    // fallback to localStorage
  }

  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem(LOCAL_PWD_KEY);
    if (saved) return saved;
  }

  return DEFAULT_ADMIN_PASSWORD;
}

// 驗證管理員或具管理權限之志工登入
export async function verifyAdminLogin(
  identifierInput: string,
  passwordInput: string
): Promise<{
  success: boolean;
  adminName?: string;
  role?: VolunteerRole;
  errorMsg?: string;
}> {
  const cleanId = identifierInput.trim();
  const cleanPhoneInput = cleanId.replace(/\D/g, '');
  const masterPwd = await getCurrentAdminPassword();

  // 1. 先檢查是否直接輸入「系統最高管理員密碼」
  if (passwordInput === masterPwd) {
    return {
      success: true,
      adminName: cleanId,
      role: 'super_admin',
    };
  }

  // 2. 檢查是否為已獲授權之「志工管理員 (staff_admin / super_admin)」
  // 2a. 先從 Supabase registrations 查詢該姓名或手機號碼的志工
  try {
    const { data } = await supabase.from('registrations').select('*');
    const allRegs = (data as Registration[]) || [];

    const matchedRegs = allRegs.filter((r) => {
      const rPhone = r.phone.replace(/\D/g, '');
      return (
        r.volunteer_name.trim() === cleanId ||
        (cleanPhoneInput.length >= 8 && rPhone === cleanPhoneInput)
      );
    });

    if (matchedRegs.length > 0) {
      // 檢查該志工是否擁有 staff_admin 或 super_admin 權限
      for (const reg of matchedRegs) {
        const { role, adminPin } = getEffectiveRegistrationRole(reg);
        if (role === 'staff_admin' || role === 'super_admin') {
          if (passwordInput === adminPin) {
            return {
              success: true,
              adminName: `${reg.volunteer_name} (志工管理員)`,
              role,
            };
          } else {
            return {
              success: false,
              errorMsg: `志工管理員「${reg.volunteer_name}」的密碼不正確（預設為手機末 6 碼或由最高管理員設定之密碼）`,
            };
          }
        }
      }

      // 有找到該志工，但權限為 volunteer (一般志工)
      return {
        success: false,
        errorMsg: `志工「${matchedRegs[0].volunteer_name}」目前的權限欄位為「一般志工」，尚未被授予後台管理權限！請由最高管理員於後台開啟權限。`,
      };
    }
  } catch {
    // ignore query error
  }

  // 2b. 檢查本地權限表
  const overrides = getLocalRoleOverrides();
  for (const key of Object.keys(overrides)) {
    const item = overrides[key];
    const itemPhone = item.phone.replace(/\D/g, '');
    if (
      item.volunteer_name === cleanId ||
      (cleanPhoneInput.length >= 8 && itemPhone === cleanPhoneInput)
    ) {
      if (item.role === 'staff_admin' || item.role === 'super_admin') {
        const expectedPin = item.admin_pin || itemPhone.slice(-6);
        if (passwordInput === expectedPin) {
          return {
            success: true,
            adminName: `${item.volunteer_name} (志工管理員)`,
            role: item.role,
          };
        }
      } else {
        return {
          success: false,
          errorMsg: `志工「${item.volunteer_name}」目前的權限欄位為「一般志工」，無後台進入權限！`,
        };
      }
    }
  }

  return {
    success: false,
    errorMsg: '管理員密碼不正確，或該志工帳號尚未被授予後台管理權限！',
  };
}

// 修改管理員密碼
export async function updateAdminPassword(
  adminName: string,
  oldPassword: string,
  newPassword: string
): Promise<{ success: boolean; error?: string }> {
  const currentPwd = await getCurrentAdminPassword();
  if (oldPassword !== currentPwd) {
    return { success: false, error: '原密碼輸入錯誤，無法變更密碼' };
  }

  if (newPassword.trim().length < 4) {
    return { success: false, error: '新密碼長度至少需 4 個字元' };
  }

  const cleanNew = newPassword.trim();

  if (typeof window !== 'undefined') {
    localStorage.setItem(LOCAL_PWD_KEY, cleanNew);
  }

  try {
    await supabase.from('admin_settings').upsert({
      id: 1,
      admin_password: cleanNew,
      updated_by: adminName,
      updated_at: new Date().toISOString(),
    });
  } catch {
    // fallback to localStorage
  }

  await recordAdminAction({
    adminName,
    actionType: 'CHANGE_PASSWORD',
    actionLabel: '修改管理員密碼',
    targetName: '系統安全設定',
    details: `管理員「${adminName}」已更新後台通行密碼`,
  });

  return { success: true };
}

// 記錄管理員操作動作
export async function recordAdminAction(params: {
  adminName: string;
  actionType: AdminActionType;
  actionLabel: string;
  targetName: string;
  details: string;
}): Promise<void> {
  const newLog: AdminAuditLog = {
    id:
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random()}`,
    admin_name: params.adminName,
    action_type: params.actionType,
    action_label: params.actionLabel,
    target_name: params.targetName,
    details: params.details,
    created_at: new Date().toISOString(),
  };

  if (typeof window !== 'undefined') {
    try {
      const existingRaw = localStorage.getItem(LOCAL_LOGS_KEY);
      const existing: AdminAuditLog[] = existingRaw
        ? JSON.parse(existingRaw)
        : [];
      const updated = [newLog, ...existing].slice(0, 500);
      localStorage.setItem(LOCAL_LOGS_KEY, JSON.stringify(updated));
    } catch {
      // ignore storage errors
    }
  }

  try {
    await supabase.from('admin_audit_logs').insert([
      {
        id: newLog.id,
        admin_name: newLog.admin_name,
        action_type: newLog.action_type,
        action_label: newLog.action_label,
        target_name: newLog.target_name,
        details: newLog.details,
        created_at: newLog.created_at,
      },
    ]);
  } catch {
    // fallback to local logs
  }
}

// 讀取所有管理員操作稽核紀錄
export async function fetchAdminAuditLogs(): Promise<AdminAuditLog[]> {
  let localLogs: AdminAuditLog[] = [];
  if (typeof window !== 'undefined') {
    try {
      const raw = localStorage.getItem(LOCAL_LOGS_KEY);
      if (raw) localLogs = JSON.parse(raw);
    } catch {
      localLogs = [];
    }
  }

  try {
    const { data, error } = await supabase
      .from('admin_audit_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200);

    if (!error && data) {
      const cloudLogs = data as AdminAuditLog[];
      const map = new Map<string, AdminAuditLog>();
      for (const log of [...cloudLogs, ...localLogs]) {
        if (!map.has(log.id)) {
          map.set(log.id, log);
        }
      }
      return Array.from(map.values()).sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
    }
  } catch {
    // fallback to localLogs
  }

  return localLogs.sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
}

// 動作類型顏色樣式
export function getActionBadgeClass(actionType: string): string {
  switch (actionType) {
    case 'LOGIN':
      return 'bg-emerald-100 text-emerald-800 border-emerald-200';
    case 'LOGIN_FAILED':
      return 'bg-red-100 text-red-800 border-red-200';
    case 'LOGOUT':
      return 'bg-slate-100 text-slate-700 border-slate-200';
    case 'CREATE_EVENT':
      return 'bg-teal-100 text-teal-800 border-teal-200';
    case 'UPDATE_EVENT':
    case 'CHANGE_EVENT_STATUS':
      return 'bg-blue-100 text-blue-800 border-blue-200';
    case 'DELETE_EVENT':
      return 'bg-red-100 text-red-800 border-red-200';
    case 'CHECK_IN':
    case 'UNCHECK_IN':
    case 'CHANGE_REG_STATUS':
      return 'bg-purple-100 text-purple-800 border-purple-200';
    case 'CHANGE_VOLUNTEER_ROLE':
      return 'bg-indigo-100 text-indigo-800 border-indigo-200';
    case 'EXPORT_CSV':
    case 'CHANGE_PASSWORD':
      return 'bg-amber-100 text-amber-800 border-amber-200';
    default:
      return 'bg-slate-100 text-slate-700 border-slate-200';
  }
}
