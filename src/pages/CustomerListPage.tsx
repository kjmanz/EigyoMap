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
        <div className="lg:mx-auto lg:mb-12 lg:mt-8 lg:max-w-5xl lg:px-8">
          <div className="hidden lg:mb-3 lg:flex lg:items-center lg:justify-between">
            <p className="text-sm text-slate-600">
              合計{" "}
              <span className="font-semibold tabular-nums text-slate-900">{filtered.length}</span>
              {" "}件（前回アクティビティ順）
            </p>
          </div>
          {filtered.length === 0 ? (
            <p className="p-8 text-center text-sm text-gray-500 lg:rounded-2xl lg:border lg:border-dashed lg:border-slate-200 lg:bg-white lg:py-16">
              該当する顧客がありません。
            </p>
          ) : (
            <div className="overflow-hidden bg-white lg:rounded-2xl lg:border lg:border-slate-200 lg:shadow-[0_4px_24px_-8px_rgba(15,23,42,0.12)]">
              <div
                className="hidden lg:grid lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)_6.75rem] lg:gap-x-6 lg:border-b lg:border-slate-100 lg:bg-slate-50/90 lg:px-8 lg:py-3"
              >
                <span className="text-xs font-semibold tracking-wide text-slate-600">顧客名</span>
                <span className="text-xs font-semibold tracking-wide text-slate-600">ラベル</span>
                <span className="text-right text-xs font-semibold tracking-wide text-slate-600">
                  前回の訪問
                </span>
              </div>
              <ul className="divide-y divide-gray-100 lg:divide-slate-100">
                {filtered.map((c) => {
                  const visitTone = c.lastVisit
                    ? (Date.now() - new Date(c.lastVisit).getTime()) / 86400000 > 30
                      ? "text-red-600"
                      : (Date.now() - new Date(c.lastVisit).getTime()) / 86400000 > 7
                        ? "text-amber-700"
                        : "text-emerald-700"
                    : "text-slate-400";
                  return (
                    <li key={c.id}>
                      <Link
                        to={`/customer/${c.id}`}
                        className="group block px-4 py-3.5 transition-colors active:bg-gray-50 lg:grid lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)_6.75rem] lg:items-center lg:gap-x-6 lg:px-8 lg:py-4 lg:hover:bg-slate-50/90"
                      >
                        <div className="lg:hidden">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium text-gray-900">{c.name}</span>
                            <span className={`shrink-0 text-xs font-semibold tabular-nums ${visitTone}`}>
                              {relativeDate(c.lastVisit)}
                            </span>
                          </div>
                          {c.labels.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {c.labels.map((lb) => (
                                <span
                                  key={lb.id}
                                  className="inline-block rounded-full px-2 py-0.5 text-[10px] font-medium"
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
                        </div>
                        <span className="hidden min-w-0 truncate font-semibold text-slate-900 lg:block lg:text-[15px] lg:group-hover:text-accent">
                          {c.name}
                        </span>
                        <div className="hidden flex-wrap gap-1.5 lg:flex">
                          {c.labels.length === 0 ? (
                            <span className="py-0.5 text-xs text-slate-400">—</span>
                          ) : (
                            c.labels.map((lb) => (
                              <span
                                key={lb.id}
                                className="inline-block rounded-md px-2 py-0.5 text-[11px] font-medium"
                                style={{
                                  backgroundColor: lb.color,
                                  color: labelChipTextColor(lb.color),
                                }}
                              >
                                {lb.name}
                              </span>
                            ))
                          )}
                        </div>
                        <span
                          className={`hidden text-right text-sm font-medium tabular-nums lg:block ${visitTone}`}
                        >
                          {relativeDate(c.lastVisit)}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      <BottomNav active="list" />
      </div>
    </DesktopAppShell>
  );
}
