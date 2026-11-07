'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { HeartHandshake, Search, ShieldCheck, CalendarDays } from 'lucide-react';

export default function Navbar() {
  const pathname = usePathname();

  const navItems = [
    {
      href: '/',
      label: '志工活動列表',
      icon: CalendarDays,
      active: pathname === '/' || pathname.startsWith('/events'),
    },
    {
      href: '/lookup',
      label: '報名查詢 / 取消',
      icon: Search,
      active: pathname.startsWith('/lookup'),
    },
    {
      href: '/admin',
      label: '管理員後台',
      icon: ShieldCheck,
      active: pathname.startsWith('/admin'),
    },
  ];

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3.5 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5 group">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-sm transition group-hover:bg-emerald-700">
            <HeartHandshake className="h-5 w-5" />
          </div>
          <div>
            <span className="block text-lg font-bold tracking-tight text-slate-900">
              志工招募與報名系統
            </span>
            <span className="hidden text-xs text-slate-500 sm:block">
              Volunteer Registration Portal
            </span>
          </div>
        </Link>

        <nav className="flex items-center gap-1 sm:gap-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition ${
                  item.active
                    ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-600/20'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="hidden sm:inline">{item.label}</span>
                <span className="sm:hidden">
                  {item.href === '/' ? '活動' : item.href === '/lookup' ? '查詢' : '後台'}
                </span>
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
