import { NextResponse } from "next/server";
import { apiError, authenticateApiKey } from "@/lib/api-auth";
import { resolvePeerFor } from "@/lib/api-context";
import { buildPeerConfig } from "@/lib/api-peers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/peers/{id}/config — the .conf for this peer.
 * ?format=text returns the file itself; the default returns JSON.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { caller, error } = await authenticateApiKey(request);
  if (error || !caller) return error!;

  const found = await resolvePeerFor(caller, (await params).id);
  if ("error" in found) return apiError(found.error, found.status);

  const config = await buildPeerConfig(caller.admin, found.router, found.peer, found.privateKey);

  if (new URL(request.url).searchParams.get("format") === "text") {
    return new NextResponse(config, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="${found.peer.name || "peer"}.conf"`,
      },
    });
  }

  return NextResponse.json({
    config,
    // Peers created outside the app have no stored private key
    hasPrivateKey: Boolean(found.privateKey),
  });
}
