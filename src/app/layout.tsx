import type { Metadata } from 'next';
import './globals.css';
import Navbar from '@/components/Navbar';

export const metadata: Metadata = {
  title: '志工招募與報名系統 | Volunteer Portal',
  description: '線上志工活動報名、多組別時段選擇、即時名額與候補查詢系統',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-Hant">
      <body className="min-h-screen flex flex-col">
        <Navbar />
        <main className="flex-1 mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
          {children}
        </main>
        <footer className="border-t border-slate-200 bg-white py-6 text-center text-xs text-slate-500">
          <div className="mx-auto max-w-6xl px-4">
            <p>© {new Date().getFullYear()} 志工招募與報名系統 · Powered by Next.js, Vercel &amp; Supabase</p>
          </div>
        </footer>
      </body>
    </html>
  );
}
