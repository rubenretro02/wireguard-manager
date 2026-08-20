import type { TimeUnit } from "@/lib/types";

/** Convierte value + unit a horas. Meses = 30 días, años = 365 días. */
export function convertToHours(value: number, unit: TimeUnit): number {
  switch (unit) {
    case "seconds": return value / 3600;
    case "minutes": return value / 60;
    case "hours": return value;
    case "days": return value * 24;
    case "weeks": return value * 24 * 7;
    case "months": return value * 24 * 30;
    case "years": return value * 24 * 365;
    default: return value;
  }
}

/**
 * Tiempo restante hasta `expiresAt`, compacto: "45s" / "12m" / "3h 20m" / "2d 23h".
 * Devuelve "Expired" si ya pasó y null si no hay fecha.
 *
 * Es la fuente única del formato del timer: la usan el dashboard y el panel de
 * Telegram para que el mismo peer muestre exactamente lo mismo en los dos lados.
 */
export function formatTimeRemaining(expiresAt: string | null | undefined): string | null {
  if (!expiresAt) return null;
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (Number.isNaN(diff)) return null;
  if (diff <= 0) return "Expired";

  if (diff < 60_000) return `${Math.round(diff / 1000)}s`;
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m`;
  if (diff < 86_400_000) {
    return `${Math.floor(diff / 3_600_000)}h ${Math.floor((diff % 3_600_000) / 60_000)}m`;
  }
  const days = Math.floor(diff / 86_400_000);
  const hours = Math.floor((diff % 86_400_000) / 3_600_000);
  return `${days}d${hours > 0 ? ` ${hours}h` : ""}`;
}

/** Convierte value + unit a milisegundos. Meses = 30 días, años = 365 días. */
export function convertToMilliseconds(value: number, unit: TimeUnit): number {
  switch (unit) {
    case "seconds": return value * 1000;
    case "minutes": return value * 60 * 1000;
    case "hours": return value * 60 * 60 * 1000;
    case "days": return value * 24 * 60 * 60 * 1000;
    case "weeks": return value * 7 * 24 * 60 * 60 * 1000;
    case "months": return value * 30 * 24 * 60 * 60 * 1000;
    case "years": return value * 365 * 24 * 60 * 60 * 1000;
    default: return value * 60 * 60 * 1000;
  }
}
