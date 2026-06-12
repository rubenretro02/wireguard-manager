import { NextResponse } from "next/server";
import { authenticateTgRequest } from "@/lib/tg-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Registro/login automático: valida initData y devuelve el customer. */
export async function POST(request: Request) {
  const auth = await authenticateTgRequest(request);
  if ("error" in auth) return auth.error;
  return NextResponse.json({ customer: auth.customer });
}
