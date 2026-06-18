import { NextResponse } from "next/server";
import { authenticateTgRequest } from "@/lib/tg-auth";
import { getProfileByTelegramId } from "@/lib/admin-tg-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Registro/login automático: valida initData y devuelve el customer.
 * `isAdmin` indica que este Telegram está vinculado a un perfil del panel
 * (admin/semi-admin) — la Mini App lo usa para mandar al panel admin embebido
 * en vez de la tienda de cliente.
 */
export async function POST(request: Request) {
  const auth = await authenticateTgRequest(request);
  if ("error" in auth) return auth.error;
  const profile = await getProfileByTelegramId(auth.customer.telegram_id);
  return NextResponse.json({ customer: auth.customer, isAdmin: !!profile });
}
