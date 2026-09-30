import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/peer-log?publicKey=…&range=today|week|month|all
 *
 * One timeline per peer: what the panel did to it (activity_logs, keyed by
 * peer_public_key since v31) merged with its online/offline sessions
 * (peer_sessions, written by /api/cron/peer-presence). Sessions become two
 * rows — online / offline — plus a summary the UI shows as "N sessions · Xh".
 */
export interface PeerLogEvent {
  at: string;
  kind: "online" | "offline" | "created" | "enabled" | "disabled" | "expired" | "renewed" | "timer" | "deleted" | "assigned" | "unassigned" | "keys" | "updated";
  title: string;
  detail?: string | null;
  actor?: string | null;
  // For "online": how long that session lasted (ms), null while still open
  durationMs?: number | null;
}

function rangeStart(range: string | null): Date | null {
  const now = new Date();
  if (range === "today") return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (range === "week") return new Date(now.getTime() - 7 * 86400000);
  if (range === "month") return new Date(now.getTime() - 30 * 86400000);
  return null;
}

function describe(row: {
  action: string;
  details: Record<string, unknown> | null;
  profiles?: { email?: string | null } | null;
}): Pick<PeerLogEvent, "kind" | "title" | "detail" | "actor"> {
  const d = row.details || {};
  const actor = row.profiles?.email?.split("@")[0] || (d.source ? String(d.source) : "system");
  const auto = d.auto === true;

  switch (row.action) {
    case "create":
      return { kind: "created", title: "Created", detail: [d.publicIp, d.allowedAddress].filter(Boolean).join(" · ") || null, actor };
    case "delete":
      return { kind: "deleted", title: "Deleted", detail: null, actor };
    case "enable":
      return { kind: "enabled", title: auto ? "Enabled automatically" : "Enabled", detail: typeof d.reason === "string" && auto ? d.reason : null, actor };
    case "disable":
      if (auto && /expired/i.test(String(d.reason || ""))) {
        return { kind: "expired", title: "Expired", detail: "subscription ended — removed from the server", actor: "timer" };
      }
      return { kind: "disabled", title: auto ? "Disabled automatically" : "Suspended", detail: typeof d.reason === "string" && auto ? d.reason : null, actor };
    case "renew": {
      const days = d.days ?? d.telegram_extend_days;
      const until = typeof d.expires_at === "string" ? new Date(d.expires_at).toLocaleString() : null;
      return {
        kind: "renewed",
        title: "Renewed",
        detail: [days ? `+${days}d` : null, until ? `until ${until}` : null, d.amount_usd ? `$${d.amount_usd}` : null].filter(Boolean).join(" · ") || null,
        actor,
      };
    }
    case "update":
      if (d.keyChanged) return { kind: "keys", title: "Keys rotated", detail: null, actor };
      if (d.assigned_to_customer) return { kind: "assigned", title: "Assigned to customer", detail: d.days ? `${d.days} days` : null, actor };
      if (d.unassigned_from_customer || d.telegram_unassigned) return { kind: "unassigned", title: "Removed from customer", detail: null, actor };
      if (d.timer_removed) return { kind: "timer", title: "Timer removed", detail: "no expiry", actor };
      if (d.timer_mode) {
        const until = typeof d.expires_at === "string" ? new Date(d.expires_at).toLocaleString() : null;
        return { kind: "timer", title: d.timer_mode === "extend" ? "Renewed" : "Expiry set", detail: until ? `until ${until}` : null, actor };
      }
      return { kind: "updated", title: "Updated", detail: Array.isArray(d.updatedFields) ? d.updatedFields.join(", ") : null, actor };
    default:
      return { kind: "updated", title: row.action, detail: null, actor };
  }
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const publicKey = url.searchParams.get("publicKey");
  const range = url.searchParams.get("range");
  if (!publicKey) return NextResponse.json({ error: "Missing publicKey" }, { status: 400 });

  const admin = createAdminClient() ?? supabase;
  const since = rangeStart(range);

  let logs = admin
    .from("activity_logs")
    .select("action, details, created_at, profiles:user_id (email)")
    .eq("peer_public_key", publicKey)
    .order("created_at", { ascending: false })
    .limit(300);
  if (since) logs = logs.gte("created_at", since.toISOString());

  let sessions = admin
    .from("peer_sessions")
    .select("started_at, ended_at, client_ip, rx_bytes, tx_bytes")
    .eq("peer_public_key", publicKey)
    .order("started_at", { ascending: false })
    .limit(500);
  if (since) sessions = sessions.gte("started_at", since.toISOString());

  const [{ data: logRows, error: logError }, { data: sessionRows }] = await Promise.all([logs, sessions]);
  if (logError && !/peer_public_key/.test(logError.message)) {
    return NextResponse.json({ error: logError.message }, { status: 500 });
  }

  const events: PeerLogEvent[] = [];
  for (const row of logRows || []) {
    const r = row as unknown as { action: string; details: Record<string, unknown> | null; created_at: string; profiles?: { email?: string | null } | null };
    events.push({ at: r.created_at, ...describe(r) });
  }

  let totalOnlineMs = 0;
  let sessionCount = 0;
  let onlineNow = false;
  for (const s of sessionRows || []) {
    const start = new Date(s.started_at).getTime();
    const end = s.ended_at ? new Date(s.ended_at).getTime() : Date.now();
    const duration = Math.max(0, end - start);
    totalOnlineMs += duration;
    sessionCount++;
    if (!s.ended_at) onlineNow = true;
    events.push({
      at: s.started_at,
      kind: "online",
      title: s.client_ip ? `online · from ${s.client_ip}` : "online",
      detail: null,
      durationMs: s.ended_at ? duration : null,
    });
    if (s.ended_at) events.push({ at: s.ended_at, kind: "offline", title: "offline", detail: null });
  }

  events.sort((a, b) => b.at.localeCompare(a.at));

  return NextResponse.json({
    events,
    summary: { sessions: sessionCount, totalOnlineMs, onlineNow },
  });
}
