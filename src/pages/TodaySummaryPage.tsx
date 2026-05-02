import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AppHeader } from "../components/AppHeader";
import { PinnedPinIcon } from "../components/PinnedPinIcon";
import { BottomNav } from "../components/BottomNav";
import { DesktopAppShell } from "../components/DesktopAppShell";
import { getLocalDayRangeISO } from "../lib/todayRange";
import { supabase } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";

type TodayLogRow = {
  id: string;
  memo: string;
  visited_at: string;
  pinned: boolean | null;
  customer_id: string;
  customers: { name: string; deleted_at: string | null } | null;
  photos?: { id: string }[] | null;
};

type LogListItemProps = {
  log: TodayLogRow;
  isExpanded: boolean;
  onToggle: () => void;
};

function TodayLogListItem({ log, isExpanded, onToggle }: LogListItemProps) {
  const name = log.customers?.name ?? "顧客";
  const photoCount = log.photos?.length ?? 0;
  const timeStr = new Date(log.visited_at).toLocaleTimeString("ja-JP", {
    hour: "2-digit", minute: "2-digit",
  });
  const hasMemo = log.memo.trim().length > 0;
  const preview = log.memo.trim().slice(0, 80) + (log.memo.trim().length > 80 ? "…" : "");

  return (
    <li className="border-b border-slate-100 bg-white last:border-b-0">
      <button
        type="button"
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors active:bg-gray-50 lg:grid lg:grid-cols-[4.75rem_minmax(0,1fr)_auto] lg:items-start lg:gap-4 lg:px-6 lg:py-4 lg:hover:bg-slate-50/90"
        onClick={onToggle}
      >
        <span className="hidden text-sm font-semibold tabular-nums text-slate-500 lg:block lg:pt-0.5">
          {timeStr}
        </span>
        <div className="min-w-0 flex-1 lg:min-w-0">
          <div className="flex items-start justify-between gap-2">
            <span className="font-medium text-gray-900 lg:text-[15px] lg:font-semibold lg:text-slate-900">
              {name}
            </span>
            <span className="shrink-0 text-xs tabular-nums text-gray-400 lg:hidden">{timeStr}</span>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 lg:mt-1.5">
            {log.pinned && <PinnedPinIcon size="sm" />}
            {photoCount > 0 && (
              <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 lg:text-[11px]">
                写真 {photoCount}
              </span>
            )}
            {!isExpanded && hasMemo && (
              <span className="min-w-0 truncate text-xs text-slate-500 lg:max-w-[42rem]">{preview}</span>
            )}
          </div>
        </div>
        <svg
          className={`h-4 w-4 shrink-0 self-center text-slate-300 transition-transform lg:mt-1 ${isExpanded ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
        </svg>
      </button>

      {isExpanded && (
        <div className="border-t border-slate-100 bg-slate-50 px-4 pb-4 pt-3 lg:mx-4 lg:mb-4 lg:rounded-xl lg:border lg:border-slate-200/80 lg:bg-white lg:px-5 lg:pb-5 lg:pt-4 lg:shadow-sm">
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800">
            {hasMemo ? log.memo : <span className="text-slate-400">メモなし</span>}
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 lg:border-slate-100">
            <Link
              to={`/customer/${log.customer_id}`}
              className="text-xs font-medium text-slate-500 underline decoration-slate-300 underline-offset-2 hover:text-slate-800"
            >
              {name}の詳細
            </Link>
            <Link
              to={`/customer/${log.customer_id}/memo/${log.id}`}
              className="rounded-lg border border-accent bg-white px-3 py-1.5 text-xs font-semibold text-accent shadow-sm hover:bg-accent/5"
            >
              編集
            </Link>
          </div>
        </div>
      )}
    </li>
  );
}

export function TodaySummaryPage() {
  const { user } = useAuth();
  const [rows, setRows] = useState<TodayLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [viewDate, setViewDate] = useState(() => new Date());
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const isToday = useMemo(() => {
    const now = new Date();
    return viewDate.toDateString() === now.toDateString();
  }, [viewDate]);

  const { dateLabel, range } = useMemo(() => {
    const { start, end } = getLocalDayRangeISO(viewDate);
    return {
      dateLabel: viewDate.toLocaleDateString("ja-JP", {
        year: "numeric", month: "long", day: "numeric", weekday: "short",
      }),
      range: { start, end },
    };
  }, [viewDate]);

  const load = useCallback(async () => {
    if (!user) { setLoading(false); return; }
    setLoading(true);
    setErr(null);
    const { data, error } = await supabase
      .from("contact_logs")
      .select("id, memo, visited_at, pinned, customer_id, customers(name, deleted_at), photos(id)")
      .eq("user_id", user.id)
      .is("deleted_at", null)
      .gte("visited_at", range.start)
      .lte("visited_at", range.end)
      .order("visited_at", { ascending: false });
    setLoading(false);
    if (error) { setErr(error.message); setRows([]); return; }
    const list = (data ?? []) as unknown as TodayLogRow[];
    setRows(list.filter((r) => {
      const c = r.customers;
      if (c == null || Array.isArray(c)) return false;
      return c.deleted_at == null;
    }));
  }, [user, range.start, range.end]);

  useEffect(() => { void load(); }, [load]);

  /** 同じ日に同顧客へ訪問記録とメモ付き訪問の両方があると行が二重になるため、顧客ごとに最新1件にまとめる */
  const visitRows = useMemo(() => {
    const byCustomer = new Map<string, TodayLogRow>();
    for (const r of rows) {
      const prev = byCustomer.get(r.customer_id);
      if (!prev || new Date(r.visited_at) > new Date(prev.visited_at)) {
        byCustomer.set(r.customer_id, r);
      }
    }
    return Array.from(byCustomer.values()).sort(
      (a, b) => new Date(b.visited_at).getTime() - new Date(a.visited_at).getTime(),
    );
  }, [rows]);
  const memoRows = useMemo(
    () => rows.filter((r) => r.memo.trim().length > 0),
    [rows],
  );

  function goPrev() {
    setViewDate((d) => { const nd = new Date(d); nd.setDate(nd.getDate() - 1); return nd; });
    setExpandedId(null);
  }
  function goNext() {
    if (isToday) return;
    setViewDate((d) => { const nd = new Date(d); nd.setDate(nd.getDate() + 1); return nd; });
    setExpandedId(null);
  }

  return (
    <DesktopAppShell sidebarActive="today">
      <div className="flex min-h-screen flex-col bg-white pb-16 lg:min-h-0 lg:flex-1 lg:overflow-auto lg:bg-gray-50/40 lg:pb-0">
      <AppHeader variant="main" title="今日" activeNav="today">
        {/* 日付ナビゲーション */}
        <div className="mt-2 border-t border-gray-100 pt-2 lg:border-0 lg:pt-0">
          <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200/70 bg-gradient-to-br from-white to-slate-50 px-3 py-2 shadow-sm lg:rounded-2xl lg:border-slate-200 lg:px-5 lg:py-4 lg:shadow-[0_4px_20px_-12px_rgba(15,23,42,0.2)]">
          <button
            type="button"
            onClick={goPrev}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 shadow-sm active:bg-gray-50 lg:h-10 lg:w-10 lg:hover:border-slate-300 lg:hover:bg-slate-50"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="min-w-0 flex-1 text-center">
            <p className="truncate text-xs font-medium text-slate-500 lg:text-[13px]">
              {dateLabel}
            </p>
            {!loading && (
              <p className="mt-1 text-sm font-semibold text-slate-800 lg:text-base">
                {isToday && (
                  <span className="mr-2 inline-block rounded-md bg-accent/10 px-2 py-0.5 text-xs font-bold text-accent">
                    今日
                  </span>
                )}
                訪問{" "}
                <span className="tabular-nums text-accent">{visitRows.length}</span>
                <span className="mx-1.5 text-slate-300">·</span>
                メモ{" "}
                <span className="tabular-nums text-accent">{memoRows.length}</span>
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={goNext}
            disabled={isToday}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 shadow-sm active:bg-gray-50 disabled:opacity-30 lg:h-10 lg:w-10 lg:hover:border-slate-300 lg:hover:bg-slate-50"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
          </div>
        </div>
      </AppHeader>

      {err && (
        <p className="px-3 py-2 text-sm text-red-600 lg:mx-auto lg:max-w-4xl lg:px-10">{err}</p>
      )}

      {loading ? (
        <p className="p-4 text-sm text-gray-500 lg:mx-auto lg:max-w-4xl lg:px-10">読み込み中…</p>
      ) : visitRows.length === 0 && memoRows.length === 0 ? (
        <div className="mx-4 rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-14 text-center lg:mx-auto lg:max-w-4xl lg:px-10">
          <p className="text-sm text-slate-600 lg:text-base">
            {isToday ? "今日の訪問はまだありません。" : "この日の訪問はありません。"}
          </p>
          {isToday && (
            <Link
              to="/"
              className="mt-6 inline-flex rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-accent/20 hover:opacity-95"
            >
              地図で記録する
            </Link>
          )}
        </div>
      ) : (
        <div className="space-y-6 px-4 pb-2 lg:mx-auto lg:max-w-4xl lg:space-y-8 lg:px-10 lg:pb-12">
          <section className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-[0_4px_24px_-8px_rgba(15,23,42,0.12)] lg:rounded-2xl">
            <h2 className="flex flex-col gap-0.5 border-b border-slate-100 bg-slate-50/95 px-4 py-3.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3 lg:px-6 lg:py-4">
              <span className="text-base font-bold tracking-tight text-slate-900">訪問一覧</span>
              <span className="text-xs font-normal leading-relaxed text-slate-500">
                {visitRows.length} 名（同顧客は最新の訪問のみ）
              </span>
            </h2>
            {visitRows.length === 0 ? (
              <p className="px-6 py-8 text-center text-sm text-slate-500">訪問の記録はありません</p>
            ) : (
              <ul className="divide-y divide-slate-100 lg:divide-slate-100">
                {visitRows.map((log) => (
                  <TodayLogListItem
                    key={log.id}
                    log={log}
                    isExpanded={expandedId === log.id}
                    onToggle={() => setExpandedId(expandedId === log.id ? null : log.id)}
                  />
                ))}
              </ul>
            )}
          </section>

          <section className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-[0_4px_24px_-8px_rgba(15,23,42,0.12)] lg:rounded-2xl">
            <h2 className="flex flex-col gap-0.5 border-b border-slate-100 bg-slate-50/95 px-4 py-3.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3 lg:px-6 lg:py-4">
              <span className="text-base font-bold tracking-tight text-slate-900">メモ一覧</span>
              <span className="text-xs font-normal text-slate-500">メモ本文あり · {memoRows.length} 件</span>
            </h2>
            {memoRows.length === 0 ? (
              <p className="px-6 py-8 text-center text-sm text-slate-500">
                {isToday ? "今日はメモ付きの訪問はまだありません。" : "この日、メモのある訪問はありません。"}
              </p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {memoRows.map((log) => (
                  <TodayLogListItem
                    key={`memo-${log.id}`}
                    log={log}
                    isExpanded={expandedId === log.id}
                    onToggle={() => setExpandedId(expandedId === log.id ? null : log.id)}
                  />
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      <BottomNav active="today" />
      </div>
    </DesktopAppShell>
  );
}
