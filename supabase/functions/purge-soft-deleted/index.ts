/**
 * ソフトデリートから 30 日経過した行を物理削除し、先に Storage の写真を削除する。
 * Supabase Dashboard のスケジュール（cron）で service_role 付きで呼び出す想定。
 * ヘッダー: Authorization: Bearer <SERVICE_ROLE_KEY>
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceKey) {
    return new Response(JSON.stringify({ error: "SUPABASE_SERVICE_ROLE_KEY missing" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (token !== serviceKey) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(supabaseUrl, serviceKey);
  const cutoff = new Date(Date.now() - RETENTION_MS).toISOString();
  let storageRemoved = 0;
  let logsPurged = 0;
  let customersPurged = 0;

  async function removePaths(paths: string[]) {
    const uniq = [...new Set(paths.filter(Boolean))];
    if (uniq.length === 0) return;
    const { error } = await admin.storage.from("photos").remove(uniq);
    if (error) throw error;
    storageRemoved += uniq.length;
  }

  try {
    // 1) メモ単体ソフトデリートの期限切れ
    const { data: expiredLogs, error: e1 } = await admin
      .from("contact_logs")
      .select("id, photos(storage_path)")
      .not("deleted_at", "is", null)
      .lt("deleted_at", cutoff);

    if (e1) throw e1;

    const logIds: string[] = [];
    const paths: string[] = [];
    for (const row of expiredLogs ?? []) {
      logIds.push(row.id as string);
      for (const p of (row as { photos?: { storage_path: string }[] }).photos ?? []) {
        paths.push(p.storage_path);
      }
    }
    await removePaths(paths);
    if (logIds.length > 0) {
      const { error: d1 } = await admin.from("contact_logs").delete().in("id", logIds);
      if (d1) throw d1;
      logsPurged = logIds.length;
    }

    // 2) 顧客ソフトデリートの期限切れ（配下メモ・写真すべて）
    const { data: expiredCust, error: e2 } = await admin
      .from("customers")
      .select("id")
      .not("deleted_at", "is", null)
      .lt("deleted_at", cutoff);

    if (e2) throw e2;

    for (const c of expiredCust ?? []) {
      const cid = c.id as string;
      const { data: cls, error: e3 } = await admin
        .from("contact_logs")
        .select("id, photos(storage_path)")
        .eq("customer_id", cid);
      if (e3) throw e3;
      const cpaths: string[] = [];
      for (const row of cls ?? []) {
        for (const p of (row as { photos?: { storage_path: string }[] }).photos ?? []) {
          cpaths.push(p.storage_path);
        }
      }
      await removePaths(cpaths);
      const { error: d2 } = await admin.from("customers").delete().eq("id", cid);
      if (d2) throw d2;
      customersPurged += 1;
    }

    return new Response(
      JSON.stringify({
        ok: true,
        cutoff,
        storage_objects_removed: storageRemoved,
        contact_logs_purged: logsPurged,
        customers_purged: customersPurged,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
