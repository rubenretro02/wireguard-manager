import type { SupabaseClient } from "@supabase/supabase-js";
import { convertToHours, convertToMilliseconds } from "@/lib/time-units";
import type { TimeUnit } from "@/lib/types";

/**
 * Escritor ÚNICO del timer de expiración.
 *
 * Hasta v23 había dos relojes independientes que nunca se hablaban:
 *   - peer_metadata.expires_at + auto_disable_enabled  (dashboard)
 *   - tg_customer_peers.expires_at                     (tienda Telegram)
 * Extender en un lado dejaba el otro con la fecha vieja, y el auto-disable del
 * dashboard volvía a apagar el peer al minuto. Todo cambio de fecha pasa ahora
 * por setUnifiedExpiry(), que escribe los dos lados con el MISMO valor.
 *
 * Módulo puro de DB: recibe el SupabaseClient (service role) por parámetro y no
 * importa tg-store — tg-store importa de acá, así que un import de vuelta sería
 * un ciclo.
 */

export type ExpiryMode = "set" | "extend";

export interface ExpiryDuration {
  value: number;
  unit: TimeUnit;
}

/**
 * Resuelve la fecha final.
 *   - "set":    ahora + duración (o el expiresAt explícito).
 *   - "extend": max(ahora, fecha actual) + duración — misma fórmula que
 *               renewCustomerPeer() usa desde v16, para que extender desde el
 *               dashboard y desde Telegram den exactamente el mismo resultado.
 */
export function resolveExpiry(params: {
  current?: string | null;
  mode: ExpiryMode;
  expiresAt?: string | null;
  duration?: ExpiryDuration | null;
}): string | null {
  const { current, mode, expiresAt, duration } = params;

  // Fecha explícita (o null = sacar el timer) manda sobre la duración.
  if (expiresAt !== undefined && !duration) return expiresAt;

  if (!duration || !(duration.value > 0)) return null;

  const base =
    mode === "extend"
      ? Math.max(Date.now(), current ? new Date(current).getTime() : 0)
      : Date.now();

  return new Date(base + convertToMilliseconds(duration.value, duration.unit)).toISOString();
}

export interface PeerExpiryTarget {
  routerId: string;
  publicKey: string;
}

export interface PeerExpiryIdentity {
  peerName?: string | null;
  peerInterface?: string | null;
  allowedAddress?: string | null;
  createdByEmail?: string | null;
  createdByUserId?: string | null;
}

/**
 * Escribe la misma fecha en los dos timers.
 *
 * peer_metadata: si la fila existe se hace UPDATE de SOLO los campos de timer.
 * A propósito no se usa upsert con los campos de creador — el upsert anterior
 * reescribía created_by_email/created_by_user_id con el usuario que tocaba el
 * timer, robándole la autoría al peer (y cambiando quién lo ve bajo el filtro
 * por creador del dashboard).
 *
 * tg_customer_peers: se filtra por peer_public_key solamente. peer_metadata.router_id
 * es TEXT y tg_customer_peers.router_id es UUID, y con el workflow
 * router-per-interface un mismo peer puede vivir bajo varias filas de `routers`.
 */
export async function setUnifiedExpiry(
  supabase: SupabaseClient,
  target: PeerExpiryTarget,
  expiresAt: string | null,
  options?: {
    duration?: ExpiryDuration | null;
    scheduledEnableAt?: string | null;
    identity?: PeerExpiryIdentity;
  }
): Promise<void> {
  const { routerId, publicKey } = target;
  const duration = options?.duration;

  const timerFields: Record<string, unknown> = {
    expires_at: expiresAt,
    auto_disable_enabled: expiresAt !== null,
    expiration_hours: expiresAt && duration ? convertToHours(duration.value, duration.unit) : null,
    expiration_value: expiresAt && duration ? duration.value : null,
    expiration_unit: expiresAt && duration ? duration.unit : null,
  };
  if (options?.scheduledEnableAt !== undefined) {
    timerFields.scheduled_enable_at = options.scheduledEnableAt;
  }

  // Se actualizan TODAS las filas con esa public key, no solo la de routerId:
  // con el workflow router-per-interface el mismo peer puede tener fila bajo
  // varios `routers`, y una fila olvidada con la fecha vieja seguiría apagándolo.
  const { data: existing } = await supabase
    .from("peer_metadata")
    .select("id")
    .eq("peer_public_key", publicKey);

  if (existing && existing.length > 0) {
    const { error } = await supabase
      .from("peer_metadata")
      .update(timerFields)
      .in("id", existing.map((row) => row.id));
    if (error) throw new Error(`Failed to update peer timer: ${error.message}`);
  } else {
    const identity = options?.identity || {};
    const { error } = await supabase.from("peer_metadata").insert({
      router_id: routerId,
      peer_public_key: publicKey,
      peer_name: identity.peerName ?? null,
      peer_interface: identity.peerInterface ?? null,
      allowed_address: identity.allowedAddress ?? null,
      created_by_email: identity.createdByEmail ?? null,
      created_by_user_id: identity.createdByUserId ?? null,
      ...timerFields,
    });
    if (error) throw new Error(`Failed to create peer timer: ${error.message}`);
  }

  // Espejo en la tienda. Puede no haber fila (peer que no es de Telegram): 0
  // filas afectadas no es error.
  const { error: tgError } = await supabase
    .from("tg_customer_peers")
    .update({ expires_at: expiresAt })
    .eq("peer_public_key", publicKey);
  if (tgError) throw new Error(`Failed to mirror timer to Telegram store: ${tgError.message}`);
}

/**
 * Mueve el timer de un peer a su llave nueva cuando se rota/cambia la key.
 *
 * peer_metadata está indexada por (router_id, peer_public_key): sin esto la fila
 * queda con la llave vieja, el dashboard busca por la nueva, no la encuentra y
 * el peer aparece "sin timer" (la fila vieja queda huérfana para siempre).
 */
export async function movePeerTimerToNewKey(
  supabase: SupabaseClient,
  params: { oldKey: string; newKey: string }
): Promise<void> {
  const { oldKey, newKey } = params;
  if (!oldKey || !newKey || oldKey === newKey) return;

  try {
    const { data: toMove } = await supabase
      .from("peer_metadata")
      .select("id, router_id")
      .eq("peer_public_key", oldKey);
    if (!toMove || toMove.length === 0) return;

    // UNIQUE(router_id, peer_public_key): si ya hay una fila con la llave nueva
    // en ese router, sacarla antes de mover (es basura de una rotación previa).
    const routerIds = Array.from(new Set(toMove.map((row) => row.router_id)));
    await supabase
      .from("peer_metadata")
      .delete()
      .eq("peer_public_key", newKey)
      .in("router_id", routerIds);

    const { error } = await supabase
      .from("peer_metadata")
      .update({ peer_public_key: newKey })
      .in("id", toMove.map((row) => row.id));
    if (error) throw new Error(error.message);
  } catch (err) {
    console.warn(
      "[PeerExpiry] move timer to new key failed (continuing):",
      err instanceof Error ? err.message : err
    );
  }
}

/**
 * Espejo en la dirección opuesta: una fecha que ya se escribió en
 * tg_customer_peers baja a peer_metadata. Best-effort — si falla, el peer sigue
 * con su fecha correcta en la tienda; lo peor que pasa es que el dashboard lo
 * vea desincronizado hasta el próximo cambio.
 */
export async function mirrorTgExpiryToDashboard(
  supabase: SupabaseClient,
  target: PeerExpiryTarget,
  expiresAt: string | null,
  identity?: PeerExpiryIdentity
): Promise<void> {
  try {
    await setUnifiedExpiry(supabase, target, expiresAt, { identity });
  } catch (err) {
    console.warn(
      "[PeerExpiry] mirror to peer_metadata failed (continuing):",
      err instanceof Error ? err.message : err
    );
  }
}
