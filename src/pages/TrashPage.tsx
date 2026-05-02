import { useCallback, useEffect, useState } from "react";
import { AppHeader } from "../components/AppHeader";
import { DesktopAppShell } from "../components/DesktopAppShell";
import { supabase } from "../lib/supabase";
import { canRestore, daysUntilPermanentDeletion } from "../lib/softDelete";
import type { ContactLogRow, CustomerRow } from "../lib/types";
import { useAuth } from "../contexts/AuthContext";

type TrashedCustomer = CustomerRow & { deleted_at: string };
type TrashedLog = ContactLogRow & {
  deleted_at: string;
  customers: { name: string; deleted_at: string | null } | null;
};

export function TrashPage() {
  const { user } = useAuth();
  const [customers, setCustomers] = useState<TrashedCustomer[]>([]);
  const [logs, setLogs] = useState<TrashedLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setErr(null);
    const { data: cus, error: e1 } = await supabase
      .from("customers")
      .select("*")
      .eq("user_id", user.id)
      .not("deleted_at", "is", null)
      .order("deleted_at", { ascending: false });
    if (e1) setErr(e1.message);
    else setCustomers((cus ?? []) as TrashedCustomer[]);

    const { data: lg, error: e2 } = await supabase
      .from("contact_logs")
      .select("*, customers(name, deleted_at)")
      .eq("user_id", user.id)
      .not("deleted_at", "is", null)
      .order("deleted_at", { ascending: false });
    if (e2) setErr(e2.message);
    else {
      const rows = (lg ?? []) as TrashedLog[];
      setLogs(
        rows.filter(
          (r) => r.customers != null && r.customers.deleted_at == null
        )
      );
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  async function restoreCustomer(id: string) {
    setBusyId(`c-${id}`);
    setErr(null);
    const { error } = await supabase.from("customers").update({ deleted_at: null }).eq("id", id);
    setBusyId(null);
    if (error) {
      setErr(error.message);
      return;
    }
    await load();
  }

  async function restoreLog(id: string) {
    setBusyId(`l-${id}`);
    setErr(null);
    const { error } = await supabase.from("contact_logs").update({ deleted_at: null }).eq("id", id);
    setBusyId(null);
    if (error) {
      setErr(error.message);
      return;
    }
    await load();
  }

  return (
    <DesktopAppShell sidebarActive="settings">
      <div className="min-h-screen flex-1 bg-white lg:overflow-auto lg:bg-gray-50/40">
      <AppHeader variant="main" title="ゴミ箱" activeNav={null} />
      <div className="p-4 lg:mx-auto lg:max-w-3xl lg:pb-12 lg:pt-2">
      <p className="mb-4 text-xs text-gray-600">
        削除した顧客・メモは 30 日間ここから復元できます。期限後は自動で完全削除されます（写真も含む）。
      </p>
      {err && <p className="mb-3 text-sm text-red-600">{err}</p>}

      {loading ? (
        <p className="text-sm text-gray-500">読み込み中…</p>
      ) : (
        <>
          <section className="mb-8">
            <h2 className="text-sm font-medium text-gray-700">削除した顧客</h2>
            {customers.length === 0 ? (
              <p className="mt-2 text-sm text-gray-500">なし</p>
            ) : (
              <ul className="mt-2 divide-y divide-gray-100 rounded border border-gray-200">
                {customers.map((c) => {
                  const ok = canRestore(c.deleted_at);
                  const days = daysUntilPermanentDeletion(c.deleted_at);
                  return (
                    <li key={c.id} className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <div className="font-medium text-gray-900">{c.name}</div>
                        <div className="text-xs text-gray-500">
                          削除: {new Date(c.deleted_at).toLocaleString("ja-JP")}
                          {days != null && ` ・ あと約 ${days} 日で完全削除`}
                          {!ok && " ・ 復元期限切れ（管理者のパージ待ち）"}
                        </div>
                      </div>
                      {ok ? (
                        <button
                          type="button"
                          className="rounded bg-accent px-3 py-1.5 text-sm text-white disabled:opacity-50"
                          disabled={busyId !== null}
                          onClick={() => void restoreCustomer(c.id)}
                        >
                          復元
                        </button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section>
            <h2 className="text-sm font-medium text-gray-700">削除したメモ（顧客は有効なもの）</h2>
            {logs.length === 0 ? (
              <p className="mt-2 text-sm text-gray-500">なし</p>
            ) : (
              <ul className="mt-2 divide-y divide-gray-100 rounded border border-gray-200">
                {logs.map((log) => {
                  const ok = canRestore(log.deleted_at);
                  const days = daysUntilPermanentDeletion(log.deleted_at);
                  const preview =
                    log.memo.length > 80 ? `${log.memo.slice(0, 80)}…` : log.memo;
                  return (
                    <li key={log.id} className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <div className="font-medium text-gray-900">
                          {log.customers?.name ?? "顧客"}
                        </div>
                        <p className="mt-1 line-clamp-2 text-sm text-gray-700">{preview}</p>
                        <div className="mt-1 text-xs text-gray-500">
                          削除: {new Date(log.deleted_at).toLocaleString("ja-JP")}
                          {days != null && ` ・ あと約 ${days} 日で完全削除`}
                          {!ok && " ・ 復元期限切れ"}
                        </div>
                      </div>
                      {ok ? (
                        <button
                          type="button"
                          className="shrink-0 rounded bg-accent px-3 py-1.5 text-sm text-white disabled:opacity-50"
                          disabled={busyId !== null}
                          onClick={() => void restoreLog(log.id)}
                        >
                          復元
                        </button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}
      </div>
      </div>
    </DesktopAppShell>
  );
}
