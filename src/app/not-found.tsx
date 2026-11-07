import Link from 'next/link';
import { Home } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm space-y-4">
        <div className="text-4xl font-extrabold text-emerald-600">404</div>
        <h2 className="text-xl font-bold text-slate-900">找不到此頁面</h2>
        <p className="text-sm text-slate-500">
          您所尋找的網址不存在或活動可能已被移除。
        </p>
        <div className="pt-2">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-700"
          >
            <Home className="h-4 w-4" />
            返回志工活動列表
          </Link>
        </div>
      </div>
    </div>
  );
}
