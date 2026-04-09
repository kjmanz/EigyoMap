import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AppHeader } from "../components/AppHeader";
import { supabase } from "../lib/supabase";
import type { ContactLogRow, CustomerRow } from "../lib/types";
import { useAuth } from "../contexts/AuthContext";

type Row = CustomerRow & { lastVisit: string | null };

export function CustomerListPage() {
  const { user } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState("");

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

  return (
    <div className="min-h-screen bg-white">
      <AppHeader
        variant="main"
        title="顧客一覧"
        activeNav="list"
        search={{
          value: q,
          onChange: setQ,
          placeholder: "名前で検索",
        }}
      />
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
