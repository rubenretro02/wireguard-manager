"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { DashboardLayout, PageHeader, PageContent } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Send, Loader2, Copy, ExternalLink, Unlink, CheckCircle2, RefreshCw } from "lucide-react";
import type { Profile } from "@/lib/types";

export default function ProfilePage() {
  const router = useRouter();
  const supabase = createClient();

  const [profile, setProfile] = useState<Profile & { telegram_id?: number | null; telegram_username?: string | null }>();
  const [hasSocks5Access, setHasSocks5Access] = useState(false);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [unlinking, setUnlinking] = useState(false);
  const [deepLink, setDeepLink] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  const loadProfile = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push("/login"); return; }

    const { data } = await supabase.from("profiles").select("*").eq("id", user.id).single();
    if (data) setProfile(data as Profile);

    if (data?.role === "admin") {
      setHasSocks5Access(true);
    } else {
      const { data: s } = await supabase
        .from("user_socks5_server_access")
        .select("id")
        .eq("user_id", user.id)
        .limit(1);
      setHasSocks5Access(!!(s && s.length > 0));
    }
    setLoading(false);
  }, [supabase, router]);

  useEffect(() => { loadProfile(); }, [loadProfile]);

  const handleConnect = async () => {
    setGenerating(true);
    setDeepLink(null);
    setQrDataUrl(null);
    try {
      const res = await fetch("/api/profile/telegram", { method: "POST" });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || "No se pudo generar el enlace");
        return;
      }
      setDeepLink(json.deepLink);
      const qr = await QRCode.toDataURL(json.deepLink, {
        width: 240,
        margin: 1,
        color: { dark: "#000000", light: "#ffffff" },
      });
      setQrDataUrl(qr);
    } catch {
      toast.error("Error de red");
    } finally {
      setGenerating(false);
    }
  };

  const handleUnlink = async () => {
    setUnlinking(true);
    try {
      const res = await fetch("/api/profile/telegram", { method: "DELETE" });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        toast.error(json.error || "No se pudo desvincular");
        return;
      }
      toast.success("Telegram desvinculado");
      setDeepLink(null);
      setQrDataUrl(null);
      await loadProfile();
    } catch {
      toast.error("Error de red");
    } finally {
      setUnlinking(false);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/login");
  };

  const copyLink = () => {
    if (!deepLink) return;
    navigator.clipboard.writeText(deepLink);
    toast.success("Enlace copiado");
  };

  const isLinked = !!profile?.telegram_id;

  return (
    <DashboardLayout
      userRole={profile?.role}
      userEmail={profile?.email}
      userCapabilities={profile?.capabilities}
      hasSocks5Access={hasSocks5Access}
      onLogout={handleLogout}
    >
      <PageHeader title="Profile" description="Tu cuenta y acceso desde Telegram" />
      <PageContent>
        {loading ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Cargando…
          </div>
        ) : (
          <div className="max-w-2xl space-y-6">
            {/* Datos de la cuenta */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Cuenta</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Email</span>
                  <span className="font-medium">{profile?.email}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Rol</span>
                  <span className="font-medium capitalize">{profile?.role}</span>
                </div>
              </CardContent>
            </Card>

            {/* Acceso por Telegram */}
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Send className="w-4 h-4 text-primary" />
                  </div>
                  <div>
                    <CardTitle className="text-lg">Acceso desde Telegram</CardTitle>
                    <CardDescription>
                      Entrá al panel desde el bot sin escribir contraseña.
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {isLinked ? (
                  <>
                    <div className="flex items-center gap-2 rounded-lg border border-border bg-secondary/40 p-3">
                      <CheckCircle2 className="w-5 h-5 text-green-500" />
                      <div className="text-sm">
                        <span className="font-medium">Telegram vinculado</span>
                        {profile?.telegram_username && (
                          <span className="text-muted-foreground"> · @{profile.telegram_username}</span>
                        )}
                      </div>
                    </div>
                    <div className="text-sm text-muted-foreground">
                      En el bot escribí <Badge variant="secondary">/admin</Badge> para recibir un enlace
                      de acceso, o usá el botón <span className="font-medium">🖥 Panel admin</span>.
                    </div>
                    <Button variant="destructive" onClick={handleUnlink} disabled={unlinking}>
                      {unlinking ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Unlink className="w-4 h-4 mr-2" />}
                      Desvincular Telegram
                    </Button>
                  </>
                ) : (
                  <>
                    {!deepLink ? (
                      <Button onClick={handleConnect} disabled={generating}>
                        {generating ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Send className="w-4 h-4 mr-2" />}
                        Conectar Telegram
                      </Button>
                    ) : (
                      <div className="space-y-4">
                        <p className="text-sm text-muted-foreground">
                          Abrí este enlace en Telegram (o escaneá el QR desde tu teléfono) y enviá el
                          mensaje para vincular tu cuenta. El enlace vence en 10 minutos.
                        </p>
                        {qrDataUrl && (
                          <img
                            src={qrDataUrl}
                            alt="QR de vinculación"
                            className="rounded-lg border border-border bg-white p-2"
                            width={240}
                            height={240}
                          />
                        )}
                        <div className="flex flex-wrap gap-2">
                          <Button asChild>
                            <a href={deepLink} target="_blank" rel="noopener noreferrer">
                              <ExternalLink className="w-4 h-4 mr-2" /> Abrir Telegram
                            </a>
                          </Button>
                          <Button variant="secondary" onClick={copyLink}>
                            <Copy className="w-4 h-4 mr-2" /> Copiar enlace
                          </Button>
                          <Button variant="outline" onClick={loadProfile}>
                            <RefreshCw className="w-4 h-4 mr-2" /> Ya vinculé
                          </Button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </PageContent>
    </DashboardLayout>
  );
}
