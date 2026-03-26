import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { fileToBase64Payload } from "../lib/files";
import { deleteStoragePath, getSignedPhotoUrl, uploadContactPhotos } from "../lib/photos";
import {
  enqueueOffline,
  flushOfflineQueue,
  isOnline,
  type OfflineContactPayload,
} from "../lib/offline";
import { supabase } from "../lib/supabase";
import type { ContactLogRow, CustomerRow, PhotoRow } from "../lib/types";
import { useAuth } from "../contexts/AuthContext";

type LogWithPhotos = ContactLogRow & { photos: PhotoRow[] };

export function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const nav = useNavigate();
  const [customer, setCustomer] = useState<CustomerRow | null>(null);
  const [logs, setLogs] = useState<LogWithPhotos[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [memo, setMemo] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!id || !user) return;
    const { data: c } = await supabase.from("customers").select("*").eq("id", id).single();
    if (c) {
      const row = c as CustomerRow;
      setCustomer(row);
      setName(row.name);
      setMemo(row.memo ?? "");
    }
    const { data: lg } = await supabase
      .from("contact_logs")
      .select("*, photos(*)")
      .eq("customer_id", id)
      .order("pinned", { ascending: false })
      .order("visited_at", { ascending: false });
    if (lg) {
      const list = [...(lg as LogWithPhotos[])].sort((a, b) => {
        const pa = a.pinned ? 1 : 0;
        const pb = b.pinned ? 1 : 0;
        if (pa !== pb) return pb - pa;
        return new Date(b.visited_at).getTime() - new Date(a.visited_at).getTime();
      });
      setLogs(list);
      const nextUrls: Record<string, string> = {};
      for (const log of list) {
        for (const p of log.photos ?? []) {
          const u = await getSignedPhotoUrl(p.storage_path);
          if (u) nextUrls[p.id] = u;
        }
      }
      setUrls(nextUrls);
    }
  }, [id, user]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveCustomer() {
    if (!id || !customer) return;
    setBusy(true);
    try {
      const { error } = await supabase
        .from("customers")
        .update({
          name: name.trim(),
          memo: memo.trim() || null,
        })
        .eq("id", id);
      if (error) {
        alert(error.message);
        return;
      }
      setEditing(false);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function deleteCustomer() {
    if (!id || !confirm("この顧客と関連メモ・写真を削除しますか？")) return;
    setBusy(true);
    try {
      const { data: logRows } = await supabase.from("contact_logs").select("id").eq("customer_id", id);
      const logIds = (logRows ?? []).map((r) => r.id as string);
      if (logIds.length > 0) {
        const { data: phs } = await supabase
          .from("photos")
          .select("storage_path")
          .in("contact_log_id", logIds);
        for (const p of phs ?? []) {
          try {
            await deleteStoragePath((p as { storage_path: string }).storage_path);
          } catch {
            /* ignore */
          }
        }
      }
      const { error } = await supabase.from("customers").delete().eq("id", id);
      if (error) {
        alert(error.message);
        return;
      }
      nav("/");
    } finally {
      setBusy(false);
    }
  }

  async function addMemo(files: FileList | null, memoText: string) {
    if (!id || !user) return;
    const visitedAt = new Date().toISOString();
    const blobs: OfflineContactPayload["photoBlobs"] = [];
    if (files) {
      for (const f of Array.from(files)) {
        const dataBase64 = await fileToBase64Payload(f);
        blobs.push({ name: f.name, type: f.type, dataBase64 });
      }
    }
    if (!isOnline()) {
      await enqueueOffline({
        id: crypto.randomUUID(),
        kind: "contact_log",
        payload: {
          customerId: id,
          memo: memoText,
          visitedAt,
          photoBlobs: blobs,
        },
      });
      alert("オフラインのためキューに保存しました。");
      return;
    }
    const { data: logRow, error } = await supabase
      .from("contact_logs")
      .insert({
        customer_id: id,
        user_id: user.id,
        memo: memoText,
        visited_at: visitedAt,
        pinned: false,
      })
      .select("id")
      .single();
    if (error) {
      alert(error.message);
      return;
    }
    const logId = logRow.id as string;
    if (files && files.length > 0) {
      await uploadContactPhotos(user.id, logId, Array.from(files));
    }
    await load();
  }

  async function togglePin(log: LogWithPhotos) {
    const next = !log.pinned;
    const { error } = await supabase
      .from("contact_logs")
      .update({ pinned: next })
      .eq("id", log.id);
    if (error) {
      alert(error.message);
      return;
    }
    await load();
  }

  async function deleteLog(log: LogWithPhotos) {
    if (!confirm("このメモを削除しますか？")) return;
    for (const p of log.photos ?? []) {
      try {
        await deleteStoragePath(p.storage_path);
      } catch {
        /* ignore */
      }
    }
    const { error } = await supabase.from("contact_logs").delete().eq("id", log.id);
    if (error) alert(error.message);
    else await load();
  }

  if (!id) return null;
  if (!customer) {
    return (
      <div className="p-4 text-gray-600">
        読み込み中…
        <div className="mt-4">
          <Link to="/" className="text-accent underline">
            地図へ
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white pb-24">
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-gray-200 bg-white px-3 py-2">
        <button type="button" className="text-sm text-accent" onClick={() => nav(-1)}>
          戻る
        </button>
        <h1 className="min-w-0 flex-1 truncate text-lg font-semibold text-gray-800">
          {customer.name}
        </h1>
        <Link to={`/?highlight=${customer.id}`} className="text-xs text-accent">
          地図
        </Link>
      </header>

      <div className="p-4">
        {!editing ? (
          <>
            {customer.memo && <p className="text-sm text-gray-800">{customer.memo}</p>}
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded border border-gray-300 px-3 py-2 text-sm"
                onClick={() => setEditing(true)}
              >
                編集
              </button>
              <button
                type="button"
                className="rounded border border-red-200 px-3 py-2 text-sm text-red-700"
                onClick={() => void deleteCustomer()}
                disabled={busy}
              >
                削除
              </button>
            </div>
          </>
        ) : (
          <div className="flex flex-col gap-2">
            <label className="text-sm">
              お客様名
              <input
                className="mt-1 w-full rounded border border-gray-300 px-2 py-2"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="text-sm">
              メモ（任意）
              <textarea
                className="mt-1 w-full rounded border border-gray-300 px-2 py-2"
                rows={3}
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
              />
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                className="rounded bg-accent px-4 py-2 text-sm text-white"
                onClick={() => void saveCustomer()}
                disabled={busy}
              >
                保存
              </button>
              <button
                type="button"
                className="rounded border border-gray-300 px-4 py-2 text-sm"
                onClick={() => setEditing(false)}
              >
                キャンセル
              </button>
            </div>
          </div>
        )}
      </div>

      <section className="border-t border-gray-100 px-4 py-3">
        <h2 className="text-sm font-medium text-gray-700">タイムライン</h2>
        <ul className="mt-2 space-y-3">
          {logs.map((log) => (
            <li
              key={log.id}
              className={`rounded border p-3 text-sm ${
                log.pinned ? "border-accent bg-blue-50/80" : "border-gray-200"
              }`}
            >
              <div className="flex justify-between gap-2 text-xs text-gray-500">
                <div className="flex flex-wrap items-center gap-2">
                  {log.pinned && (
                    <span className="rounded bg-accent px-1.5 py-0.5 text-[10px] font-medium text-white">
                      ピン留め
                    </span>
                  )}
                  <time dateTime={log.visited_at}>
                    {new Date(log.visited_at).toLocaleString("ja-JP")}
                  </time>
                </div>
                <div className="flex shrink-0 flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    className="text-gray-700"
                    onClick={() => void togglePin(log)}
                    disabled={busy}
                    title={log.pinned ? "ピンを外す" : "ピン留め"}
                  >
                    {log.pinned ? "解除" : "ピン留め"}
                  </button>
                  <Link to={`/customer/${id}/memo/${log.id}`} className="text-accent">
                    編集
                  </Link>
                  <button type="button" className="text-red-600" onClick={() => void deleteLog(log)}>
                    削除
                  </button>
                </div>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-gray-800">{log.memo}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {(log.photos ?? []).map((p) =>
                  urls[p.id] ? (
                    <a key={p.id} href={urls[p.id]} target="_blank" rel="noreferrer">
                      <img
                        src={urls[p.id]}
                        alt=""
                        className="h-20 w-20 rounded object-cover"
                      />
                    </a>
                  ) : null
                )}
              </div>
            </li>
          ))}
        </ul>
        {logs.length === 0 && <p className="text-sm text-gray-500">メモはまだありません。</p>}
      </section>

      <MemoComposer
        onSubmit={(text, files) => void addMemo(files, text)}
        onSync={() => void flushOfflineQueue().then(() => load())}
      />
    </div>
  );
}

function MemoComposer({
  onSubmit,
  onSync,
}: {
  onSubmit: (text: string, files: FileList | null) => void;
  onSync: () => void;
}) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<FileList | null>(null);
  const [fileKey, setFileKey] = useState(0);

  return (
    <div className="fixed bottom-0 left-0 right-0 border-t border-gray-200 bg-white p-3 shadow-lg">
      <p className="text-xs text-gray-600">メモ追加（音声入力はキーボードのマイクから利用できます）</p>
      <textarea
        className="mt-2 w-full rounded border border-gray-300 px-2 py-2 text-sm"
        rows={2}
        placeholder="訪問内容"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <input
        key={fileKey}
        type="file"
        accept="image/*"
        multiple
        capture="environment"
        className="mt-2 text-sm"
        onChange={(e) => setFiles(e.target.files)}
      />
      <div className="mt-2 flex justify-between gap-2">
        <button type="button" className="text-xs text-accent underline" onClick={onSync}>
          オフライン同期
        </button>
        <button
          type="button"
          className="rounded bg-accent px-4 py-2 text-sm text-white"
          onClick={() => {
            onSubmit(text, files);
            setText("");
            setFiles(null);
            setFileKey((k) => k + 1);
          }}
        >
          保存
        </button>
      </div>
    </div>
  );
}
