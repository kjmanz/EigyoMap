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
4. **Supabase の URL 設定**（下記「Supabase の URL Configuration の意味」参照）。

ローカルでは `VITE_BASE_PATH` を省略（ルート `/`）。GitHub 上のビルドのみ `/EigyoMap/` がワークフローで指定されます。

### GitHub の Actions タブで「走ったか」を見る

1. ブラウザで [EigyoMap の Actions](https://github.com/kjmanz/EigyoMap/actions) を開く（リポジトリ上部メニューの **Actions**）。  
2. 左または一覧に **Deploy to GitHub Pages** というワークフロー名が出る。  
3. 行をクリックすると、その実行の詳細。左上が **緑のチェック** なら成功、**赤の X** なら失敗（ログで原因を確認）。  
4. `main` にプッシュするたびに自動で 1 回走る。手動で再実行する場合は、該当実行のページ右上 **Re-run jobs**。

### Supabase の URL Configuration の意味（自分で入れる場所）

Supabase のダッシュボードにログイン → 左メニュー **Authentication**（人型アイコン）→ その中の **URL Configuration**（または Project Settings 内の Authentication 関連）。

- **Site URL**  
  「このアプリのいちばん代表的な公開アドレス」です。GitHub Pages なら  
  `https://kjmanz.github.io/EigyoMap/`  
  を指定します（末尾の `/` はあってもなくてもよいことが多いですが、README どおりで問題ありません）。

- **Redirect URLs**  
  メールリンクや OAuth でログインしたあと、**ブラウザをどの URL に戻してよいか** の許可リストです。GitHub Pages のパス配下を許可するために  
  `https://kjmanz.github.io/EigyoMap/**`  
  を 1 行追加します（`**` は「その下のどのパスでもよい」というワイルドカードです）。

ローカル開発（`http://localhost:5173` など）も使う場合は、同じ画面に `http://localhost:5173/**` を追加しておくと、本番と開発の両方でログインしやすくなります。

※ ここは **あなたの Supabase プロジェクトの画面**での操作のみです。GitHub から自動では設定されません。

## データバックアップ（要件 F-EXP-04）

- **Supabase Pro**: ダッシュボードで日次バックアップを有効化できます。
- **Free プラン**: 設定画面の「CSV をダウンロード」で手動エクスポートするか、将来的にスケジュール実行を検討してください。

## オフライン同期

未送信の顧客・メモは IndexedDB にキューされます。オンライン復帰時に自動同期するほか、画面上の「同期を試す」でも送信できます。競合解決はサーバー優先（最終書き込みはサーバー基準）を想定しています。

## PWA アイコン

- `public/favicon.svg` / `public/favicon-32x32.png`: ブラウザタブと通常ファビコン
- `public/apple-touch-icon.png`: iOS のホーム画面アイコン
- `public/pwa-192.png` / `public/pwa-512.png`: PWA インストール時と Android のホーム画面ショートカット用アイコン
- `public/pwa-192-maskable.png` / `public/pwa-512-maskable.png`: Android ランチャー向けの `maskable` アイコン
- 再生成する場合は `powershell -File scripts/generate-icons.ps1` を実行してください。
