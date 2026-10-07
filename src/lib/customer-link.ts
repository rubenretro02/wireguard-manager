/**
 * Link a manual customer (no Telegram) to a Telegram account through a
 * one-time token the admin sends them: t.me/<bot>?start=clink_<token>.
 * Same shape as the admin link in admin-tg-auth.ts, on tg_customers.
 */
import crypto from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServiceClient, type TgCustomer } from "@/lib/tg-store";
import type { TelegramUser } from "@/lib/telegram";

// The admin sends the link and the customer opens it whenever: a week is enough
const LINK_TTL_SECONDS = 7 * 24 * 3600;

export async function issueCustomerLinkToken(
  customerId: string,
  supabase: SupabaseClient = getServiceClient()
): Promise<{ token: string; expiresAt: string }> {
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + LINK_TTL_SECONDS * 1000).toISOString();
  const { error } = await supabase
    .from("tg_customer_link_tokens")
    .insert({ token, customer_id: customerId, expires_at: expiresAt });
  if (error) throw new Error(`issueCustomerLinkToken failed: ${error.message}`);
  return { token, expiresAt };
}

/** Atomic claim: marks used_at only if unused and not expired. */
export async function consumeCustomerLinkToken(
  token: string,
  supabase: SupabaseClient = getServiceClient()
): Promise<{ customer_id: string } | null> {
  if (!token) return null;
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from("tg_customer_link_tokens")
    .update({ used_at: nowIso })
    .eq("token", token)
    .is("used_at", null)
    .gt("expires_at", nowIso)
    .select("customer_id")
    .maybeSingle();
  if (error) {
    console.error("[CustomerLink] consume error:", error.message);
    return null;
  }
  return data || null;
}

/**
 * Attaches a Telegram account to the manual customer. If that Telegram already
 * has a store account (the customer registered through the bot before), the
 * manual row is MERGED into it — peers and payments move over, contact fields
 * fill the gaps, the manual row goes away — so nothing is ever duplicated.
 * Returns the id of the customer that ends up holding everything.
 */
export async function linkTelegramToCustomer(
  customerId: string,
  tg: TelegramUser,
  supabase: SupabaseClient = getServiceClient()
): Promise<{ ok: true; customerId: string; merged: boolean } | { ok: false; reason: string }> {
  const { data: manual } = await supabase.from("tg_customers").select("*").eq("id", customerId).maybeSingle();
  if (!manual) return { ok: false, reason: "This customer no longer exists." };
  const target = manual as TgCustomer;

  if (target.telegram_id && target.telegram_id !== tg.id) {
    return { ok: false, reason: "This customer is already linked to another Telegram account." };
  }

  const tgFields = {
    username: tg.username || null,
    photo_url: tg.photo_url || null,
    language_code: tg.language_code || null,
    last_seen_at: new Date().toISOString(),
  };
  // The panel's own label for this customer (v36). Older manual rows kept it in first/last.
  const manualName = target.name || [target.first_name, target.last_name].filter(Boolean).join(" ").trim() || null;

  const { data: existing } = await supabase
    .from("tg_customers")
    .select("*")
    .eq("telegram_id", tg.id)
    .neq("id", customerId)
    .maybeSingle();

  if (existing) {
    const keep = existing as TgCustomer;
    await supabase.from("tg_customer_peers").update({ customer_id: keep.id }).eq("customer_id", customerId);
    await supabase.from("tg_payments").update({ customer_id: keep.id }).eq("customer_id", customerId);
    await supabase
      .from("tg_customers")
      .update({
        ...tgFields,
        // Our label survives the merge; first/last stay Telegram's
        name: keep.name || manualName,
        email: keep.email || target.email,
        phone: keep.phone || target.phone,
        notes: [keep.notes, target.notes].filter(Boolean).join("\n") || null,
        first_name: keep.first_name || tg.first_name || null,
        last_name: keep.last_name || tg.last_name || null,
      })
      .eq("id", keep.id);
    await supabase.from("tg_customers").delete().eq("id", customerId);
    return { ok: true, customerId: keep.id, merged: true };
  }

  const { error } = await supabase
    .from("tg_customers")
    .update({
      telegram_id: tg.id,
      ...tgFields,
      // The admin's label is kept in `name`; first/last become Telegram's (the Mini App
      // login rewrites them anyway)
      name: manualName,
      first_name: tg.first_name || null,
      last_name: tg.last_name || null,
    })
    .eq("id", customerId);
  if (error) return { ok: false, reason: `Could not link: ${error.message}` };
  return { ok: true, customerId, merged: false };
}
