# 志工招募與報名系統 (Next.js + Tailwind CSS + Supabase + Vercel)

這是一個基於 **GitHub + Vercel + Supabase** 架構開發的現代化志工報名管理系統，支援：
- **志工免登入快速報名**：支援單一活動多時段與組別（如：早班報到組、午班引導組）、餐點需求（葷/素/不用餐）、保險與緊急聯絡人欄位。
- **防超額與自動候補遞補機制**：透過 Supabase PostgreSQL RPC (`FOR UPDATE` 併發鎖定)，當正取名額額滿時自動轉入「候補名單」；若有正取志工取消報名，系統自動將第一順位候補升級為「正取」。
- **個資安全保護 (RLS + RPC)**：身分證字號與保險個資受資料庫 Row Level Security 保護，匿名訪客無法直接查詢資料表；志工須同時輸入相符的「手機號碼 + Email」才可查詢或取消自己的報名，且查詢畫面自動遮罩身分證字號。
- **管理員後台 (`/admin`)**：支援 Supabase Auth 登入、建立活動與動態多組別時段、檢視完整報名名單、統計葷素便當數量、**現場一鍵簽到打卡**，以及**匯出 Excel 相容之 UTF-8 BOM CSV 名單**。

---

## 🚀 快速啟動步驟

### Step 1：初始化 Supabase 資料表與函數
1. 登入您的 [Supabase Dashboard](https://supabase.com/dashboard)。
2. 點選左側選單的 **SQL Editor** &rarr; **New query**。
3. 複製本專案 [`supabase/schema.sql`](./supabase/schema.sql) 的全部內容，貼上並點擊 **Run**。
   > 執行後會自動建立 `events`、`event_shifts`、`registrations` 三張資料表、RLS 權限政策、3 個核心 RPC 函數，以及 2 筆預設範例志工活動。

### Step 2：本地端啟動開發伺服器
專案已預先將您的 Supabase URL 與 Publishable Key 寫入 `.env.local`，直接執行：
```bash
npm install
npm run dev
```
接著打開瀏覽器前往 `http://localhost:3000` 即可體驗！

---

## 🌐 部署至 GitHub 與 Vercel

1. **推送程式碼至 GitHub**：
   ```bash
   git init
   git add .
   git commit -m "feat: 初始化志工報名系統 (Next.js + Supabase)"
   git branch -M main
   git remote add origin https://github.com/<您的GitHub帳號>/<您的Repo名稱>.git
   git push -u origin main
   ```
2. **於 Vercel 匯入部署**：
   - 登入 [Vercel](https://vercel.com/)，點擊 **Add New...** &rarr; **Project**，選擇剛剛推送的 GitHub Repository。
   - 在 **Environment Variables** 區塊新增以下兩個環境變數：
     - `NEXT_PUBLIC_SUPABASE_URL`：`https://lsappuzizypupfvyiyxj.supabase.co`
     - `NEXT_PUBLIC_SUPABASE_ANON_KEY`：`sb_publishable_ny_2K-mUqbDGKHgBfes7mw_wUJQzcBd`
   - 點擊 **Deploy**，約 1 分鐘即可獲得正式 HTTPS 網址！
