import { Loader2 } from "lucide-react";

// Feedback instantáneo mientras carga el segmento de la Mini App (Next.js
// route loading UI) — mismo loader que usa la página durante el auth, así la
// navegación nunca se ve congelada.
export default function Loading() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <Loader2 className="w-8 h-8 animate-spin text-primary" />
    </div>
  );
}
