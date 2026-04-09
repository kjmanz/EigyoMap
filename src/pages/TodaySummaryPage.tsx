import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AppHeader } from "../components/AppHeader";
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

function previewMemo(text: string, max = 160): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

export function TodaySummaryPage() {
  const { user } = useAuth();
  const [rows, setRows] = useState<TodayLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const { label: dateLabel, range } = useMemo(() => {
    const now = new Date();
    const { start, end } = getLocalDayRangeISO(now);
    return {
      label: now.toLocaleDateString("ja-JP", {
        year: "numeric",
        month: "long",
        day: "numeric",
        weekday: "short",
      }),
      range: { start, end },
    };
  }, []);

  const load = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }
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
    if (error) {
      setErr(error.message);
      setRows([]);
      return;
    }
    const list = (data ?? []) as unknown as TodayLogRow[];
    setRows(
      list.filter((r) => {
        const c = r.customers;
        if (c == null) return false;
        if (Array.isArray(c)) return false;
        return c.deleted_at == null;
      })
    );
  }, [user, range.start, range.end]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="min-h-screen bg-white">
      <AppHeader variant="main" title="今日のまとめ" activeNav="today">
        <div className="mt-2 space-y-1 border-t border-gray-100 pt-2">
          <p className="text-xs text-gray-500">{dateLabel}</p>
          {!loading && (
            <p className="text-sm font-medium text-gray-700">
              訪問メモ <span className="text-accent">{rows.length}</span> 件
            </p>
          )}
        </div>
      </AppHeader>

      {err && <p className="px-3 py-2 text-sm text-red-600">{err}</p>}

      {loading ? (
        <p className="p-4 text-sm text-gray-500">読み込み中…</p>
      ) : rows.length === 0 ? (
        <div className="p-6 text-center">
          <p className="text-sm text-gray-600">今日のメモはまだありません。</p>
          <Link to="/" className="mt-4 inline-block rounded bg-accent px-4 py-2 text-sm text-white">
            地図で記録する
          </Link>
        </div>
      ) : (
        <ul className="divide-y divide-gray-100">
          {rows.map((log) => {
            const name = log.customers?.name ?? "顧客";
            const hasPhotos = (log.photos?.length ?? 0) > 0;
            const timeStr = new Date(log.visited_at).toLocaleTimeString("ja-JP", {
              hour: "2-digit",
              minute: "2-digit",
            });
            return (
              <li key={log.id}>
                <Link
                  to={`/customer/${log.customer_id}/memo/${log.id}`}
                  className="block px-4 py-3 active:bg-blue-50"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="min-w-0 font-medium text-gray-900">{name}</span>
                    <span className="shrink-0 text-xs text-gray-500">{timeStr}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    {log.pinned && (
                      <span className="rounded bg-accent px-1.5 py-0.5 text-[10px] font-medium text-white">
                        ピン留め
                      </span>
                    )}
                    {hasPhotos && (
                      <span className="text-[10px] text-gray-500">写真あり</span>
                    )}
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-gray-700">
                    {previewMemo(log.memo)}
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
