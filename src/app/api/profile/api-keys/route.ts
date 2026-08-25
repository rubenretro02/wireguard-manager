import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { generateApiKey } from "@/lib/api-auth";
import { logActivity } from "@/lib/activity-logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Ctx {
  userId: string;
  email: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any;
  canIssue: boolean;
}

async function context(): Promise<{ ctx?: Ctx; error?: NextResponse }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };

  const admin = createAdminClient();
  if (!admin) return { error: NextResponse.json({ error: "Service role not configured" }, { status: 500 }) };

  const { data: profile } = await admin.from("profiles").select("role, capabilities").eq("id", user.id).single();
  const isAdmin = profile?.role?.toLowerCase() === "admin";
  return {
    ctx: {
      userId: user.id,
      email: user.email || "",
      admin,
      canIssue: isAdmin || profile?.capabilities?.can_create_users === true,
    },
  };
}

/** GET — the caller's keys (never the key itself, only its prefix). */
export async function GET() {
  const { ctx, error } = await context();
  if (error || !ctx) return error!;

  const { data } = await ctx.admin
    .from("api_keys")
    .select("id, name, key_prefix, last_used_at, expires_at, revoked_at, created_at")
    .eq("user_id", ctx.userId)
    .order("created_at", { ascending: false });

  return NextResponse.json({ canIssue: ctx.canIssue, keys: data || [] });
}

/** POST { name } — creates a key; the plaintext is returned once and never stored. */
export async function POST(request: Request) {
  const { ctx, error } = await context();
  if (error || !ctx) return error!;
  if (!ctx.canIssue) {
    return NextResponse.json({ error: "Your account can't issue API keys" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const name = String(body.name || "").trim() || "API key";

  const { count } = await ctx.admin
    .from("api_keys")
    .select("id", { count: "exact", head: true })
    .eq("user_id", ctx.userId)
    .is("revoked_at", null);
  if ((count || 0) >= 10) {
    return NextResponse.json({ error: "You already have 10 active keys — revoke one first" }, { status: 409 });
  }

  const { key, hash, prefix } = generateApiKey();
  const { data: created, error: dbError } = await ctx.admin
    .from("api_keys")
    .insert({ user_id: ctx.userId, name: name.slice(0, 60), key_prefix: prefix, key_hash: hash })
    .select("id, name, key_prefix, created_at")
    .single();
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

  await logActivity({
    supabase: ctx.admin,
    userId: ctx.userId,
    action: "create",
    entityType: "api_key",
    entityId: created.id,
    entityName: name,
    details: { prefix },
  });

  return NextResponse.json({ key, apiKey: created }, { status: 201 });
}

/** DELETE ?id= — revokes a key (kept as a record instead of deleted). */
export async function DELETE(request: Request) {
  const { ctx, error } = await context();
  if (error || !ctx) return error!;

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing ?id=" }, { status: 400 });

  const { data: key } = await ctx.admin.from("api_keys").select("id, name, user_id").eq("id", id).maybeSingle();
  if (!key || key.user_id !== ctx.userId) {
    return NextResponse.json({ error: "Key not found" }, { status: 404 });
  }

  await ctx.admin.from("api_keys").update({ revoked_at: new Date().toISOString() }).eq("id", id);

  await logActivity({
    supabase: ctx.admin,
    userId: ctx.userId,
    action: "delete",
    entityType: "api_key",
    entityId: id,
    entityName: key.name,
    details: {},
  });

  return NextResponse.json({ revoked: true });
}
