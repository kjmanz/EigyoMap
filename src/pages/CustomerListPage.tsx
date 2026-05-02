import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AppHeader } from "../components/AppHeader";
import { BottomNav } from "../components/BottomNav";
import { DesktopAppShell } from "../components/DesktopAppShell";
import { labelChipTextColor, labelsFromCustomerJoin } from "../lib/customerLabels";
import { relativeDate } from "../lib/relativeDate";
import { supabase } from "../lib/supabase";
import type { ContactLogRow, CustomerRow, LabelSummary } from "../lib/types";
import { useAuth } from "../contexts/AuthContext";

type Row = CustomerRow & { lastVisit: string | null; labels: LabelSummary[] };

export function CustomerListPage() {
  const { user } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    if (!user) return;
    const { data: customers, error } = await supabase
      .from("customers")
      .select("*, customer_labels(label_id, labels(id, name, color))")
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
    const enriched: Row[] = (customers as (CustomerRow & { customer_labels?: { label_id?: string; labels?: LabelSummary | null }[] })[]).map((c) => ({
      ...c,
      lastVisit: lastBy.get(c.id) ?? null,
      labels: labelsFromCustomerJoin(c.customer_labels),
    }));
    enriched.sort((a, b) => {
      const ta = a.lastVisit ?? a.updated_at;
      const tb = b.lastVisit ?? b.updated_at;
      return tb.localeCompare(ta);
    });
    setRows(enriched);
  }, [user]);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) => r.name.toLowerCase().includes(s));
  }, [rows, q]);

  return (
    <DesktopAppShell sidebarActive="list">
      <div className="flex min-h-screen flex-col bg-white pb-16 lg:min-h-0 lg:flex-1 lg:overflow-auto lg:bg-gray-50/40 lg:pb-0">
        <AppHeader
          variant="main"
          title="顧客一覧"
          activeNav="list"
          search={{ value: q, onChange: setQ, placeholder: "名前で検索" }}
        />
        <ul className="divide-y divide-gray-100 bg-white lg:mx-8 lg:mb-10 lg:mt-6 lg:max-w-5xl xl:mx-auto xl:rounded-xl xl:border xl:border-gray-200 xl:shadow-sm">
          {filtered.map((c) => (
            <li key={c.id}>
              <Link
                to={`/customer/${c.id}`}
                className="block px-4 py-3 active:bg-gray-50 lg:px-6 lg:py-3.5 lg:transition-colors lg:hover:bg-slate-50"
              >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-gray-900">{c.name}</span>
                <span className={`shrink-0 text-xs font-medium ${
                  c.lastVisit
                    ? (Date.now() - new Date(c.lastVisit).getTime()) / 86400000 > 30
                      ? "text-red-500"
                      : (Date.now() - new Date(c.lastVisit).getTime()) / 86400000 > 7
                        ? "text-amber-600"
                        : "text-green-600"
                    : "text-gray-400"
                }`}>
                  {relativeDate(c.lastVisit)}
                </span>
              </div>
              {c.labels.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {c.labels.map((lb) => (
                    <span
                      key={lb.id}
                      className="inline-block rounded-full px-2 py-0.5 text-[10px] font-medium"
                      style={{ backgroundColor: lb.color, color: labelChipTextColor(lb.color) }}
                    >
                      {lb.name}
                    </span>
                  ))}
                </div>
              )}
            </Link>
          </li>
        ))}
      </ul>
      {filtered.length === 0 && (
        <p className="p-4 text-center text-sm text-gray-500">該当する顧客がありません。</p>
      )}
      <BottomNav active="list" />
      </div>
    </DesktopAppShell>
  );
}
