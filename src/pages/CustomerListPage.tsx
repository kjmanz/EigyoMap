import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import type { ContactLogRow, CustomerRow } from "../lib/types";
import { useAuth } from "../contexts/AuthContext";

type Row = CustomerRow & { lastVisit: string | null };

const navBtnClass =
  "inline-flex min-h-[44px] shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm font-medium text-gray-800 shadow-sm active:bg-gray-100";

type SearchIconProps = { className?: string };

function SearchIcon({ className }: SearchIconProps) {
  return (
    <svg className={className} width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M21 21l-4.35-4.35M11 18a7 7 0 100-14 7 7 0 000 14z"
      />
    </svg>
  );
}

export function CustomerListPage() {
  const { user } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!user) return;
    const { data: customers, error } = await supabase
      .from("customers")
      .select("*")
      .eq("user_id", user.id)
      .is("deleted_at", null);
    if (error || !customers) return;
    const { data: logs } = await supabase
      .from("contact_logs")
      .select("customer_id, visited_at")
      .eq("user_id", user.id)
      .is("deleted_at", null);
    const lastBy = new Map<string, string>();
    for (const l of (logs ?? []) as Pick<ContactLogRow, "customer_id" | "visited_at">[]) {
      const cur = lastBy.get(l.customer_id);
      if (!cur || l.visited_at > cur) lastBy.set(l.customer_id, l.visited_at);
    }
    const enriched: Row[] = (customers as CustomerRow[]).map((c) => ({
      ...c,
      lastVisit: lastBy.get(c.id) ?? null,
    }));
    enriched.sort((a, b) => {
      const ta = a.lastVisit ?? a.updated_at;
      const tb = b.lastVisit ?? b.updated_at;
      return tb.localeCompare(ta);
    });
    setRows(enriched);
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) => r.name.toLowerCase().includes(s));
  }, [rows, q]);

  useEffect(() => {
    if (!searchOpen) return;
    const t = window.setTimeout(() => searchInputRef.current?.focus(), 50);
    return () => window.clearTimeout(t);
  }, [searchOpen]);

  const searchInput = (
    <input
      ref={searchInputRef}
      type="search"
      placeholder="名前で検索"
      value={q}
      onChange={(e) => setQ(e.target.value)}
      className="min-h-[44px] w-full flex-1 rounded-lg border border-gray-300 px-3 py-2 text-base md:text-sm"
      enterKeyHint="search"
    />
  );

  return (
    <div className="min-h-screen bg-white">
      <header className="sticky top-0 z-10 border-b border-gray-200 bg-white px-2 py-2 sm:px-3">
        <div className="flex items-center gap-1.5 sm:gap-2">
          <Link to="/" className={navBtnClass}>
            地図
          </Link>
          <h1 className="min-w-0 flex-1 truncate text-center text-base font-semibold text-gray-800 sm:text-lg">
            顧客一覧
          </h1>
          <Link to="/today" className={navBtnClass}>
            今日
          </Link>
          <Link to="/settings" className={navBtnClass}>
            設定
          </Link>
          <button
            type="button"
            className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border shadow-sm md:hidden ${
              searchOpen || q.trim()
                ? "border-accent bg-accent/10 text-accent"
                : "border-gray-200 bg-gray-50 text-gray-700 active:bg-gray-100"
            }`}
            aria-expanded={searchOpen}
            aria-label={searchOpen ? "検索を閉じる" : "検索を開く"}
            onClick={() => {
              setSearchOpen((o) => !o);
            }}
          >
            <SearchIcon className="h-[22px] w-[22px]" />
          </button>
        </div>
        <div
          className={`mt-2 items-center gap-2 ${searchOpen ? "flex" : "hidden md:flex"}`}
        >
          {searchInput}
          {searchOpen && (
            <button
              type="button"
              className="inline-flex h-11 shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-600 md:hidden"
              onClick={() => setSearchOpen(false)}
            >
              閉じる
            </button>
          )}
        </div>
      </header>
      <ul className="divide-y divide-gray-100">
        {filtered.map((c) => (
          <li key={c.id}>
            <Link
              to={`/customer/${c.id}`}
              className="block px-4 py-3 hover:bg-gray-50"
            >
              <div className="font-medium text-gray-900">{c.name}</div>
              <div className="text-xs text-gray-400">
                最終訪問:{" "}
                {c.lastVisit
                  ? new Date(c.lastVisit).toLocaleDateString("ja-JP")
                  : "—"}
              </div>
            </Link>
          </li>
        ))}
      </ul>
      {filtered.length === 0 && (
        <p className="p-4 text-center text-sm text-gray-500">該当する顧客がありません。</p>
      )}
    </div>
  );
}
