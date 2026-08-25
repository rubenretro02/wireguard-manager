import { NextResponse } from "next/server";
import { apiError, authenticateApiKey } from "@/lib/api-auth";
import { allowedPublicIpsForRouter, canUseRouter } from "@/lib/access-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/ips?server=<id> — public IPs this key may create peers on. */
export async function GET(request: Request) {
  const { caller, error } = await authenticateApiKey(request);
  if (error || !caller) return error!;

  const serverId = new URL(request.url).searchParams.get("server");
  if (!serverId) return apiError("Missing ?server=<id>", 400);
  if (!(await canUseRouter(caller.admin, caller, serverId))) {
    return apiError("You don't have access to this server", 403);
  }

  const ips = await allowedPublicIpsForRouter(caller.admin, caller, serverId);
  return NextResponse.json({
    ips: ips.map((ip) => ({
      id: ip.id,
      publicIp: ip.public_ip,
      internalSubnet: ip.internal_subnet,
      number: ip.ip_number,
    })),
  });
}
