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
  const period = searchParams.get("period") || "30"; // days to look back
  const groupBy = searchParams.get("groupBy") || "day"; // day, week, month

  // Calculate start date based on period
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - parseInt(period, 10));

  // Build query for all logs within period
  let query = supabase
    .from("activity_logs")
    .select("id, action, entity_type, created_at")
    .gte("created_at", startDate.toISOString())
    .order("created_at", { ascending: true });

  if (routerId) {
    query = query.eq("router_id", routerId);
  }

  const { data: logs, error } = await query;

  if (error) {
    console.error("[Activity Stats] Error fetching:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Group logs by date
  const groupedByDate: Record<string, { total: number; actions: Record<string, number>; entityTypes: Record<string, number> }> = {};

  for (const log of logs || []) {
    const date = new Date(log.created_at);
    let key: string;

    if (groupBy === "month") {
      key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    } else if (groupBy === "week") {
      // Get ISO week number
      const firstDayOfYear = new Date(date.getFullYear(), 0, 1);
      const pastDaysOfYear = (date.getTime() - firstDayOfYear.getTime()) / 86400000;
      const weekNumber = Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);
      key = `${date.getFullYear()}-W${String(weekNumber).padStart(2, "0")}`;
    } else {
      // day
      key = date.toISOString().split("T")[0];
    }

    if (!groupedByDate[key]) {
      groupedByDate[key] = { total: 0, actions: {}, entityTypes: {} };
    }

    groupedByDate[key].total++;
    groupedByDate[key].actions[log.action] = (groupedByDate[key].actions[log.action] || 0) + 1;
    groupedByDate[key].entityTypes[log.entity_type] = (groupedByDate[key].entityTypes[log.entity_type] || 0) + 1;
  }

  // Convert to array format for charts
  const chartData = Object.entries(groupedByDate).map(([date, data]) => ({
    date,
    total: data.total,
    creates: data.actions.create || 0,
    updates: data.actions.update || 0,
    deletes: data.actions.delete || 0,
    enables: data.actions.enable || 0,
    disables: data.actions.disable || 0,
    peers: data.entityTypes.peer || 0,
    publicIps: data.entityTypes.public_ip || 0,
    users: data.entityTypes.user || 0,
  }));

  // Calculate totals by action type
  const actionTotals: Record<string, number> = {};
  const entityTotals: Record<string, number> = {};

  for (const log of logs || []) {
    actionTotals[log.action] = (actionTotals[log.action] || 0) + 1;
    entityTotals[log.entity_type] = (entityTotals[log.entity_type] || 0) + 1;
  }

  // Calculate daily average
  const totalDays = Math.max(1, Object.keys(groupedByDate).length);
  const dailyAverage = Math.round((logs?.length || 0) / totalDays * 10) / 10;

  return NextResponse.json({
    chartData,
    summary: {
      total: logs?.length || 0,
      dailyAverage,
      actionTotals,
      entityTotals,
      period: parseInt(period, 10),
      groupBy,
    }
  });
}
