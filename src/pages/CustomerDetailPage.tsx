import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { labelChipTextColor, toCustomerMapRow } from "../lib/customerLabels";
import { canRestore, daysUntilPermanentDeletion } from "../lib/softDelete";
import { fileToBase64Payload } from "../lib/files";
import { getSignedPhotoUrl, uploadContactPhotos } from "../lib/photos";
import {
  enqueueOffline,
  flushOfflineQueue,
  isOnline,
  type OfflineContactPayload,
} from "../lib/offline";
import { supabase } from "../lib/supabase";
import type { ContactLogRow, CustomerMapRow, LabelRow, PhotoRow } from "../lib/types";
import { useAuth } from "../contexts/AuthContext";

type LogWithPhotos = ContactLogRow & { photos: PhotoRow[] };

export function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const nav = useNavigate();
  const [customer, setCustomer] = useState<CustomerMapRow | null>(null);
  const [labelMaster, setLabelMaster] = useState<LabelRow[]>([]);
  const [selectedLabelIds, setSelectedLabelIds] = useState<string[]>([]);
  const [logs, setLogs] = useState<LogWithPhotos[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [memo, setMemo] = useState("");
  const [busy, setBusy] = useState(false);

  const loadLabels = useCallback(async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from("labels")
      .select("*")
      .eq("user_id", user.id)
      .order("name");
    if (!error && data) setLabelMaster(data as LabelRow[]);
  }, [user]);

  const load = useCallback(async () => {
    if (!id || !user) return;
    const { data: c } = await supabase
      .from("customers")
      .select("*, customer_labels(label_id, labels(id, name, color))")
      .eq("id", id)
      .single();
    if (c) {
      const mapRow = toCustomerMapRow(
        c as Parameters<typeof toCustomerMapRow>[0]
      );
      setCustomer(mapRow);
      setName(mapRow.name);
      setMemo(mapRow.memo ?? "");
      setSelectedLabelIds(mapRow.labels.map((l) => l.id));
    }
    const { data: lg } = await supabase
      .from("contact_logs")
      .select("*, photos(*)")
      .eq("customer_id", id)
      .is("deleted_at", null)
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

  useEffect(() => {
    void loadLabels();
  }, [loadLabels]);

  async function saveLabels() {
    if (!id || !customer) return;
    setBusy(true);
    try {
      const { error: delErr } = await supabase
        .from("customer_labels")
        .delete()
        .eq("customer_id", id);
      if (delErr) {
        alert(delErr.message);
        return;
      }
      for (const lid of selectedLabelIds) {
        const { error: insErr } = await supabase.from("customer_labels").insert({
          customer_id: id,
          label_id: lid,
        });
        if (insErr) {
          alert(insErr.message);
          await load();
          return;
        }
      }
      await load();
    } finally {
      setBusy(false);
    }
  }

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
    if (
      !id ||
      !confirm(
        "この顧客を削除しますか？メモ・写真は 30 日間ゴミ箱から復元できます。その後完全に削除されます。"
      )
    )
      return;
    setBusy(true);
    try {
      const { error } = await supabase
        .from("customers")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", id);
      if (error) {
        alert(error.message);
        return;
      }
      nav("/");
    } finally {
      setBusy(false);
    }
  }

  async function restoreCustomerFromDetail() {
    if (!id || !customer?.deleted_at) return;
    setBusy(true);
    try {
      const { error } = await supabase
        .from("customers")
        .update({ deleted_at: null })
        .eq("id", id);
      if (error) {
        alert(error.message);
        return;
      }
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function addMemo(files: File[] | null, memoText: string) {
    if (!id || !user) return;
    const visitedAt = new Date().toISOString();
    const blobs: OfflineContactPayload["photoBlobs"] = [];
    const fileArr = files ?? [];
    if (fileArr.length > 0) {
      for (const f of fileArr) {
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
    if (fileArr.length > 0) {
      await uploadContactPhotos(user.id, logId, fileArr);
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
    if (
      !confirm(
        "このメモを削除しますか？30 日間ゴミ箱から復元できます。その後完全に削除されます。"
      )
    )
      return;
    const { error } = await supabase
      .from("contact_logs")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", log.id);
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

  if (customer.deleted_at) {
    const ok = canRestore(customer.deleted_at);
    const days = daysUntilPermanentDeletion(customer.deleted_at);
    return (
      <div className="min-h-screen bg-white pb-24">
        <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-gray-200 bg-white px-3 py-2">
          <button type="button" className="text-sm text-accent" onClick={() => nav(-1)}>
            戻る
          </button>
          <h1 className="min-w-0 flex-1 truncate text-lg font-semibold text-gray-800">
            {customer.name}
          </h1>
          <Link to="/trash" className="text-xs text-accent">
            ゴミ箱
          </Link>
        </header>
        <div className="p-4">
          <p className="text-sm text-amber-900">この顧客は削除済みです。</p>
          <p className="mt-2 text-xs text-gray-600">
            削除日時: {new Date(customer.deleted_at).toLocaleString("ja-JP")}
            {days != null && ` ・ 完全削除まであと約 ${days} 日`}
          </p>
          {ok ? (
            <button
              type="button"
              className="mt-4 rounded bg-accent px-4 py-2 text-sm text-white disabled:opacity-50"
              disabled={busy}
              onClick={() => void restoreCustomerFromDetail()}
            >
              復元する
            </button>
          ) : (
            <p className="mt-4 text-sm text-gray-500">
              復元期限を過ぎています。データは次回の完全削除処理で消去されます。
            </p>
          )}
          <div className="mt-4">
            <Link to="/" className="text-sm text-accent underline">
              地図へ
            </Link>
          </div>
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
        {customer.labels.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-1.5">
            {customer.labels.map((lb) => (
              <span
                key={lb.id}
                className="inline-block rounded-full px-2 py-0.5 text-xs font-medium"
                style={{
                  backgroundColor: lb.color,
                  color: labelChipTextColor(lb.color),
                }}
              >
                {lb.name}
              </span>
            ))}
          </div>
        )}
        {!editing ? (
          <>
            <section className="rounded-xl border border-gray-200 border-l-4 border-l-accent bg-gradient-to-br from-slate-50 to-white py-3 pl-3 pr-3 shadow-sm">
              <h2 className="text-sm font-semibold text-gray-900">顧客メモ</h2>
              <p className="mt-1 text-[11px] leading-relaxed text-gray-500">
                登録時や共有用のメモです。訪問の記録は下のタイムラインに追加してください。
              </p>
              <div className="mt-3 text-sm leading-relaxed text-gray-800">
                {customer.memo?.trim() ? (
                  <p className="whitespace-pre-wrap">{customer.memo}</p>
                ) : (
                  <p className="text-gray-400">顧客メモはまだありません。「編集」から追加できます。</p>
                )}
              </div>
            </section>
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
            {isOnline() ? (
              <Link
                to={`/?relocate=${customer.id}`}
                className="mt-3 inline-block text-sm text-accent underline"
              >
                位置を地図で修正
              </Link>
            ) : (
              <p className="mt-3 text-xs text-gray-500">
                位置の修正はオンライン時に地図から行ってください。
              </p>
            )}
          </>
        ) : (
          <div className="flex flex-col gap-4">
            <label className="text-sm text-gray-800">
              お客様名
              <input
                className="mt-1 w-full rounded border border-gray-300 px-2 py-2"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <div className="rounded-xl border border-gray-200 border-l-4 border-l-accent bg-white py-3 pl-3 pr-3 shadow-sm">
              <h3 className="text-sm font-semibold text-gray-900">顧客メモ</h3>
              <p className="mt-1 text-[11px] leading-relaxed text-gray-500">
                訪問の記録はタイムラインへ。ここは顧客全体で共有したい内容向けです。
              </p>
              <label className="mt-3 block text-sm text-gray-800">
                <span className="text-gray-600">顧客メモ（任意）</span>
                <textarea
                  className="mt-1 w-full rounded border border-gray-300 px-2 py-2"
                  rows={4}
                  value={memo}
                  onChange={(e) => setMemo(e.target.value)}
                  placeholder="例: 担当者名、契約番号、注意事項など"
                />
              </label>
            </div>
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
                onClick={() => {
                  setEditing(false);
                  setName(customer.name);
                  setMemo(customer.memo ?? "");
                }}
              >
                キャンセル
              </button>
            </div>
          </div>
        )}
        {labelMaster.length > 0 && (
          <div className="mt-6 border-t border-gray-100 pt-4">
            <h3 className="text-sm font-medium text-gray-700">ラベル</h3>
            <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto">
              {labelMaster.map((lb) => (
                <li key={lb.id}>
                  <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-800">
                    <input
                      type="checkbox"
                      checked={selectedLabelIds.includes(lb.id)}
                      onChange={(e) => {
                        setSelectedLabelIds((prev) =>
                          e.target.checked
                            ? [...prev, lb.id]
                            : prev.filter((x) => x !== lb.id)
                        );
                      }}
                      disabled={busy}
                    />
                    <span
                      className="inline-block h-3 w-3 shrink-0 rounded-full border border-gray-300"
                      style={{ backgroundColor: lb.color }}
                    />
                    {lb.name}
                  </label>
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="mt-3 rounded bg-accent px-4 py-2 text-sm text-white disabled:opacity-50"
              disabled={busy}
              onClick={() => void saveLabels()}
            >
              ラベルを保存
            </button>
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
  onSubmit: (text: string, files: File[] | null) => void;
  onSync: () => void;
}) {
  const [text, setText] = useState("");
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [cameraKey, setCameraKey] = useState(0);
  const [galleryKey, setGalleryKey] = useState(0);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  function appendFiles(list: FileList | null) {
    if (!list?.length) return;
    setPhotoFiles((prev) => [...prev, ...Array.from(list)]);
  }

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
        key={cameraKey}
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        multiple
        capture="environment"
        className="hidden"
        onChange={(e) => {
          appendFiles(e.target.files);
          e.target.value = "";
          setCameraKey((k) => k + 1);
        }}
      />
      <input
        key={galleryKey}
        ref={galleryInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          appendFiles(e.target.files);
          e.target.value = "";
          setGalleryKey((k) => k + 1);
        }}
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-800"
          onClick={() => cameraInputRef.current?.click()}
        >
          撮影
        </button>
        <button
          type="button"
          className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-800"
          onClick={() => galleryInputRef.current?.click()}
        >
          アルバムから
        </button>
        {photoFiles.length > 0 && (
          <>
            <span className="text-xs text-gray-600">写真 {photoFiles.length} 枚</span>
            <button
              type="button"
              className="text-xs text-gray-500 underline"
              onClick={() => setPhotoFiles([])}
            >
              写真をクリア
            </button>
          </>
        )}
      </div>
      <div className="mt-2 flex justify-between gap-2">
        <button type="button" className="text-xs text-accent underline" onClick={onSync}>
          オフライン同期
        </button>
        <button
          type="button"
          className="rounded bg-accent px-4 py-2 text-sm text-white"
          onClick={() => {
            onSubmit(text, photoFiles.length > 0 ? photoFiles : null);
            setText("");
            setPhotoFiles([]);
          }}
        >
          保存
        </button>
      </div>
    </div>
  );
}
