import { NextResponse } from "next/server";
import { apiError, authenticateApiKey } from "@/lib/api-auth";
import { allowedRouterIds } from "@/lib/access-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/servers — the servers this key may use. */
export async function GET(request: Request) {
  const { caller, error } = await authenticateApiKey(request);
  if (error || !caller) return error!;

  const allowed = await allowedRouterIds(caller.admin, caller);
  let query = caller.admin
    .from("routers")
    .select("id, name, connection_type, public_ip_prefix, endpoint_slug, endpoint_domain")
    .order("name");
  if (allowed !== null) {
    if (allowed.size === 0) return NextResponse.json({ servers: [] });
    query = query.in("id", Array.from(allowed));
  }

  const { data, error: dbError } = await query;
  if (dbError) return apiError(dbError.message, 500);

  return NextResponse.json({
    servers: (data || []).map((r: { id: string; name: string; connection_type: string; public_ip_prefix: string | null }) => ({
      id: r.id,
      name: r.name,
      type: r.connection_type,
      publicIpPrefix: r.public_ip_prefix,
    })),
  });
}
