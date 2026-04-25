import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AppHeader } from "../components/AppHeader";
import { BottomNav } from "../components/BottomNav";
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
    <li className="bg-white">
      <button
        type="button"
        className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-gray-50"
        onClick={onToggle}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium text-gray-900">{name}</span>
            <span className="shrink-0 text-xs text-gray-400">{timeStr}</span>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
            {log.pinned && (
              <span className="rounded bg-accent px-1.5 py-0.5 text-[10px] font-medium text-white">ピン留め</span>
            )}
            {photoCount > 0 && (
              <span className="text-[10px] text-gray-400">写真 {photoCount} 枚</span>
            )}
            {!isExpanded && hasMemo && (
              <span className="min-w-0 truncate text-xs text-gray-500">{preview}</span>
            )}
          </div>
        </div>
        <svg
          className={`h-4 w-4 shrink-0 text-gray-300 transition-transform ${isExpanded ? "rotate-180" : ""}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
        </svg>
      </button>

      {isExpanded && (
        <div className="border-t border-gray-100 bg-gray-50 px-4 pb-3 pt-3">
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-800">
            {hasMemo ? log.memo : <span className="text-gray-400">メモなし</span>}
          </p>
          <div className="mt-3 flex items-center justify-between">
            <Link
              to={`/customer/${log.customer_id}`}
              className="text-xs text-gray-500 underline"
            >
              {name}の詳細
            </Link>
            <Link
              to={`/customer/${log.customer_id}/memo/${log.id}`}
              className="rounded border border-accent px-3 py-1.5 text-xs font-medium text-accent active:bg-accent/10"
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
    <div className="min-h-screen bg-white pb-16">
      <AppHeader variant="main" title="今日" activeNav="today">
        {/* 日付ナビゲーション */}
        <div className="mt-2 flex items-center justify-between gap-2 border-t border-gray-100 pt-2">
          <button
            type="button"
            onClick={goPrev}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 bg-gray-50 text-gray-600 active:bg-gray-100"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="text-center">
            <p className="text-xs text-gray-500">{dateLabel}</p>
            {!loading && (
              <p className="text-sm font-medium text-gray-700">
                {isToday ? "今日 · " : ""}訪問 <span className="text-accent">{visitRows.length}</span>
                <span className="text-gray-400"> · </span>
                メモ <span className="text-accent">{memoRows.length}</span>
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={goNext}
            disabled={isToday}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 bg-gray-50 text-gray-600 active:bg-gray-100 disabled:opacity-30"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </AppHeader>

      {err && <p className="px-3 py-2 text-sm text-red-600">{err}</p>}

      {loading ? (
        <p className="p-4 text-sm text-gray-500">読み込み中…</p>
      ) : visitRows.length === 0 && memoRows.length === 0 ? (
        <div className="p-6 text-center">
          <p className="text-sm text-gray-600">
            {isToday ? "今日の訪問はまだありません。" : "この日の訪問はありません。"}
          </p>
          {isToday && (
            <Link to="/" className="mt-4 inline-block rounded bg-accent px-4 py-2 text-sm text-white">
              地図で記録する
            </Link>
          )}
        </div>
      ) : (
        <div className="space-y-6 pb-2">
          <section>
            <h2 className="bg-gray-50 px-4 py-2.5 text-sm font-semibold text-gray-800">
              訪問一覧
              <span className="ml-2 text-xs font-normal text-gray-500">（{visitRows.length} 名・同顧客は最新の訪問のみ）</span>
            </h2>
            {visitRows.length === 0 ? (
              <p className="px-4 py-3 text-sm text-gray-500">訪問の記録はありません</p>
            ) : (
              <ul className="divide-y divide-gray-100">
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

          <section>
            <h2 className="bg-gray-50 px-4 py-2.5 text-sm font-semibold text-gray-800">
              メモ一覧
              <span className="ml-2 text-xs font-normal text-gray-500">（{memoRows.length} 件・メモ本文あり）</span>
            </h2>
            {memoRows.length === 0 ? (
              <p className="px-4 py-3 text-sm text-gray-500">
                {isToday ? "今日はメモ付きの訪問はまだありません。" : "この日、メモのある訪問はありません。"}
              </p>
            ) : (
              <ul className="divide-y divide-gray-100">
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
  );
}
