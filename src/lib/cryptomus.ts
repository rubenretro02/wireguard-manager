import crypto from "crypto";

/**
 * Cryptomus payments API (https://doc.cryptomus.com/)
 *  - createInvoice(): crea un invoice y devuelve la URL de pago
 *  - verifyWebhookSign(): valida la firma `sign` de los webhooks
 *
 * Firma: MD5( base64( json_body ) + PAYMENT_API_KEY )
 * Ojo: Cryptomus firma con json_encode de PHP, que escapa "/" como "\/".
 */

const CRYPTOMUS_API_BASE = "https://api.cryptomus.com/v1";

function getMerchantId(): string {
  const id = process.env.CRYPTOMUS_MERCHANT_ID;
  if (!id) throw new Error("CRYPTOMUS_MERCHANT_ID is not configured");
  return id;
}

function getApiKey(): string {
  const key = process.env.CRYPTOMUS_PAYMENT_API_KEY;
  if (!key) throw new Error("CRYPTOMUS_PAYMENT_API_KEY is not configured");
  return key;
}

export function isCryptomusConfigured(): boolean {
  return Boolean(process.env.CRYPTOMUS_MERCHANT_ID && process.env.CRYPTOMUS_PAYMENT_API_KEY);
}

function signBody(jsonBody: string): string {
  return crypto
    .createHash("md5")
    .update(Buffer.from(jsonBody).toString("base64") + getApiKey())
    .digest("hex");
}

export interface CryptomusInvoice {
  uuid: string;
  order_id: string;
  amount: string;
  currency: string;
  url: string; // página de pago hosteada por Cryptomus
  status: string;
  expired_at?: number;
}

export async function createInvoice(params: {
  amountUsd: number;
  orderId: string;
  callbackUrl: string;
  returnUrl?: string;
  lifetimeSeconds?: number;
}): Promise<CryptomusInvoice> {
  const body = JSON.stringify({
    amount: params.amountUsd.toFixed(2),
    currency: "USD",
    order_id: params.orderId,
    url_callback: params.callbackUrl,
    url_return: params.returnUrl,
    url_success: params.returnUrl,
    lifetime: params.lifetimeSeconds ?? 3600,
  });

  const res = await fetch(`${CRYPTOMUS_API_BASE}/payment`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      merchant: getMerchantId(),
      sign: signBody(body),
    },
    body,
  });

  const json = await res.json();
  if (!res.ok || json.state !== 0 || !json.result?.url) {
    const msg = json?.message || json?.errors ? JSON.stringify(json.message || json.errors) : `HTTP ${res.status}`;
    throw new Error(`Cryptomus createInvoice failed: ${msg}`);
  }
  return json.result as CryptomusInvoice;
}

export interface CryptomusWebhookPayload {
  type: string; // "payment"
  uuid: string;
  order_id: string;
  amount: string;
  payment_amount?: string;
  payment_amount_usd?: string;
  currency: string;
  payer_currency?: string;
  network?: string;
  txid?: string;
  status: string; // paid | paid_over | wrong_amount | process | confirm_check | fail | cancel | system_fail | refund_* ...
  is_final: boolean;
  sign: string;
  [key: string]: unknown;
}

/** Estados que consideramos cobrados y disparan el fulfillment. */
export function isPaidStatus(status: string): boolean {
  return status === "paid" || status === "paid_over";
}

export function isFailedStatus(status: string): boolean {
  return ["fail", "cancel", "system_fail", "wrong_amount"].includes(status);
}

/**
 * Verifica la firma de un webhook a partir del body crudo.
 * Re-serializa sin `sign`, escapando "/" como hace json_encode de PHP.
 */
export function verifyWebhookSign(rawBody: string): CryptomusWebhookPayload | null {
  let payload: CryptomusWebhookPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return null;
  }
  const sign = payload.sign;
  if (!sign) return null;

  const { sign: _omit, ...rest } = payload;
  const jsonPhpStyle = JSON.stringify(rest).replace(/\//g, "\\/");
  const expected = signBody(jsonPhpStyle);

  const a = Buffer.from(expected);
  const b = Buffer.from(sign);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return payload;
}
