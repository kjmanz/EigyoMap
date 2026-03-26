import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function csvEscape(s: string | null | undefined): string {
  const v = s ?? "";
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();
  if (userErr || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data: customers, error: cErr } = await supabase
    .from("customers")
    .select("id,name,address,phone,memo,lat,lng,created_at,updated_at")
    .eq("user_id", user.id)
    .order("name");

  if (cErr) {
    return new Response(JSON.stringify({ error: cErr.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const cids = (customers ?? []).map((c) => c.id as string);
  let logs: {
    id: string;
    customer_id: string;
    memo: string;
    visited_at: string;
    pinned: boolean;
  }[] = [];

  if (cids.length > 0) {
    const { data: lg, error: lErr } = await supabase
      .from("contact_logs")
      .select("id,customer_id,memo,visited_at,pinned")
      .in("customer_id", cids)
      .order("visited_at", { ascending: false });
    if (lErr) {
      return new Response(JSON.stringify({ error: lErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    logs = (lg ?? []) as typeof logs;
  }

  const customerById = new Map((customers ?? []).map((c) => [c.id as string, c]));
  const withLog = new Set(logs.map((l) => l.customer_id));

  const BOM = "\uFEFF";
  const lines: string[] = [];
  lines.push(
    [
      "customer_id",
      "customer_name",
      "address",
      "phone",
      "customer_memo",
      "lat",
      "lng",
      "log_id",
      "memo",
      "visited_at",
      "pinned",
    ].join(",")
  );

  for (const log of logs) {
    const c = customerById.get(log.customer_id);
    lines.push(
      [
        csvEscape(log.customer_id),
        csvEscape(c?.name as string),
        csvEscape(c?.address as string),
        csvEscape(c?.phone as string),
        csvEscape(c?.memo as string),
        String(c?.lat ?? ""),
        String(c?.lng ?? ""),
        csvEscape(log.id),
        csvEscape(log.memo),
        csvEscape(log.visited_at),
        log.pinned ? "true" : "false",
      ].join(",")
    );
  }

  for (const c of customers ?? []) {
    const id = c.id as string;
    if (!withLog.has(id)) {
      lines.push(
        [
          csvEscape(id),
          csvEscape(c.name as string),
          csvEscape(c.address as string),
          csvEscape(c.phone as string),
          csvEscape(c.memo as string),
          String(c.lat ?? ""),
          String(c.lng ?? ""),
          "",
          "",
          "",
          "",
        ].join(",")
      );
    }
  }

  const body = BOM + lines.join("\n");
  return new Response(body, {
    headers: {
      ...corsHeaders,
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="export.csv"',
    },
  });
});
