import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const routerId = searchParams.get("routerId");
  const limit = parseInt(searchParams.get("limit") || "50", 10);
  const offset = parseInt(searchParams.get("offset") || "0", 10);
  const search = searchParams.get("search") || "";
  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");

  // First, get the total count for pagination
  let countQuery = supabase
    .from("activity_logs")
    .select("*", { count: "exact", head: true });

  if (routerId) {
    countQuery = countQuery.eq("router_id", routerId);
  }

  if (startDate) {
    countQuery = countQuery.gte("created_at", startDate);
  }

  if (endDate) {
    countQuery = countQuery.lte("created_at", endDate);
  }

  // Build the main query
  let query = supabase
    .from("activity_logs")
    .select(`
      *,
      profiles:user_id (
        id,
        email,
        username
      ),
      routers:router_id (
        id,
        name
      )
    `)
    .order("created_at", { ascending: false });

  if (routerId) {
    query = query.eq("router_id", routerId);
  }

  if (startDate) {
    query = query.gte("created_at", startDate);
  }

  if (endDate) {
    query = query.lte("created_at", endDate);
  }

  // Apply pagination
  query = query.range(offset, offset + limit - 1);

  const [countResult, logsResult] = await Promise.all([
    countQuery,
    query
  ]);

  if (logsResult.error) {
    console.error("[Activity Logs] Error fetching:", logsResult.error);
    return NextResponse.json({ error: logsResult.error.message }, { status: 500 });
  }

  let logs = logsResult.data || [];

  // If there's a search term, filter results client-side
  // This allows searching across multiple fields including JSONB details
  if (search && search.trim().length > 0) {
    const searchLower = search.toLowerCase().trim();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    logs = logs.filter((log: any) => {
      // Search in entity_name
      if (log.entity_name && log.entity_name.toLowerCase().includes(searchLower)) {
        return true;
      }
      // Search in entity_id
      if (log.entity_id && log.entity_id.toLowerCase().includes(searchLower)) {
        return true;
      }
      // Search in ip_address
      if (log.ip_address && log.ip_address.toLowerCase().includes(searchLower)) {
        return true;
      }
      // Search in action
      if (log.action && log.action.toLowerCase().includes(searchLower)) {
        return true;
      }
      // Search in entity_type
      if (log.entity_type && log.entity_type.toLowerCase().includes(searchLower)) {
        return true;
      }
      // Search in details (JSONB field) - stringify and search
      if (log.details) {
        const detailsStr = JSON.stringify(log.details).toLowerCase();
        if (detailsStr.includes(searchLower)) {
          return true;
        }
      }
      // Search in user email/username
      if (log.profiles) {
        if (log.profiles.email && log.profiles.email.toLowerCase().includes(searchLower)) {
          return true;
        }
        if (log.profiles.username && log.profiles.username.toLowerCase().includes(searchLower)) {
          return true;
        }
      }
      // Search in router name
      if (log.routers && log.routers.name && log.routers.name.toLowerCase().includes(searchLower)) {
        return true;
      }
      return false;
    });
  }

  return NextResponse.json({
    logs,
    total: countResult.count || 0,
    hasMore: (offset + limit) < (countResult.count || 0),
    offset,
    limit
  });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const {
    routerId,
    action,
    entityType,
    entityId,
    entityName,
    details
  } = body;

  if (!action || !entityType) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  // Get client IP from headers
  const forwardedFor = request.headers.get("x-forwarded-for");
  const ipAddress = forwardedFor ? forwardedFor.split(",")[0].trim() : null;

  const { data: log, error } = await supabase
    .from("activity_logs")
    .insert({
      router_id: routerId || null,
      user_id: user.id,
      action,
      entity_type: entityType,
      entity_id: entityId || null,
      entity_name: entityName || null,
      details: details || {},
      ip_address: ipAddress,
    })
    .select()
    .single();

  if (error) {
    console.error("[Activity Logs] Error creating:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ log, success: true });
}
