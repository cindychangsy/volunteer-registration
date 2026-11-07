'use client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="zh-Hant">
      <body className="min-h-screen flex items-center justify-center bg-slate-50 p-6 font-sans text-slate-900">
        <div className="max-w-md w-full rounded-2xl border border-red-200 bg-white p-8 text-center shadow-sm space-y-4">
          <h2 className="text-xl font-extrabold text-slate-900">
            系統發生嚴重錯誤
          </h2>
          <p className="text-sm text-slate-500">
            {error.message || '應用程式暫時無法載入，請點擊下方按鈕重試。'}
          </p>
          <button
            type="button"
            onClick={() => reset()}
            className="rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-emerald-700"
          >
            重新載入頁面
          </button>
        </div>
      </body>
    </html>
  );
}
