'use client';

import { useState, useEffect, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import {
  ShieldCheck,
  Lock,
  UserCheck,
  AlertCircle,
  Eye,
  EyeOff,
} from 'lucide-react';
import { getVolunteerRoleMeta } from '@/lib/supabase';
import {
  getAdminSession,
  setAdminSession,
  verifyAdminLogin,
  recordAdminAction,
} from '@/lib/audit';

export default function AdminLoginPage() {
  const router = useRouter();
  const [adminName, setAdminName] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    const existing = getAdminSession();
    if (existing) {
      router.replace('/admin');
    }
  }, [router]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const cleanName = adminName.trim();
    if (!cleanName) {
      setErrorMsg('請輸入管理員姓名或已授權之志工姓名/手機號碼');
      return;
    }

    setLoading(true);
    setErrorMsg('');

    const result = await verifyAdminLogin(cleanName, password);

    if (!result.success || !result.adminName || !result.role) {
      await recordAdminAction({
        adminName: cleanName,
        actionType: 'LOGIN_FAILED',
        actionLabel: '無權限或密碼錯誤攔截',
        targetName: '管理後台登入頁',
        details:
          result.errorMsg ||
          `嘗試以「${cleanName}」登入後台失敗（密碼錯誤或無管理員權限）`,
      });
      setLoading(false);
      setErrorMsg(
        result.errorMsg ||
          '管理員密碼不正確，或該志工帳號尚未被授予後台管理權限！'
      );
      return;
    }

    // 驗證通過：建立含權限角色的 Session 並寫入登入稽核紀錄
    const roleLabel = getVolunteerRoleMeta(result.role).shortLabel;
    setAdminSession(result.adminName, result.role);
    await recordAdminAction({
      adminName: result.adminName,
      actionType: 'LOGIN',
      actionLabel: '登入管理後台',
      targetName: '管理後台系統',
      details: `以「${roleLabel}」權限驗證通過進入後台`,
    });

    setLoading(false);
    router.replace('/admin');
  }

  return (
    <div className="mx-auto max-w-md py-12">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 shadow-sm space-y-6">
        <div className="text-center space-y-2">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-600 text-white shadow-sm">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <h1 className="text-2xl font-extrabold text-slate-900">
            管理員與授權志工幹部登入
          </h1>
          <p className="text-xs leading-relaxed text-slate-500">
            僅限「最高管理員」與獲開啟後台權限之「志工幹部管理員」進入。
            <br />
            進入後台後的所有操作皆會自動寫入稽核紀錄。
          </p>
        </div>

        {errorMsg && (
          <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3.5 text-xs text-red-700">
            <AlertCircle className="h-4 w-4 shrink-0 text-red-600 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="adminName"
              className="block text-xs font-semibold text-slate-700 mb-1"
            >
              管理員姓名 / 志工姓名或手機號碼 <span className="text-red-500">*</span>
            </label>
            <span className="block text-[11px] text-slate-400 mb-1">
              獲授權之志工管理員可直接輸入報名時的「姓名」或「手機號碼」
            </span>
            <div className="relative">
              <UserCheck className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                id="adminName"
                type="text"
                required
                value={adminName}
                onChange={(e) => setAdminName(e.target.value)}
                placeholder="例：王主任 或 志工姓名/手機號碼"
                className="w-full rounded-xl border border-slate-300 py-2.5 pl-10 pr-4 text-sm outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/20"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="adminPassword"
              className="block text-xs font-semibold text-slate-700 mb-1"
            >
              管理員通行密碼 / 志工管理密碼 <span className="text-red-500">*</span>
            </label>
            <span className="block text-[11px] text-slate-400 mb-1">
              志工管理員預設密碼為「手機號碼末 6 碼」（或由最高管理員設定之密碼）
            </span>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                id="adminPassword"
                type={showPassword ? 'text' : 'password'}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="請輸入通行密碼"
                className="w-full rounded-xl border border-slate-300 py-2.5 pl-10 pr-10 text-sm outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/20"
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                title={showPassword ? '隱藏密碼' : '顯示密碼'}
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-emerald-600 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50"
          >
            {loading ? '驗證權限與密碼中...' : '驗證權限並進入管理後台'}
          </button>
        </form>
      </div>
    </div>
  );
}
