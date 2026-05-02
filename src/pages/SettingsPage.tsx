import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AppHeader } from "../components/AppHeader";
import { BottomNav } from "../components/BottomNav";
import { DesktopAppShell } from "../components/DesktopAppShell";
import { parseCustomerImportCsv, type CustomerImportDraft } from "../lib/csvImport";
import { geocodeAddress } from "../lib/geocoder";
import { supabase } from "../lib/supabase";
import type { LabelRow } from "../lib/types";
import { useAuth } from "../contexts/AuthContext";

type ImportPreviewRow = CustomerImportDraft & {
  status: "ready" | "error" | "importing" | "imported";
  geocodeTitle?: string;
  importError?: string;
};

export function SettingsPage() {
  const { user, signOut, configured } = useAuth();
  const [exporting, setExporting] = useState(false);
  const [exportErr, setExportErr] = useState<string | null>(null);
  const [importRows, setImportRows] = useState<ImportPreviewRow[]>([]);
  const [importFileName, setImportFileName] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [importErr, setImportErr] = useState<string | null>(null);

  const [labels, setLabels] = useState<LabelRow[]>([]);
  const [labelsLoading, setLabelsLoading] = useState(false);
  const [labelsErr, setLabelsErr] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#6b7280");
  const [labelBusyId, setLabelBusyId] = useState<string | null>(null);

  const importReadyCount = useMemo(
    () => importRows.filter((row) => row.status === "ready" && row.lat != null && row.lng != null).length,
    [importRows]
  );
  const importErrorCount = useMemo(
    () => importRows.filter((row) => row.status === "error").length,
    [importRows]
  );

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

  async function onImportFile(file: File | null) {
    if (!file) return;

    setImportFileName(file.name);
    setImportRows([]);
    setImportMsg(null);
    setImportErr(null);
    setImportBusy(true);

    try {
      const text = await file.text();
      const drafts = parseCustomerImportCsv(text);
      if (drafts.length === 0) {
        setImportErr("CSVに読み込める行がありません。1行目に見出しを入れてください。");
        return;
      }

      let next: ImportPreviewRow[] = drafts.map((draft) => ({
        ...draft,
        status: draft.errors.length > 0 ? "error" : "ready",
      }));
      setImportRows(next);
      setImportMsg(`${next.length}行を読み込みました。住所を座標に変換しています…`);

      for (let i = 0; i < next.length; i++) {
        const row = next[i];
        if (row.status === "error" || row.lat != null || row.lng != null || !row.address) continue;

        try {
          const geo = await geocodeAddress(row.address);
          next = [...next];
          next[i] = {
            ...row,
            lat: geo.lat,
            lng: geo.lng,
            geocodeTitle: geo.title,
            source: "address",
          };
          setImportRows(next);
        } catch (e) {
          next = [...next];
          next[i] = {
            ...row,
            status: "error",
            errors: [...row.errors, e instanceof Error ? e.message : String(e)],
          };
          setImportRows(next);
        }
      }

      const ready = next.filter((row) => row.status === "ready" && row.lat != null && row.lng != null).length;
      const failed = next.filter((row) => row.status === "error").length;
      setImportMsg(`${ready}行を登録できます。${failed > 0 ? `${failed}行は修正が必要です。` : ""}`);
    } catch (e) {
      setImportErr(e instanceof Error ? e.message : String(e));
    } finally {
      setImportBusy(false);
    }
  }

  async function importCsvRows() {
    if (!user || importReadyCount === 0) return;

    setImportBusy(true);
    setImportErr(null);
    setImportMsg("登録しています…");

    const rows = importRows.filter(
      (row) => row.status === "ready" && row.lat != null && row.lng != null
    );

    try {
      const labelByName = new Map(labels.map((label) => [labelKey(label.name), label]));
      const labelNames = [...new Set(rows.flatMap((row) => row.labels))];
      const missingLabelNames = labelNames.filter((name) => !labelByName.has(labelKey(name)));

      if (missingLabelNames.length > 0) {
        const { data, error } = await supabase
          .from("labels")
          .insert(missingLabelNames.map((name) => ({ user_id: user.id, name, color: "#6b7280" })))
          .select("*");
        if (error) throw error;
        for (const label of (data ?? []) as LabelRow[]) {
          labelByName.set(labelKey(label.name), label);
        }
      }

      let imported = 0;
      for (const row of rows) {
        const lat = row.lat;
        const lng = row.lng;
        if (lat == null || lng == null) continue;

        setImportRows((prev) =>
          prev.map((item) =>
            item.rowNumber === row.rowNumber ? { ...item, status: "importing" } : item
          )
        );

        const { data: inserted, error } = await supabase
          .from("customers")
          .insert({
            user_id: user.id,
            name: row.name,
            address: row.address || null,
            phone: row.phone,
            memo: row.memo,
            lat,
            lng,
          })
          .select("id")
          .single();

        if (error || !inserted?.id) {
          setImportRows((prev) =>
            prev.map((item) =>
              item.rowNumber === row.rowNumber
                ? {
                    ...item,
                    status: "error",
                    importError: error?.message ?? "登録に失敗しました",
                  }
                : item
            )
          );
          continue;
        }

        const customerId = inserted.id as string;
        const labelIds = row.labels
          .map((name) => labelByName.get(labelKey(name))?.id)
          .filter((id): id is string => Boolean(id));
        if (labelIds.length > 0) {
          const { error: labelError } = await supabase.from("customer_labels").insert(
            labelIds.map((labelId) => ({ customer_id: customerId, label_id: labelId }))
          );
          if (labelError) {
            setImportRows((prev) =>
              prev.map((item) =>
                item.rowNumber === row.rowNumber
                  ? {
                      ...item,
                      status: "error",
                      importError: `顧客は登録済みですが、ラベル登録に失敗しました: ${labelError.message}`,
                    }
                  : item
              )
            );
            continue;
          }
        }

        imported++;
        setImportRows((prev) =>
          prev.map((item) =>
            item.rowNumber === row.rowNumber
              ? { ...item, status: "imported", importError: undefined }
              : item
          )
        );
      }

      await loadLabels();
      setImportMsg(`${imported}件の顧客を登録しました。地図と一覧に反映されます。`);
    } catch (e) {
      setImportErr(e instanceof Error ? e.message : String(e));
    } finally {
      setImportBusy(false);
    }
  }

  function downloadImportTemplate() {
    const rows = [
      ["customer_name", "address", "phone", "customer_memo", "lat", "lng", "labels"],
      ["山田商店", "東京都千代田区永田町1-7-1", "03-0000-0000", "初回訪問予定", "", "", "見込み"],
    ];
    const body = `\uFEFF${rows.map((row) => row.map(csvEscape).join(",")).join("\n")}`;
    const blob = new Blob([body], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "machimap-import-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <DesktopAppShell sidebarActive="settings">
      <div className="flex min-h-screen flex-col bg-white pb-16 lg:min-h-0 lg:flex-1 lg:overflow-auto lg:bg-gray-50/40 lg:pb-0">
      <AppHeader variant="main" title="設定" activeNav="settings" />
      <div className="p-4 lg:mx-auto lg:max-w-2xl lg:pb-12 lg:pt-2">
      <section className="mb-8">
        <h2 className="text-sm font-medium text-gray-700">アカウント</h2>
        <p className="mt-1 text-xs text-gray-500">{user?.email ?? "—"}</p>
        <button
          type="button"
          className="mt-3 rounded border border-gray-300 px-4 py-2 text-sm lg:px-5 lg:hover:bg-gray-50"
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
          className="mt-3 inline-block rounded border border-gray-300 px-4 py-2 text-sm text-gray-800 lg:hover:bg-gray-50"
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

        <div className="mt-6 border-t border-gray-100 pt-5">
          <h3 className="text-sm font-medium text-gray-700">CSV インポート</h3>
          <p className="mt-1 text-xs leading-5 text-gray-500">
            推奨列は customer_name, address, phone, customer_memo, lat, lng, labels です。
            lat/lng が空の場合は住所から座標を取得します。
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <label className="cursor-pointer rounded border border-gray-300 px-4 py-2 text-sm text-gray-800 lg:hover:bg-gray-50">
              CSV を選択
              <input
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                disabled={!configured || importBusy}
                onChange={(e) => {
                  void onImportFile(e.target.files?.[0] ?? null);
                  e.currentTarget.value = "";
                }}
              />
            </label>
            <button
              type="button"
              className="rounded border border-gray-300 px-4 py-2 text-sm text-gray-800 lg:hover:bg-gray-50"
              onClick={downloadImportTemplate}
            >
              テンプレートをダウンロード
            </button>
            <button
              type="button"
              className="rounded bg-accent px-4 py-2 text-sm text-white disabled:opacity-50"
              disabled={!configured || importBusy || importReadyCount === 0}
              onClick={() => void importCsvRows()}
            >
              {importBusy ? "処理中…" : `${importReadyCount}件を登録`}
            </button>
          </div>

          {importFileName && (
            <p className="mt-2 text-xs text-gray-500">
              選択中: {importFileName}
              {importRows.length > 0 && (
                <span>
                  {" "} / 登録可能 {importReadyCount} 件 / 要確認 {importErrorCount} 件
                </span>
              )}
            </p>
          )}
          {importMsg && <p className="mt-2 text-xs text-green-700">{importMsg}</p>}
          {importErr && <p className="mt-2 text-xs text-red-600">{importErr}</p>}

          {importRows.length > 0 && (
            <div className="mt-3 max-h-80 overflow-auto rounded border border-gray-200 bg-white">
              <table className="min-w-full text-left text-xs">
                <thead className="sticky top-0 bg-gray-50 text-gray-600">
                  <tr>
                    <th className="whitespace-nowrap px-3 py-2 font-medium">行</th>
                    <th className="whitespace-nowrap px-3 py-2 font-medium">状態</th>
                    <th className="min-w-32 px-3 py-2 font-medium">お客様名</th>
                    <th className="min-w-56 px-3 py-2 font-medium">住所</th>
                    <th className="whitespace-nowrap px-3 py-2 font-medium">座標</th>
                    <th className="min-w-32 px-3 py-2 font-medium">メモ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {importRows.map((row) => (
                    <tr key={row.rowNumber} className={row.status === "error" ? "bg-red-50/50" : ""}>
                      <td className="whitespace-nowrap px-3 py-2 text-gray-500">{row.rowNumber}</td>
                      <td className="whitespace-nowrap px-3 py-2">
                        <ImportStatusBadge row={row} />
                      </td>
                      <td className="px-3 py-2 text-gray-800">{row.name}</td>
                      <td className="px-3 py-2 text-gray-700">
                        <div>{row.address || "—"}</div>
                        {row.geocodeTitle && row.geocodeTitle !== row.address && (
                          <div className="mt-0.5 text-[11px] text-gray-400">{row.geocodeTitle}</div>
                        )}
                        {row.warnings.map((warning) => (
                          <div key={warning} className="mt-0.5 text-[11px] text-amber-700">{warning}</div>
                        ))}
                        {[...row.errors, row.importError].filter(Boolean).map((error) => (
                          <div key={error} className="mt-0.5 text-[11px] text-red-600">{error}</div>
                        ))}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-[11px] text-gray-600">
                        {row.lat != null && row.lng != null
                          ? `${row.lat.toFixed(6)}, ${row.lng.toFixed(6)}`
                          : "—"}
                      </td>
                      <td className="px-3 py-2 text-gray-600">
                        {row.labels.length > 0 && (
                          <div className="mb-1 flex flex-wrap gap-1">
                            {row.labels.map((label) => (
                              <span key={label} className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px]">
                                {label}
                              </span>
                            ))}
                          </div>
                        )}
                        {row.memo || row.phone || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <p className="text-[10px] text-gray-400">
        LINE 連携・Google 連携は Phase 2 以降の予定です。
      </p>
      </div>
      <BottomNav active="settings" />
      </div>
    </DesktopAppShell>
  );
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function labelKey(value: string): string {
  return value.trim().normalize("NFKC").toLowerCase();
}

function ImportStatusBadge({ row }: { row: ImportPreviewRow }) {
  if (row.status === "imported") {
    return <span className="rounded-full bg-green-100 px-2 py-0.5 text-green-800">登録済み</span>;
  }
  if (row.status === "importing") {
    return <span className="rounded-full bg-blue-100 px-2 py-0.5 text-blue-800">登録中</span>;
  }
  if (row.status === "error") {
    return <span className="rounded-full bg-red-100 px-2 py-0.5 text-red-700">要確認</span>;
  }
  if (row.source === "coordinates") {
    return <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-700">座標あり</span>;
  }
  return <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-800">変換済み</span>;
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
