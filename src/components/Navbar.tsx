'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  HeartHandshake,
  Search,
  ShieldCheck,
  CalendarDays,
  Share2,
  Copy,
  Check,
  QrCode,
  X,
  ExternalLink,
} from 'lucide-react';

export default function Navbar() {
  const pathname = usePathname();
  const [siteUrl, setSiteUrl] = useState('');
  const [showShareModal, setShowShareModal] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setSiteUrl(window.location.origin);
    }
  }, []);

  const navItems = [
    {
      href: '/',
      label: '志工活動列表',
      shortLabel: '活動報名',
      icon: CalendarDays,
      active: pathname === '/' || pathname.startsWith('/events'),
    },
    {
      href: '/lookup',
      label: '報名查詢 / 取消',
      shortLabel: '查詢/取消',
      icon: Search,
      active: pathname.startsWith('/lookup'),
    },
    {
      href: '/admin',
      label: '管理員後台',
      shortLabel: '管理後台',
      icon: ShieldCheck,
      active: pathname.startsWith('/admin'),
    },
  ];

  async function handleCopyUrl() {
    if (!siteUrl) return;
    await navigator.clipboard.writeText(siteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-3.5 py-3 sm:px-6 sm:py-3.5">
          <Link href="/" className="flex items-center gap-2.5 group min-w-0">
            <div className="flex h-9 w-9 sm:h-10 sm:w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-sm transition group-hover:bg-emerald-700">
              <HeartHandshake className="h-5 w-5" />
            </div>
            <div className="truncate">
              <span className="block truncate text-base sm:text-lg font-bold tracking-tight text-slate-900">
                志工招募與報名系統
              </span>
              <span className="hidden text-xs text-slate-500 sm:block">
                Volunteer Registration Portal (RWD)
              </span>
            </div>
          </Link>

          <div className="flex items-center gap-1.5 sm:gap-2">
            {/* 電腦與平板導覽連結 */}
            <nav className="hidden sm:flex items-center gap-1.5">
              {navItems.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-semibold transition ${
                      item.active
                        ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-600/20'
                        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </nav>

            {/* 顯示網址與手機 QR Code 按鈕 */}
            <button
              type="button"
              onClick={() => setShowShareModal(true)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50/80 px-3 py-2 text-xs sm:text-sm font-bold text-emerald-800 transition hover:bg-emerald-100"
              title="查看網站網址與手機報名 QR Code"
            >
              <QrCode className="h-4 w-4 text-emerald-700 shrink-0" />
              <span>網址 / QR Code</span>
            </button>
          </div>
        </div>
      </header>

      {/* 手機版專屬底部固定導覽列 (Thumb-friendly Mobile Bottom Navigation) */}
      <nav className="fixed bottom-0 inset-x-0 z-30 flex sm:hidden items-center justify-around border-t border-slate-200 bg-white/95 px-2 py-1.5 backdrop-blur shadow-lg">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-1 flex-col items-center justify-center gap-0.5 rounded-xl py-1.5 text-[11px] font-bold transition ${
                item.active
                  ? 'text-emerald-700 bg-emerald-50/80'
                  : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              <Icon className="h-5 w-5" />
              <span>{item.shortLabel}</span>
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setShowShareModal(true)}
          className="flex flex-1 flex-col items-center justify-center gap-0.5 rounded-xl py-1.5 text-[11px] font-bold text-slate-500 hover:text-emerald-700"
        >
          <Share2 className="h-5 w-5" />
          <span>分享網址</span>
        </button>
      </nav>

      {/* 網站網址與手機掃碼 QR Code 彈出視窗 */}
      {showShareModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3.5">
              <div className="flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
                  <QrCode className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-slate-900">
                    網站正式網址與手機 QR Code
                  </h3>
                  <p className="text-xs text-slate-500">
                    支援手機、平板、電腦響應式瀏覽
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowShareModal(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {siteUrl && (
              <div className="space-y-4">
                <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(
                      siteUrl
                    )}`}
                    alt="志工報名系統手機 QR Code"
                    className="h-44 w-44 rounded-xl border border-slate-200 bg-white p-2 shadow-xs"
                  />
                  <span className="mt-2 text-xs font-semibold text-slate-600">
                    請用手機相機或 LINE 掃描上方 QR Code 直接報名
                  </span>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-bold text-slate-700">
                    目前網站網址（可直接複製貼給志工）：
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={siteUrl}
                      className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5 font-mono text-xs text-slate-800 outline-none"
                    />
                    <button
                      type="button"
                      onClick={handleCopyUrl}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white shadow-xs hover:bg-emerald-700"
                    >
                      {copied ? (
                        <>
                          <Check className="h-4 w-4" />
                          已複製
                        </>
                      ) : (
                        <>
                          <Copy className="h-4 w-4" />
                          複製網址
                        </>
                      )}
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2.5 pt-1">
                  <a
                    href={`https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(
                      siteUrl
                    )}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#06C755] px-4 py-2.5 text-xs font-bold text-white shadow-xs hover:opacity-95"
                  >
                    <ExternalLink className="h-4 w-4" />
                    一鍵分享到 LINE
                  </a>
                  <button
                    type="button"
                    onClick={() => setShowShareModal(false)}
                    className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
                  >
                    關閉視窗
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
