# まちマップ（フィールド営業マップ CRM）

Vite 6 + React 19 + Leaflet + Supabase の PWA です。

## セットアップ

**初めて Supabase を触る場合は、手順と「URL と ID の違い」を [docs/SETUP_SUPABASE.md](docs/SETUP_SUPABASE.md) にまとめています。**

1. `npm install`
2. `.env.example` を `.env` にコピーし、Supabase ダッシュボード（Project Settings → API）から **Project URL** と **anon public** を貼る
3. `npm run check:env` で `.env` の項目が揃っているか確認
4. Supabase に [supabase/migrations/20260326000000_init.sql](supabase/migrations/20260326000000_init.sql) を適用（SQL Editor に貼るか `supabase db push`）
5. 既に DB だけ先に作っている場合は [supabase/migrations/20260326000002_contact_logs_pinned.sql](supabase/migrations/20260326000002_contact_logs_pinned.sql) も実行（`init` に `pinned` が含まれる新規なら不要）
6. Edge Function をデプロイ: `supabase functions deploy export-csv`（要 Supabase CLI と `supabase link`）
7. `npm run dev` で開発、`npm run build` で本番ビルド

## GitHub Pages で公開（[EigyoMap](https://github.com/kjmanz/EigyoMap)）

1. リポジトリ **Settings → Secrets and variables → Actions** で次を登録（Repository secrets）  
   - `VITE_SUPABASE_URL` … Supabase の Project URL  
   - `VITE_SUPABASE_ANON_KEY` … anon（public）キー  
2. **Settings → Pages** で **Build and deployment** の Source を **GitHub Actions** にする。  
3. `main` にプッシュすると [.github/workflows/deploy-github-pages.yml](.github/workflows/deploy-github-pages.yml) が走り、公開 URL は次の形式です。  
   `https://kjmanz.github.io/EigyoMap/`  
4. **Supabase Dashboard → Authentication → URL Configuration** に次を追加（ログイン・リダイレクト用）。  
   - Site URL: `https://kjmanz.github.io/EigyoMap/`  
   - Redirect URLs: `https://kjmanz.github.io/EigyoMap/**`  

ローカルでは `VITE_BASE_PATH` を省略（ルート `/`）。GitHub 上のビルドのみ `/EigyoMap/` がワークフローで指定されます。

## データバックアップ（要件 F-EXP-04）

- **Supabase Pro**: ダッシュボードで日次バックアップを有効化できます。
- **Free プラン**: 設定画面の「CSV をダウンロード」で手動エクスポートするか、将来的にスケジュール実行を検討してください。

## オフライン同期

未送信の顧客・メモは IndexedDB にキューされます。オンライン復帰時に自動同期するほか、画面上の「同期を試す」でも送信できます。競合解決はサーバー優先（最終書き込みはサーバー基準）を想定しています。

## PWA アイコン

`public/pwa-192.png` / `pwa-512.png` はプレースホルダです。必要に差し替えてください。
