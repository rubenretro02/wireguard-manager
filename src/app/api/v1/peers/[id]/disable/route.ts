import { NextResponse } from "next/server";
import { apiError, authenticateApiKey } from "@/lib/api-auth";
import { resolvePeerFor } from "@/lib/api-context";
import { setPeerEnabled } from "@/lib/api-peers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/v1/peers/{id}/disable */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { caller, error } = await authenticateApiKey(request);
  if (error || !caller) return error!;

  const found = await resolvePeerFor(caller, (await params).id);
  if ("error" in found) return apiError(found.error, found.status);

  const res = await setPeerEnabled(caller.admin, found.router, found.peer, false, {
    id: caller.userId,
    email: caller.email,
  });
  if ("error" in res) return apiError(res.error, res.status);
  return NextResponse.json({ peer: { ...found.peer, enabled: false } });
}
