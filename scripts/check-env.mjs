/**
 * .env に VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY があるか確認する（値の中身は表示しない）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const envPath = path.join(root, ".env");

function mask(v) {
  if (!v || v.length < 8) return v ? "***" : "";
  return `${v.slice(0, 6)}…${v.slice(-4)}`;
}

if (!fs.existsSync(envPath)) {
  console.error("❌ .env がありません。");
  console.error("   .env.example をコピーして .env を作成し、Supabase の Project URL と anon キーを貼ってください。");
  console.error("   手順: docs/SETUP_SUPABASE.md");
  process.exit(1);
}

const raw = fs.readFileSync(envPath, "utf8");
const vars = {};
for (const line of raw.split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const eq = t.indexOf("=");
  if (eq === -1) continue;
  const key = t.slice(0, eq).trim();
  let val = t.slice(eq + 1).trim();
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    val = val.slice(1, -1);
  }
  vars[key] = val;
}

let ok = true;
const url = vars.VITE_SUPABASE_URL;
const key = vars.VITE_SUPABASE_ANON_KEY;

if (!url || url.includes("xxxx")) {
  console.error("❌ VITE_SUPABASE_URL が未設定かプレースホルダのままです。");
  ok = false;
} else {
  try {
    const u = new URL(url);
    if (!u.hostname.endsWith(".supabase.co")) {
      console.warn("⚠️  ホスト名が通常の Supabase 形式ではありません:", u.hostname);
    }
    console.log("✓ VITE_SUPABASE_URL =", url);
  } catch {
    console.error("❌ VITE_SUPABASE_URL が有効な URL ではありません。");
    if (url && /^[a-z0-9]{15,30}$/i.test(url) && !url.includes("/")) {
      console.error(
        "   プロジェクト参照（英数字だけ）が入っている可能性があります。例:\n" +
          `   VITE_SUPABASE_URL=https://${url}.supabase.co`
      );
    }
    ok = false;
  }
}

if (!key || key === "your-anon-key" || key.length < 20) {
  console.error("❌ VITE_SUPABASE_ANON_KEY が未設定か短すぎます。");
  ok = false;
} else {
  console.log("✓ VITE_SUPABASE_ANON_KEY =", mask(key), "（先頭・末尾のみ表示）");
}

if (ok) {
  console.log("\n環境変数の項目は揃っています。次は SQL マイグレーションと Edge Function デプロイです。docs/SETUP_SUPABASE.md を参照してください。");
  process.exit(0);
}

console.error("\n詳細: docs/SETUP_SUPABASE.md");
process.exit(1);
