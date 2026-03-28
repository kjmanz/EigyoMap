# Supabase 連携：何をどこで手に入れるか

「プロジェクト URL」と「プロジェクト ID」が混ざりやすいので、**アプリに書くのは次の 2 つだけ**だと思ってください。

| 環境変数 | あなたが取得する場所 |
|----------|----------------------|
| `VITE_SUPABASE_URL` | Dashboard → **Project Settings** → **API** → **Project URL**（**`https://....supabase.co` まで含めた全文**。英数字だけの「参照」だけ入れると失敗します） |
| `VITE_SUPABASE_ANON_KEY` | 同じ画面の **Project API keys** → **anon** の **public** キー（長い `eyJ...`） |

- **Project URL** = ブラウザが Supabase に接続するときの「住所」です。  
- URL の `https://` と `.supabase.co` の**真ん中の英数字**（例: `abcdxyz123`）が **project reference** です。CLI の `supabase link` で聞かれるのは多くの場合これです。**別物の UUID を貼らないよう、API 画面の URL をそのままコピーするのが安全**です。

**絶対にフロントに書かないもの:** `service_role` キー（管理者用）。漏れるとデータが全部読まれます。

**PostGIS を Dashboard で ON にできない（タイムアウト）場合:** 現在のマイグレーションは **PostGIS 不要**です（近接判定はハーバーサイン式の SQL）。**postgis 拡張は有効にしなくて構いません。**

**以前の版（PostGIS 版）を途中まで流した場合:** SQL Editor で次を実行してから、更新後の `find_nearby_customers` とインデックス部分だけ流し直してください。

```sql
DROP INDEX IF EXISTS public.customers_location_gix;
CREATE INDEX IF NOT EXISTS customers_lat_lng_idx ON public.customers (lat, lng);
```

その後、`20260326000000_init.sql` 内の `find_nearby_customers` の `CREATE OR REPLACE FUNCTION` ブロックを単体で実行。

---

## チェックリスト（あなた側でやること）

1. [ ] [Supabase](https://supabase.com/dashboard) でアカウント作成・**新規プロジェクト作成**（リージョン・DB パスワードを決める）
2. [ ] **Project Settings → API** で **Project URL** と **anon public** をコピー
3. [ ] このリポジトリ直下に `.env` を作り、次を貼る（`.env.example` をコピーしてよい）

```env
VITE_SUPABASE_URL=（Project URL をそのまま）
VITE_SUPABASE_ANON_KEY=（anon public をそのまま）
```

4. [ ] **SQL Editor** を開き、`supabase/migrations/20260326000000_init.sql` の**全文**を貼って **Run**（または CLI で `supabase db push`）
5. [ ] 同様に `supabase/migrations/20260326000002_contact_logs_pinned.sql` を実行（タイムラインのピン留め機能用。既に `init` に `pinned` を含めて流した場合のみスキップ可）
6. [ ] `supabase/migrations/20260328120000_soft_delete_restore.sql` を実行（ゴミ箱・30 日以内復元・認証ユーザーからの `DELETE` 廃止）
7. [ ] PC に [Supabase CLI](https://supabase.com/docs/guides/cli) を入れ、`supabase login` → `supabase link --project-ref <reference>` → `supabase functions deploy export-csv`
   - `<reference>` は Project URL のサブドメイン部分だけ（`.supabase.co` の前）
8. [ ] （任意）期限切れデータの完全削除と Storage 掃除: `supabase functions deploy purge-soft-deleted` のあと、ダッシュボードの **Edge Functions → Schedules** などで `purge-soft-deleted` を定期実行する。**Authorization には `service_role` キーを Bearer で渡す**（フロントや anon には載せない）。SQL のみで行う場合は SQL Editor で `select public.purge_expired_soft_deletes();` を `service_role` 相当の権限で実行できるが、この場合 **Storage 上の写真ファイルは残る**ことがあるため、本番では Edge Function 側のパージを推奨する。

ローカルで `npm run check:env` を実行し、不足がないか確認してください。

---

## よくある質問

**Q. Project URL と Project ID は違う？**  
A. **違います。** アプリに必要なのは **Project URL（フル）** と **anon キー**です。「ID」は reference（URL の一部）と混同されやすいです。

**Q. マイグレーションは何度も流す？**  
A. **初回だけ**です。同じ SQL をもう一度流すと「既に存在する」系でエラーになることがあります。そのときはエラー内容を見て、必要なら Supabase サポートまたは開発者に相談してください。

**Q. CSV がダウンロードできない**  
A. `export-csv` がデプロイ済みか、ログイン済みか、`.env` が開発サーバー起動前に保存されているかを確認してください。

---

## こちら（リポジトリ）に最初から入っているもの

- DB 定義: `supabase/migrations/20260326000000_init.sql` ほか（ソフトデリートは `20260328120000_soft_delete_restore.sql`）
- CSV 出力 API: `supabase/functions/export-csv/`
- 期限切れゴミ箱のパージ（任意）: `supabase/functions/purge-soft-deleted/`
- フロントの接続先読み込み: `src/lib/supabase.ts`（`import.meta.env`）

あなたのプロジェクト専用の値は **Supabase ダッシュボードからだけ**取得します。リポジトリには秘密をコミットしないでください（`.gitignore` に `.env` があります）。
