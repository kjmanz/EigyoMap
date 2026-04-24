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
      <AppHeader variant="main" title="訪問記録" activeNav="today">
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
                {isToday ? "今日 · " : ""}<span className="text-accent">{rows.length}</span> 件
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
      ) : rows.length === 0 ? (
        <div className="p-6 text-center">
          <p className="text-sm text-gray-600">
            {isToday ? "今日のメモはまだありません。" : "この日のメモはありません。"}
          </p>
          {isToday && (
            <Link to="/" className="mt-4 inline-block rounded bg-accent px-4 py-2 text-sm text-white">
              地図で記録する
            </Link>
          )}
        </div>
      ) : (
        <ul className="divide-y divide-gray-100">
          {rows.map((log) => {
            const name = log.customers?.name ?? "顧客";
            const photoCount = log.photos?.length ?? 0;
            const isExpanded = expandedId === log.id;
            const timeStr = new Date(log.visited_at).toLocaleTimeString("ja-JP", {
              hour: "2-digit", minute: "2-digit",
            });
            const hasMemo = log.memo.trim().length > 0;
            const preview = log.memo.trim().slice(0, 80) + (log.memo.trim().length > 80 ? "…" : "");

            return (
              <li key={log.id} className="bg-white">
                {/* 行ヘッダー（タップで展開） */}
                <button
                  type="button"
                  className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-gray-50"
                  onClick={() => setExpandedId(isExpanded ? null : log.id)}
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

                {/* 展開エリア */}
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
          })}
        </ul>
      )}

      <BottomNav active="today" />
    </div>
  );
}
