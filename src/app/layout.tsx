import type { Metadata, Viewport } from 'next';
import './globals.css';
import Navbar from '@/components/Navbar';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: '#059669',
};

export const metadata: Metadata = {
  title: '志工招募與報名系統 | Volunteer Portal',
  description: '響應式線上志工活動報名、多組別時段選擇、即時名額與候補查詢系統（支援手機、平板、電腦）',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-Hant">
      <body className="min-h-screen flex flex-col pb-16 sm:pb-0">
        <Navbar />
        <main className="flex-1 mx-auto w-full max-w-6xl px-3.5 py-5 sm:px-6 sm:py-8">
          {children}
        </main>
        <footer className="border-t border-slate-200 bg-white py-6 text-center text-xs text-slate-500">
          <div className="mx-auto max-w-6xl px-4">
            <p>© {new Date().getFullYear()} 志工招募與報名系統 · 響應式網頁設計 (手機 / 平板 / 電腦自適應)</p>
          </div>
        </footer>
      </body>
    </html>
  );
}
