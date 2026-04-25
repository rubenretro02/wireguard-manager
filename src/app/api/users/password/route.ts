import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("role, capabilities").eq("id", user.id).single();
  const isAdmin = profile?.role?.toLowerCase() === "admin";
  const canCreateUsers = profile?.capabilities?.can_create_users === true;

  const { userId, newPassword } = await request.json();
  if (!userId || !newPassword) return NextResponse.json({ error: "User ID and password required" }, { status: 400 });
  if (newPassword.length < 6) return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
  if (!isAdmin && !canCreateUsers) return NextResponse.json({ error: "Permission denied" }, { status: 403 });

  if (!isAdmin && userId !== user.id) {
    const { data: targetUser } = await supabase.from("profiles").select("created_by_user_id").eq("id", userId).single();
    if (targetUser?.created_by_user_id !== user.id) return NextResponse.json({ error: "Cannot change this user's password" }, { status: 403 });
  }

  const adminClient = createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error } = await adminClient.auth.admin.updateUserById(userId, { password: newPassword });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ success: true });
}
