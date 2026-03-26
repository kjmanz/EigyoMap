import { useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";

export function SettingsPage() {
  const { user, signOut, configured } = useAuth();
  const [exporting, setExporting] = useState(false);
  const [exportErr, setExportErr] = useState<string | null>(null);

  async function exportCsv() {
    if (!configured) return;
    setExporting(true);
    setExportErr(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) {
        setExportErr("セッションがありません");
        return;
      }
      const base = import.meta.env.VITE_SUPABASE_URL.replace(/\/$/, "");
      const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;
      const res = await fetch(`${base}/functions/v1/export-csv`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          apikey: anon,
          "Content-Type": "application/json",
        },
        body: "{}",
      });
      if (!res.ok) {
        const t = await res.text();
        setExportErr(t || `HTTP ${res.status}`);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `machimap-export-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setExportErr(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="min-h-screen bg-white p-4">
      <header className="mb-6 flex items-center gap-2">
        <Link to="/" className="text-sm text-accent">
          地図
        </Link>
        <h1 className="text-lg font-semibold text-gray-800">設定</h1>
      </header>

      <section className="mb-8">
        <h2 className="text-sm font-medium text-gray-700">アカウント</h2>
        <p className="mt-1 text-xs text-gray-500">{user?.email ?? "—"}</p>
        <button
          type="button"
          className="mt-3 rounded border border-gray-300 px-4 py-2 text-sm"
          onClick={() => void signOut()}
        >
          ログアウト
        </button>
      </section>

      <section className="mb-8">
        <h2 className="text-sm font-medium text-gray-700">データ</h2>
        <p className="mt-1 text-xs text-gray-500">
          日次バックアップは Supabase ダッシュボードのバックアップ設定（Pro
          プラン）で有効化できます。Free プランでは CSV を手動で保存するか、定期エクスポートを別途検討してください。
        </p>
        <button
          type="button"
          className="mt-3 rounded bg-accent px-4 py-2 text-sm text-white disabled:opacity-50"
          disabled={!configured || exporting}
          onClick={() => void exportCsv()}
        >
          {exporting ? "出力中…" : "CSV をダウンロード"}
        </button>
        {exportErr && <p className="mt-2 text-xs text-red-600">{exportErr}</p>}
      </section>

      <p className="text-[10px] text-gray-400">
        LINE 連携・Google 連携は Phase 2 以降の予定です。
      </p>
    </div>
  );
}
