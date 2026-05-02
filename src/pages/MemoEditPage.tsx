import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AppHeader } from "../components/AppHeader";
import { DesktopAppShell } from "../components/DesktopAppShell";
import { isoToDatetimeLocal } from "../lib/datetime";
import { deleteStoragePath, getSignedPhotoUrl, uploadContactPhotos } from "../lib/photos";
import { canRestore, daysUntilPermanentDeletion } from "../lib/softDelete";
import { supabase } from "../lib/supabase";
import type { ContactLogRow, PhotoRow } from "../lib/types";
import { useAuth } from "../contexts/AuthContext";

export function MemoEditPage() {
  const { id, logId } = useParams<{ id: string; logId: string }>();
  const { user } = useAuth();
  const nav = useNavigate();
  const [log, setLog] = useState<ContactLogRow | null>(null);
  const [photos, setPhotos] = useState<PhotoRow[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [memo, setMemo] = useState("");
  const [visitedAt, setVisitedAt] = useState("");
  const [pinned, setPinned] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!logId) return;
    const { data: row, error } = await supabase
      .from("contact_logs")
      .select("*")
      .eq("id", logId)
      .single();
    if (error || !row) {
      setLog(null);
      return;
    }
    const l = row as ContactLogRow;
    setLog(l);
    setMemo(l.memo);
    setVisitedAt(isoToDatetimeLocal(l.visited_at));
    setPinned(Boolean(l.pinned));
    const { data: ph } = await supabase.from("photos").select("*").eq("contact_log_id", logId);
    const list = (ph ?? []) as PhotoRow[];
    setPhotos(list);
    const next: Record<string, string> = {};
    for (const p of list) {
      const u = await getSignedPhotoUrl(p.storage_path);
      if (u) next[p.id] = u;
    }
    setUrls(next);
  }, [logId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    if (!logId || !log) return;
    setBusy(true);
    try {
      const { error } = await supabase
        .from("contact_logs")
        .update({
          memo,
          visited_at: new Date(visitedAt).toISOString(),
          pinned,
        })
        .eq("id", logId);
      if (error) {
        alert(error.message);
        return;
      }
      nav(`/customer/${id}`);
    } finally {
      setBusy(false);
    }
  }

  async function addPhotos(files: FileList | null) {
    if (!files || !user || !logId) return;
    setBusy(true);
    try {
      await uploadContactPhotos(user.id, logId, Array.from(files));
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function restoreMemo() {
    if (!logId) return;
    setBusy(true);
    try {
      const { error } = await supabase
        .from("contact_logs")
        .update({ deleted_at: null })
        .eq("id", logId);
      if (error) {
        alert(error.message);
        return;
      }
      nav(`/customer/${id}`);
    } finally {
      setBusy(false);
    }
  }

  async function removePhoto(p: PhotoRow) {
    if (!confirm("この写真を削除しますか？")) return;
    setBusy(true);
    try {
      await deleteStoragePath(p.storage_path);
      const { error } = await supabase.from("photos").delete().eq("id", p.id);
      if (error) alert(error.message);
      else await load();
    } finally {
      setBusy(false);
    }
  }

  if (!log) {
    return (
      <DesktopAppShell sidebarActive={null}>
        <div className="flex flex-1 flex-col p-4">
          <p className="text-gray-600">読み込み中…</p>
          <Link to={`/customer/${id}`} className="mt-2 inline-block text-accent underline">
            戻る
          </Link>
        </div>
      </DesktopAppShell>
    );
  }

  if (log.deleted_at) {
    const ok = canRestore(log.deleted_at);
    const days = daysUntilPermanentDeletion(log.deleted_at);
    return (
      <DesktopAppShell sidebarActive={null}>
      <div className="flex min-h-screen flex-1 flex-col bg-white lg:overflow-auto">
        <AppHeader variant="back" title="削除済みメモ" onBack={() => nav(-1)} />
        <div className="p-4 lg:mx-auto lg:max-w-2xl lg:pb-12">
        <p className="text-sm text-amber-900">このメモは削除済みです。</p>
        <p className="mt-2 text-xs text-gray-600">
          削除: {new Date(log.deleted_at).toLocaleString("ja-JP")}
          {days != null && ` ・ 完全削除まであと約 ${days} 日`}
        </p>
        {ok ? (
          <button
            type="button"
            className="mt-4 rounded bg-accent px-4 py-2 text-sm text-white disabled:opacity-50"
            disabled={busy}
            onClick={() => void restoreMemo()}
          >
            復元する
          </button>
        ) : (
          <p className="mt-4 text-sm text-gray-500">復元期限を過ぎています。</p>
        )}
        <div className="mt-4 flex gap-2">
          <Link to="/trash" className="text-sm text-accent underline">
            ゴミ箱
          </Link>
          <Link to={`/customer/${id}`} className="text-sm text-gray-600 underline">
            顧客へ
          </Link>
        </div>
        </div>
      </div>
      </DesktopAppShell>
    );
  }

  return (
    <DesktopAppShell sidebarActive={null}>
    <div className="min-h-screen flex-1 bg-white lg:overflow-auto">
      <AppHeader variant="back" title="メモを編集" onBack={() => nav(-1)} />
      <div className="p-4 pb-24 lg:mx-auto lg:max-w-2xl lg:pb-12">
      <label className="block text-sm text-gray-700">
        訪問日時
        <input
          type="datetime-local"
          className="mt-1 w-full rounded border border-gray-300 px-2 py-2"
          value={visitedAt}
          onChange={(e) => setVisitedAt(e.target.value)}
        />
      </label>
      <label className="mt-3 flex items-center gap-2 text-sm text-gray-700">
        <input
          type="checkbox"
          checked={pinned}
          onChange={(e) => setPinned(e.target.checked)}
          className="h-4 w-4 rounded border-gray-300"
        />
        タイムラインの先頭にピン留め
      </label>
      <label className="mt-3 block text-sm text-gray-700">
        メモ
        <textarea
          className="mt-1 w-full rounded border border-gray-300 px-2 py-2"
          rows={5}
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
        />
      </label>
      <div className="mt-4">
        <p className="text-sm text-gray-700">写真</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {photos.map((p) => (
            <div key={p.id} className="relative">
              {urls[p.id] && (
                <img src={urls[p.id]} alt="" className="h-24 w-24 rounded object-cover" />
              )}
              <button
                type="button"
                className="mt-1 text-xs text-red-600"
                onClick={() => void removePhoto(p)}
                disabled={busy}
              >
                削除
              </button>
            </div>
          ))}
        </div>
        <input
          type="file"
          accept="image/*"
          multiple
          className="mt-2 text-sm"
          onChange={(e) => void addPhotos(e.target.files)}
        />
      </div>
      <div className="mt-6 flex gap-2">
        <button
          type="button"
          className="rounded bg-accent px-4 py-2 text-sm text-white"
          onClick={() => void save()}
          disabled={busy}
        >
          保存
        </button>
        <Link to={`/customer/${id}`} className="rounded border border-gray-300 px-4 py-2 text-sm">
          キャンセル
        </Link>
      </div>
      </div>
    </div>
    </DesktopAppShell>
  );
}
