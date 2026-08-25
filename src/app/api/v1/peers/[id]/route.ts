import { NextResponse } from "next/server";
import { apiError, authenticateApiKey } from "@/lib/api-auth";
import { resolvePeerFor } from "@/lib/api-context";
import { deletePeer } from "@/lib/api-peers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/peers/{id} */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { caller, error } = await authenticateApiKey(request);
  if (error || !caller) return error!;

  const found = await resolvePeerFor(caller, (await params).id);
  if ("error" in found) return apiError(found.error, found.status);
  return NextResponse.json({ peer: found.peer });
}

/** DELETE /api/v1/peers/{id} — requires the can_delete capability. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { caller, error } = await authenticateApiKey(request);
  if (error || !caller) return error!;
  if (!caller.isAdmin && !caller.capabilities.can_delete) {
    return apiError("Your account can't delete peers", 403, "no_delete");
  }

  const found = await resolvePeerFor(caller, (await params).id);
  if ("error" in found) return apiError(found.error, found.status);

  const res = await deletePeer(caller.admin, found.router, found.peer, {
    id: caller.userId,
    email: caller.email,
  });
  if ("error" in res) return apiError(res.error, res.status);
  return NextResponse.json({ deleted: true });
}
