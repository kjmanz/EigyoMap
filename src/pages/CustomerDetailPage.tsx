import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AppHeader, APP_HEADER_NAV_CLASS } from "../components/AppHeader";
import { DesktopAppShell } from "../components/DesktopAppShell";
import { PinnedPinIcon } from "../components/PinnedPinIcon";
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
  const [quickDone, setQuickDone] = useState(false);
  const [inlineOpen, setInlineOpen] = useState(false);
  const [inlineMemo, setInlineMemo] = useState("");

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
    const t = memoText.trim();
    const hasFiles = (files?.length ?? 0) > 0;
    if (t.length === 0 && !hasFiles) return;
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
          memo: t,
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
        memo: t,
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

  async function quickRecord(memoText = "") {
    if (!id || !user) return;
    const visitedAt = new Date().toISOString();
    if (!isOnline()) {
      await enqueueOffline({
        id: crypto.randomUUID(),
        kind: "contact_log",
        payload: { customerId: id, memo: memoText, visitedAt, photoBlobs: [] },
      });
      alert("オフラインのためキューに保存しました。");
      return;
    }
    const { error } = await supabase.from("contact_logs").insert({
      customer_id: id,
      user_id: user.id,
      memo: memoText,
      visited_at: visitedAt,
      pinned: false,
    });
    if (error) { alert(error.message); return; }
    setQuickDone(true);
    setInlineOpen(false);
    setInlineMemo("");
    setTimeout(() => setQuickDone(false), 2500);
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
      <DesktopAppShell sidebarActive={null}>
        <div className="flex flex-1 flex-col p-4 text-gray-600">
          読み込み中…
          <div className="mt-4">
            <Link to="/" className="text-accent underline">
              地図へ
            </Link>
          </div>
        </div>
      </DesktopAppShell>
    );
  }

  if (customer.deleted_at) {
    const ok = canRestore(customer.deleted_at);
    const days = daysUntilPermanentDeletion(customer.deleted_at);
    return (
      <DesktopAppShell sidebarActive={null}>
        <div className="flex min-h-screen flex-1 flex-col bg-white pb-24 lg:min-h-0 lg:overflow-auto">
        <AppHeader
          variant="back"
          title={customer.name}
          onBack={() => nav(-1)}
          rightSlot={
            <Link to="/trash" className={APP_HEADER_NAV_CLASS}>
              ゴミ箱
            </Link>
          }
        />
        <div className="p-4 lg:mx-auto lg:max-w-2xl">
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
      </DesktopAppShell>
    );
  }

  return (
    <DesktopAppShell sidebarActive={null} fullViewportHeight>
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-gray-50">
      <div className="shrink-0">
        <AppHeader
          variant="back"
          title={customer.name}
          onBack={() => nav(-1)}
          rightSlot={
            <Link to={`/?highlight=${customer.id}`} className={APP_HEADER_NAV_CLASS}>
              地図
            </Link>
          }
        />
      </div>

      <div
        className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain [scroll-padding-bottom:12rem]"
        style={{
          /* 訪問メモ固定フッター（＋安全域）より十分大きく — 8.5rem だと最終行が隠れる */
          paddingBottom: "max(17rem, calc(env(safe-area-inset-bottom, 0px) + 12rem))",
        }}
      >
        <div className="mx-auto max-w-lg space-y-5 px-3 pb-4 pt-3 sm:px-4 sm:pt-4 lg:max-w-3xl xl:max-w-4xl lg:px-8">
        <div>
          <h2 className="text-sm font-bold text-gray-500">顧客情報</h2>
          <div className="mt-2 rounded-2xl border border-gray-200/80 bg-white p-4 shadow-sm">
            {customer.labels.length > 0 && (
              <div className="mb-4 flex flex-wrap gap-1.5">
                {customer.labels.map((lb) => (
                  <span
                    key={lb.id}
                    className="inline-block rounded-full px-2.5 py-1 text-xs font-medium"
                    style={{ backgroundColor: lb.color, color: labelChipTextColor(lb.color) }}
                  >
                    {lb.name}
                  </span>
                ))}
              </div>
            )}

            {/* クイック訪問記録 */}
            {!editing && (
              <div className="mb-4">
                {!inlineOpen && !quickDone && (
                  <button
                    type="button"
                    className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white shadow-sm active:bg-emerald-700"
                    onClick={() => setInlineOpen(true)}
                  >
                    <svg className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                    </svg>
                    今すぐ訪問を記録
                  </button>
                )}
                {inlineOpen && (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3">
                    <p className="mb-2 text-xs font-medium text-emerald-900/90">訪問メモ（任意・空欄で記録できます）</p>
                    <textarea
                      className="w-full rounded-lg border border-emerald-200/80 bg-white px-3 py-2.5 text-sm leading-relaxed text-gray-900 shadow-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/30"
                      rows={3}
                      placeholder="訪問内容（空欄でもOK）"
                      value={inlineMemo}
                      onChange={(e) => setInlineMemo(e.target.value)}
                      autoFocus
                    />
                    <div className="mt-3 flex gap-2">
                      <button
                        type="button"
                        className="min-h-[44px] flex-1 rounded-lg bg-emerald-600 py-2.5 text-sm font-semibold text-white active:bg-emerald-700"
                        onClick={() => void quickRecord(inlineMemo)}
                        disabled={busy}
                      >
                        記録する
                      </button>
                      <button
                        type="button"
                        className="min-h-[44px] rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 active:bg-gray-50"
                        onClick={() => { setInlineOpen(false); setInlineMemo(""); }}
                      >
                        キャンセル
                      </button>
                    </div>
                  </div>
                )}
                {quickDone && (
                  <div className="flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 py-3 text-sm font-medium text-emerald-800">
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    記録しました
                  </div>
                )}
              </div>
            )}

            {!editing ? (
              <>
                {customer.memo?.trim() ? (
                  <div className="rounded-xl border border-l-4 border-l-accent border-gray-200 bg-slate-50/80 p-3 sm:p-4">
                    <h3 className="text-sm font-semibold text-gray-900">顧客メモ</h3>
                    <p className="mt-1 text-xs leading-relaxed text-gray-500">
                      顧客全体の共有メモ。日々の訪問内容は下の「訪問履歴」に記録されます。
                    </p>
                    <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-[1.65] text-gray-800">
                      {customer.memo}
                    </p>
                  </div>
                ) : (
                  <div className="flex min-h-0 items-center justify-between gap-2 rounded-lg border border-dashed border-gray-200 bg-white px-2.5 py-1.5">
                    <p className="min-w-0 text-[11px] leading-snug text-gray-500">
                      顧客メモ（未登録）· 共有用の補足は「入力」で
                    </p>
                    <button
                      type="button"
                      className="shrink-0 rounded-md px-2 py-1.5 text-xs font-semibold text-accent active:bg-blue-50"
                      onClick={() => setEditing(true)}
                    >
                      入力
                    </button>
                  </div>
                )}
                <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-stretch sm:gap-3">
                  <button
                    type="button"
                    className="min-h-[44px] flex-1 rounded-xl border-2 border-accent/30 bg-white px-4 py-2.5 text-sm font-semibold text-accent shadow-sm active:bg-blue-50/50"
                    onClick={() => setEditing(true)}
                  >
                    名前・メモを編集
                  </button>
                  <button
                    type="button"
                    className="min-h-[44px] rounded-xl border border-red-200 bg-red-50/50 px-4 py-2.5 text-sm font-medium text-red-700 active:bg-red-100/50"
                    onClick={() => void deleteCustomer()}
                    disabled={busy}
                  >
                    顧客を削除
                  </button>
                </div>
                {isOnline() ? (
                  <Link
                    to={`/?relocate=${customer.id}`}
                    className="mt-4 inline-flex min-h-[44px] items-center text-sm font-medium text-accent underline decoration-accent/30 underline-offset-2"
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
                <label className="text-sm font-medium text-gray-800">
                  お客様名
                  <input
                    className="mt-1.5 w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base text-gray-900 shadow-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
                <div className="rounded-xl border border-l-4 border-l-accent border-gray-200 bg-white p-4 shadow-sm">
                  <h3 className="text-sm font-semibold text-gray-900">顧客メモ</h3>
                  <p className="mt-1 text-xs leading-relaxed text-gray-500">
                    訪問内容は下の訪問履歴へ。ここは顧客全体向けのメモです。
                  </p>
                  <label className="mt-3 block text-sm text-gray-800">
                    <span className="text-gray-600">顧客メモ（任意）</span>
                    <textarea
                      className="mt-1.5 w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm leading-relaxed focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                      rows={4}
                      value={memo}
                      onChange={(e) => setMemo(e.target.value)}
                      placeholder="例: 担当者名、契約番号、注意事項など"
                    />
                  </label>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <button
                    type="button"
                    className="min-h-[44px] flex-1 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white shadow-sm active:opacity-90"
                    onClick={() => void saveCustomer()}
                    disabled={busy}
                  >
                    保存
                  </button>
                  <button
                    type="button"
                    className="min-h-[44px] rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 active:bg-gray-50"
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
            {labelMaster.length > 0 && !editing && (
              <div className="mt-5 border-t border-gray-100 pt-4">
                <h3 className="text-sm font-semibold text-gray-800">ラベル</h3>
                <ul className="mt-2 max-h-48 space-y-0.5 overflow-y-auto rounded-lg border border-gray-100 bg-gray-50/50 p-2">
                  {labelMaster.map((lb) => (
                    <li key={lb.id}>
                      <label className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-lg px-2 py-1 text-sm text-gray-800 active:bg-white">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-gray-300 text-accent focus:ring-accent"
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
                          className="inline-block h-3.5 w-3.5 shrink-0 rounded-full border border-white shadow-sm"
                          style={{ backgroundColor: lb.color }}
                        />
                        {lb.name}
                      </label>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  className="mt-3 w-full min-h-[44px] rounded-xl bg-accent py-2.5 text-sm font-semibold text-white shadow-sm active:opacity-90 disabled:opacity-50"
                  disabled={busy}
                  onClick={() => void saveLabels()}
                >
                  ラベルを保存
                </button>
              </div>
            )}
          </div>
        </div>

        <section className="pb-2">
          <h2 className="text-sm font-bold text-gray-500">訪問履歴</h2>
          <p className="mt-0.5 text-xs text-gray-500">新しいものが上に表示されます</p>
          <ul className="mt-3 space-y-3">
            {logs.map((log) => (
              <li
                key={log.id}
                className={`overflow-hidden rounded-2xl border text-sm shadow-sm ${
                  log.pinned
                    ? "border-accent/40 bg-gradient-to-b from-blue-50/90 to-white"
                    : "border-gray-200 bg-white"
                }`}
              >
                <div className="flex flex-col gap-2 border-b border-gray-100/80 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 flex flex-wrap items-center gap-2">
                    {log.pinned && <PinnedPinIcon size="md" />}
                    <time
                      dateTime={log.visited_at}
                      className="text-sm font-medium tabular-nums text-gray-900"
                    >
                      {new Date(log.visited_at).toLocaleString("ja-JP", {
                        month: "numeric",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                        weekday: "short",
                      })}
                    </time>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-1.5 sm:justify-end">
                    <button
                      type="button"
                      className="rounded-lg bg-gray-100 px-2.5 py-1.5 text-xs font-medium text-gray-800 active:bg-gray-200"
                      onClick={() => void togglePin(log)}
                      disabled={busy}
                    >
                      {log.pinned ? "解除" : "ピン留め"}
                    </button>
                    <Link
                      to={`/customer/${id}/memo/${log.id}`}
                      className="rounded-lg bg-accent/10 px-2.5 py-1.5 text-xs font-semibold text-accent active:bg-accent/20"
                    >
                      編集
                    </Link>
                    <button
                      type="button"
                      className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-red-600 active:bg-red-50"
                      onClick={() => void deleteLog(log)}
                    >
                      削除
                    </button>
                  </div>
                </div>
                <div className="px-4 py-3">
                  <p className="whitespace-pre-wrap break-words leading-relaxed text-gray-800">
                    {log.memo?.trim() ? log.memo : <span className="text-sm text-gray-400">（訪問メモなし）</span>}
                  </p>
                  {(log.photos?.length ?? 0) > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {(log.photos ?? []).map((p) =>
                        urls[p.id] ? (
                          <a
                            key={p.id}
                            href={urls[p.id]}
                            target="_blank"
                            rel="noreferrer"
                            className="overflow-hidden rounded-lg ring-1 ring-gray-200"
                          >
                            <img
                              src={urls[p.id]}
                              alt=""
                              className="h-24 w-24 object-cover"
                            />
                          </a>
                        ) : null
                      )}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {logs.length === 0 && (
            <p className="mt-2 rounded-xl border border-dashed border-gray-200 bg-white px-4 py-6 text-center text-sm text-gray-500">
              まだ訪問の記録がありません。上のボタンか、下のフォームから追加できます。
            </p>
          )}
        </section>
        </div>
      </div>

      <MemoComposer
        onSubmit={(text, files) => void addMemo(files, text)}
        onSync={() => void flushOfflineQueue().then(() => load())}
      />
    </div>
    </DesktopAppShell>
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

  const canSave = text.trim().length > 0 || photoFiles.length > 0;

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-20 border-t border-gray-200/90 bg-white/95 px-2.5 pt-2 shadow-[0_-4px_16px_rgba(0,0,0,0.05)] backdrop-blur-sm sm:px-3 lg:left-52"
      style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom, 0px))" }}
    >
      <p className="px-0.5 text-[11px] leading-tight text-gray-500">
        <span className="font-medium text-gray-600">訪問メモ</span>
        <span className="text-gray-400"> · 音声はキーボードのマイク</span>
      </p>
      <textarea
        className="min-h-[42px] mt-1.5 w-full resize-y rounded-lg border border-gray-200 bg-gray-50/90 px-2.5 py-2 text-sm leading-snug text-gray-900 shadow-inner focus:border-accent focus:bg-white focus:outline-none focus:ring-1 focus:ring-accent/25"
        rows={2}
        placeholder="訪問内容（空欄・写真のみも可）"
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
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          className="min-h-[36px] rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-800 active:bg-gray-50"
          onClick={() => cameraInputRef.current?.click()}
        >
          撮影
        </button>
        <button
          type="button"
          className="min-h-[36px] rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-800 active:bg-gray-50"
          onClick={() => galleryInputRef.current?.click()}
        >
          アルバム
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
      <div className="mt-1.5 flex min-h-[40px] items-center justify-between gap-2 pb-1">
        <button
          type="button"
          className="text-[11px] font-medium text-accent underline decoration-accent/30 underline-offset-2"
          onClick={onSync}
        >
          オフライン同期
        </button>
        {canSave && (
          <button
            type="button"
            className="rounded-lg bg-accent px-4 py-1.5 text-sm font-semibold text-white shadow-sm active:opacity-90"
            onClick={() => {
              onSubmit(text, photoFiles.length > 0 ? photoFiles : null);
              setText("");
              setPhotoFiles([]);
            }}
          >
            保存
          </button>
        )}
      </div>
    </div>
  );
}
