import { NextResponse } from "next/server";
import { apiError, authenticateApiKey } from "@/lib/api-auth";
import { resolvePeerFor } from "@/lib/api-context";
import { resolveExpiry, setUnifiedExpiry, type ExpiryMode } from "@/lib/peer-expiry";
import { logActivity } from "@/lib/activity-logger";
import type { TimeUnit } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/peers/{id}/expiry
 *   { days: 30 }                       -> extends by 30 days
 *   { value: 12, unit: "hours" }       -> same, other units
 *   { expiresAt: "2026-12-01T00:00Z" } -> exact date
 *   { expiresAt: null }                -> removes the timer
 *   { mode: "set" }                    -> replace instead of extend
 *
 * Writes the single unified timer (dashboard + Telegram store).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { caller, error } = await authenticateApiKey(request);
  if (error || !caller) return error!;
  if (!caller.isAdmin && !caller.capabilities.can_auto_expire) {
    return apiError("Your account can't set expiry timers", 403, "no_auto_expire");
  }

  const found = await resolvePeerFor(caller, (await params).id);
  if ("error" in found) return apiError(found.error, found.status);

  const body = await request.json().catch(() => ({}));
  const mode: ExpiryMode = body.mode === "set" ? "set" : "extend";
  const duration = body.days
    ? { value: Number(body.days), unit: "days" as TimeUnit }
    : body.value
      ? { value: Number(body.value), unit: (body.unit || "days") as TimeUnit }
      : null;

  if (!duration && body.expiresAt === undefined) {
    return apiError("Send days, or value+unit, or expiresAt (null clears the timer)", 400);
  }

  const { data: current } = await caller.admin
    .from("peer_metadata")
    .select("expires_at")
    .eq("router_id", found.router.id)
    .eq("peer_public_key", found.peer.publicKey)
    .maybeSingle();

  const expiresAt = resolveExpiry({
    current: current?.expires_at,
    mode,
    expiresAt: body.expiresAt,
    duration,
  });

  await setUnifiedExpiry(
    caller.admin,
    { routerId: found.router.id, publicKey: found.peer.publicKey },
    expiresAt,
    {
      duration,
      identity: {
        peerName: found.peer.name,
        allowedAddress: found.peer.address,
        peerInterface: found.peer.interface,
        createdByEmail: found.peer.createdBy,
      },
    }
  );

  await logActivity({
    supabase: caller.admin,
    userId: caller.userId,
    routerId: found.router.id,
    action: "update",
    entityType: "peer",
    entityId: found.peer.id,
    entityName: found.peer.name,
    details: { expiresAt, mode, source: "api" },
  });

  return NextResponse.json({ peer: found.peer.id, expiresAt });
}
