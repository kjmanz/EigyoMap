import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import type { LabelRow } from "../lib/types";
import { useAuth } from "../contexts/AuthContext";

export function SettingsPage() {
  const { user, signOut, configured } = useAuth();
  const [exporting, setExporting] = useState(false);
  const [exportErr, setExportErr] = useState<string | null>(null);

  const [labels, setLabels] = useState<LabelRow[]>([]);
  const [labelsLoading, setLabelsLoading] = useState(false);
  const [labelsErr, setLabelsErr] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#6b7280");
  const [labelBusyId, setLabelBusyId] = useState<string | null>(null);

  const loadLabels = useCallback(async () => {
    if (!user) return;
    setLabelsLoading(true);
    setLabelsErr(null);
    const { data, error } = await supabase
      .from("labels")
      .select("*")
      .eq("user_id", user.id)
      .order("name");
    setLabelsLoading(false);
    if (error) {
      setLabelsErr(error.message);
      return;
    }
    setLabels((data ?? []) as LabelRow[]);
  }, [user]);

  useEffect(() => {
    void loadLabels();
  }, [loadLabels]);

  async function addLabel() {
    if (!user || !newName.trim()) return;
    setLabelBusyId("__new__");
    setLabelsErr(null);
    const { error } = await supabase.from("labels").insert({
      user_id: user.id,
      name: newName.trim(),
      color: newColor,
    });
    setLabelBusyId(null);
    if (error) {
      setLabelsErr(error.message);
      return;
    }
    setNewName("");
    setNewColor("#6b7280");
    await loadLabels();
  }

  async function updateLabel(row: LabelRow, name: string, color: string) {
    setLabelBusyId(row.id);
    setLabelsErr(null);
    const { error } = await supabase
      .from("labels")
      .update({ name: name.trim(), color })
      .eq("id", row.id);
    setLabelBusyId(null);
    if (error) {
      setLabelsErr(error.message);
      return;
    }
    await loadLabels();
  }

  async function deleteLabel(id: string) {
    if (!confirm("このラベルを削除しますか？紐づいた顧客からも外れます。")) return;
    setLabelBusyId(id);
    setLabelsErr(null);
    const { error } = await supabase.from("labels").delete().eq("id", id);
    setLabelBusyId(null);
    if (error) {
      setLabelsErr(error.message);
      return;
    }
    await loadLabels();
  }

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
        <h2 className="text-sm font-medium text-gray-700">ゴミ箱</h2>
        <p className="mt-1 text-xs text-gray-500">
          削除した顧客・メモは 30 日以内に復元できます。期限後は完全に削除されます。
        </p>
        <Link
          to="/trash"
          className="mt-3 inline-block rounded border border-gray-300 px-4 py-2 text-sm text-gray-800"
        >
          ゴミ箱を開く
        </Link>
      </section>

      <section className="mb-8">
        <h2 className="text-sm font-medium text-gray-700">ラベル</h2>
        <p className="mt-1 text-xs text-gray-500">
          顧客に複数付けられます。地図のピン色は、名前順で最初のラベルの色が使われます。
        </p>
        {labelsErr && <p className="mt-2 text-xs text-red-600">{labelsErr}</p>}
        {labelsLoading && labels.length === 0 ? (
          <p className="mt-2 text-xs text-gray-500">読み込み中…</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {labels.map((row) => (
              <LabelEditRow
                key={row.id}
                row={row}
                busy={labelBusyId === row.id}
                onSave={(name, color) => void updateLabel(row, name, color)}
                onDelete={() => void deleteLabel(row.id)}
              />
            ))}
          </ul>
        )}
        <div className="mt-4 flex flex-wrap items-end gap-2 border-t border-gray-100 pt-4">
          <label className="text-xs text-gray-600">
            新規名前
            <input
              className="mt-1 block w-40 rounded border border-gray-300 px-2 py-1.5 text-sm"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="例: 見込み"
            />
          </label>
          <label className="text-xs text-gray-600">
            色
            <input
              type="color"
              className="mt-1 block h-9 w-14 cursor-pointer rounded border border-gray-300"
              value={newColor}
              onChange={(e) => setNewColor(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="rounded bg-accent px-3 py-2 text-sm text-white disabled:opacity-50"
            disabled={!configured || !newName.trim() || labelBusyId !== null}
            onClick={() => void addLabel()}
          >
            追加
          </button>
        </div>
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

function LabelEditRow({
  row,
  busy,
  onSave,
  onDelete,
}: {
  row: LabelRow;
  busy: boolean;
  onSave: (name: string, color: string) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(row.name);
  const [color, setColor] = useState(row.color);

  useEffect(() => {
    setName(row.name);
    setColor(row.color);
  }, [row.name, row.color]);

  return (
    <li className="flex flex-wrap items-end gap-2 rounded border border-gray-200 p-2">
      <label className="min-w-0 flex-1 text-xs text-gray-600">
        名前
        <input
          className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label className="text-xs text-gray-600">
        色
        <input
          type="color"
          className="mt-1 block h-9 w-14 cursor-pointer rounded border border-gray-300"
          value={color}
          onChange={(e) => setColor(e.target.value)}
        />
      </label>
      <button
        type="button"
        className="rounded border border-gray-300 px-2 py-1.5 text-xs"
        disabled={busy || !name.trim()}
        onClick={() => onSave(name, color)}
      >
        保存
      </button>
      <button
        type="button"
        className="rounded border border-red-200 px-2 py-1.5 text-xs text-red-700"
        disabled={busy}
        onClick={onDelete}
      >
        削除
      </button>
    </li>
  );
}
