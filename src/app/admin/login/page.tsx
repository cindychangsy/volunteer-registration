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
  UserPlus,
  KeyRound,
  CheckCircle2,
} from 'lucide-react';
import { getVolunteerRoleMeta } from '@/lib/supabase';
import {
  getAdminSession,
  setAdminSession,
  verifyAdminLogin,
  registerAdminAccount,
  recordAdminAction,
} from '@/lib/audit';

export default function AdminLoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [adminName, setAdminName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [authCode, setAuthCode] = useState('admin8888');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

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
    setSuccessMsg('');

    if (mode === 'register') {
      if (password !== confirmPassword) {
        setLoading(false);
        setErrorMsg('兩次輸入的密碼不一致，請重新確認！');
        return;
      }

      const regRes = await registerAdminAccount({
        adminName: cleanName,
        password,
        authCode,
        role: 'super_admin',
      });

      if (!regRes.success) {
        setLoading(false);
        setErrorMsg(regRes.errorMsg || '註冊管理員失敗');
        return;
      }

      // 註冊成功後自動登入進入後台
      setAdminSession(cleanName, 'super_admin');
      await recordAdminAction({
        adminName: cleanName,
        actionType: 'LOGIN',
        actionLabel: '登入管理後台',
        targetName: '管理後台系統',
        details: `管理員「${cleanName}」完成密碼設定並直接進入後台`,
      });

      setLoading(false);
      router.replace('/admin');
      return;
    }

    // 登入模式
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
    <div className="mx-auto max-w-md py-10">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 shadow-sm space-y-6">
        <div className="text-center space-y-2">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-600 text-white shadow-sm">
            {mode === 'login' ? (
              <ShieldCheck className="h-6 w-6" />
            ) : (
              <UserPlus className="h-6 w-6" />
            )}
          </div>
          <h1 className="text-2xl font-extrabold text-slate-900">
            {mode === 'login'
              ? '管理員與授權志工幹部登入'
              : '註冊管理員並設定專屬密碼'}
          </h1>
          <p className="text-xs leading-relaxed text-slate-500">
            {mode === 'login'
              ? '僅限「最高管理員」與獲開啟後台權限之「志工幹部管理員」進入。進入後台後的所有操作皆會自動寫入稽核紀錄。'
              : '請設定您的管理員名稱與個人密碼。為防止外人隨意註冊，需驗證系統授權碼才可建立管理員身分。'}
          </p>
        </div>

        {/* 登入 / 註冊模式切換按鈕 */}
        <div className="grid grid-cols-2 gap-1.5 rounded-xl bg-slate-100 p-1">
          <button
            type="button"
            onClick={() => {
              setMode('login');
              setErrorMsg('');
              setSuccessMsg('');
            }}
            className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-bold transition ${
              mode === 'login'
                ? 'bg-white text-emerald-700 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            登入管理後台
          </button>

          <button
            type="button"
            onClick={() => {
              setMode('register');
              setErrorMsg('');
              setSuccessMsg('');
            }}
            className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-bold transition ${
              mode === 'register'
                ? 'bg-white text-emerald-700 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <UserPlus className="h-3.5 w-3.5" />
            註冊管理員 / 設密碼
          </button>
        </div>

        {errorMsg && (
          <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3.5 text-xs text-red-700">
            <AlertCircle className="h-4 w-4 shrink-0 text-red-600 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        {successMsg && (
          <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-xs text-emerald-800">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 mt-0.5" />
            <span>{successMsg}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="adminName"
              className="block text-xs font-semibold text-slate-700 mb-1"
            >
              {mode === 'login'
                ? '管理員姓名 / 志工姓名或手機號碼'
                : '設定您的管理員姓名 / 帳號'}{' '}
              <span className="text-red-500">*</span>
            </label>
            <span className="block text-[11px] text-slate-400 mb-1">
              {mode === 'login'
                ? '獲授權之志工管理員可直接輸入報名時的「姓名」或「手機號碼」'
                : '您進入後台後執行的每一項動作，都會以此名稱記錄在稽核日誌'}
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
              {mode === 'login'
                ? '管理員通行密碼 / 志工管理密碼'
                : '設定您的專屬登入密碼（至少 4 碼）'}{' '}
              <span className="text-red-500">*</span>
            </label>
            <span className="block text-[11px] text-slate-400 mb-1">
              {mode === 'login'
                ? '系統預設總密碼為 admin8888；志工管理員預設為「手機末 6 碼」'
                : '請設定您日後登入後台要使用的專屬密碼'}
            </span>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                id="adminPassword"
                type={showPassword ? 'text' : 'password'}
                required
                minLength={4}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={
                  mode === 'login'
                    ? '請輸入密碼 (預設 admin8888)'
                    : '請設定您的專屬密碼'
                }
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

          {mode === 'register' && (
            <>
              <div>
                <label
                  htmlFor="confirmPassword"
                  className="block text-xs font-semibold text-slate-700 mb-1"
                >
                  再次確認您的專屬密碼 <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    id="confirmPassword"
                    type={showPassword ? 'text' : 'password'}
                    required
                    minLength={4}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="請再次輸入相同密碼"
                    className="w-full rounded-xl border border-slate-300 py-2.5 pl-10 pr-4 text-sm outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/20"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="authCode"
                  className="block text-xs font-semibold text-slate-700 mb-1"
                >
                  系統管理員授權碼 <span className="text-red-500">*</span>
                </label>
                <span className="block text-[11px] text-slate-400 mb-1">
                  防止非授權人員隨意註冊（初始授權碼已為您預填：admin8888）
                </span>
                <div className="relative">
                  <KeyRound className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-amber-500" />
                  <input
                    id="authCode"
                    type="text"
                    required
                    value={authCode}
                    onChange={(e) => setAuthCode(e.target.value)}
                    placeholder="預設授權碼：admin8888"
                    className="w-full rounded-xl border border-amber-300 bg-amber-50/40 py-2.5 pl-10 pr-4 text-sm font-mono outline-none transition focus:border-amber-600"
                  />
                </div>
              </div>
            </>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-emerald-600 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50"
          >
            {loading
              ? '處理中...'
              : mode === 'login'
              ? '驗證權限並進入管理後台'
              : '完成註冊設密碼並進入管理後台'}
          </button>
        </form>

        <div className="border-t border-slate-100 pt-4 text-center text-xs text-slate-500">
          {mode === 'login' ? (
            <p>
              想要建立專屬管理員帳號並設定自己的密碼嗎？{' '}
              <button
                type="button"
                onClick={() => {
                  setMode('register');
                  setErrorMsg('');
                }}
                className="font-bold text-emerald-600 hover:underline"
              >
                點此註冊管理員 / 設定密碼
              </button>
            </p>
          ) : (
            <p>
              已經有管理員密碼或志工幹部權限？{' '}
              <button
                type="button"
                onClick={() => {
                  setMode('login');
                  setErrorMsg('');
                }}
                className="font-bold text-emerald-600 hover:underline"
              >
                返回登入畫面
              </button>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
