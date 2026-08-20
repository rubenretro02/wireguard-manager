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
