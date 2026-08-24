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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Send, Loader2, Copy, ExternalLink, Unlink, CheckCircle2, RefreshCw, Globe } from "lucide-react";
import type { Profile } from "@/lib/types";

interface DomainRecord {
  routerId: string;
  routerName: string;
  slug: string;
  host: string | null;
  target: string;
}

interface DomainsPayload {
  canConfigure: boolean;
  panelDomain: string | null;
  endpointDomain: string | null;
  brandName: string | null;
  records: DomainRecord[];
}

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

  // White-label domains
  const [domains, setDomains] = useState<DomainsPayload | null>(null);
  const [panelDomain, setPanelDomain] = useState("");
  const [endpointDomain, setEndpointDomain] = useState("");
  const [brandName, setBrandName] = useState("");
  const [savingDomains, setSavingDomains] = useState(false);
  const [checkingDns, setCheckingDns] = useState(false);
  const [dnsResults, setDnsResults] = useState<Record<string, { ips: string[] }>>({});

  const loadDomains = useCallback(async () => {
    try {
      const res = await fetch("/api/profile/domains");
      if (!res.ok) return;
      const data: DomainsPayload = await res.json();
      setDomains(data);
      setPanelDomain(data.panelDomain || "");
      setEndpointDomain(data.endpointDomain || "");
      setBrandName(data.brandName || "");
    } catch {
      // domains are optional — never block the profile page
    }
  }, []);

  const saveDomains = async () => {
    setSavingDomains(true);
    try {
      const res = await fetch("/api/profile/domains", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ panelDomain, endpointDomain, brandName }),
      });
      const json = await res.json();
      if (res.ok) {
        toast.success("Domains saved");
        setDnsResults({});
        await loadDomains();
      } else {
        toast.error(json.error || "Couldn't save");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setSavingDomains(false);
    }
  };

  const checkDns = async () => {
    if (!domains) return;
    setCheckingDns(true);
    const results: Record<string, { ips: string[] }> = {};
    for (const record of domains.records) {
      if (!record.host) continue;
      try {
        const res = await fetch("/api/profile/domains", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "check", host: record.host }),
        });
        const json = await res.json();
        results[record.host] = { ips: json.ips || [] };
      } catch {
        results[record.host] = { ips: [] };
      }
    }
    setDnsResults(results);
    setCheckingDns(false);
  };

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

  useEffect(() => { loadProfile(); loadDomains(); }, [loadProfile, loadDomains]);

  const handleConnect = async () => {
    setGenerating(true);
    setDeepLink(null);
    setQrDataUrl(null);
    try {
      const res = await fetch("/api/profile/telegram", { method: "POST" });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || "Couldn't generate the link");
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
      toast.error("Network error");
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
        toast.error(json.error || "Couldn't unlink");
        return;
      }
      toast.success("Telegram unlinked");
      setDeepLink(null);
      setQrDataUrl(null);
      await loadProfile();
    } catch {
      toast.error("Network error");
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
    toast.success("Link copied");
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
      <PageHeader title="Profile" description="Your account and Telegram access" />
      <PageContent>
        {loading ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…
          </div>
        ) : (
          <div className="max-w-2xl space-y-6">
            {/* Account details */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Account</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Email</span>
                  <span className="font-medium">{profile?.email}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Role</span>
                  <span className="font-medium capitalize">{profile?.role}</span>
                </div>
              </CardContent>
            </Card>

            {/* White-label domains (admins and semi-admins) */}
            {domains?.canConfigure && (
              <Card>
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                      <Globe className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                      <CardTitle className="text-lg">Your domains</CardTitle>
                      <CardDescription>
                        Use your own brand: your panel URL and the endpoint domain of every peer you
                        (or your users) create.
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div className="space-y-2">
                    <Label htmlFor="panel-domain">Panel domain</Label>
                    <Input
                      id="panel-domain"
                      placeholder="vpn.yourbrand.com"
                      value={panelDomain}
                      onChange={(e) => setPanelDomain(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      Point a CNAME to this panel and your users sign in on your own address.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="endpoint-domain">Endpoint domain</Label>
                    <Input
                      id="endpoint-domain"
                      placeholder="zone.yourbrand.com"
                      value={endpointDomain}
                      onChange={(e) => setEndpointDomain(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      Base domain for the peers you create. Each server gets its own name under it
                      (a hostname can only answer with one IP), so create one A record per server.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="brand-name">Brand name</Label>
                    <Input
                      id="brand-name"
                      placeholder="HomeVPN"
                      value={brandName}
                      onChange={(e) => setBrandName(e.target.value)}
                    />
                  </div>

                  <Button onClick={saveDomains} disabled={savingDomains} className="gap-2">
                    {savingDomains ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                    Save domains
                  </Button>

                  {domains.records.length > 0 && (
                    <div className="space-y-2 pt-2 border-t border-border">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium">DNS records to create</p>
                        <Button variant="outline" size="sm" onClick={checkDns} disabled={checkingDns} className="gap-2">
                          <RefreshCw className={`w-3.5 h-3.5 ${checkingDns ? "animate-spin" : ""}`} />
                          Check DNS
                        </Button>
                      </div>
                      <div className="rounded-lg border border-border overflow-hidden">
                        {domains.records.map((r) => {
                          const check = dnsResults[r.host!];
                          const ok = check?.ips?.includes(r.target);
                          return (
                            <div
                              key={r.routerId}
                              className="flex items-center justify-between gap-3 px-3 py-2 border-b border-border last:border-0 text-xs"
                            >
                              <div className="min-w-0">
                                <div className="font-mono truncate">{r.host}</div>
                                <div className="text-muted-foreground">{r.routerName}</div>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <Badge variant="outline" className="font-mono">A → {r.target}</Badge>
                                {check && (
                                  ok ? (
                                    <span className="text-green-500 flex items-center gap-1">
                                      <CheckCircle2 className="w-3.5 h-3.5" /> OK
                                    </span>
                                  ) : (
                                    <span className="text-amber-400" title={check.ips?.join(", ") || "no answer"}>
                                      {check.ips?.length ? `→ ${check.ips[0]}` : "not found"}
                                    </span>
                                  )
                                )}
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6"
                                  onClick={() => { navigator.clipboard.writeText(r.host!); toast.success("Copied"); }}
                                >
                                  <Copy className="w-3.5 h-3.5" />
                                </Button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Peers already handed out keep working — the domain only applies to configs
                        downloaded from now on.
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Telegram access */}
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Send className="w-4 h-4 text-primary" />
                  </div>
                  <div>
                    <CardTitle className="text-lg">Telegram access</CardTitle>
                    <CardDescription>
                      Sign in to the panel from the bot without typing a password.
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
                        <span className="font-medium">Telegram linked</span>
                        {profile?.telegram_username && (
                          <span className="text-muted-foreground"> · @{profile.telegram_username}</span>
                        )}
                      </div>
                    </div>
                    <div className="text-sm text-muted-foreground">
                      In the bot, send <Badge variant="secondary">/admin</Badge> to get an access link,
                      or use the <span className="font-medium">🖥 Admin Panel</span> button.
                    </div>
                    <Button variant="destructive" onClick={handleUnlink} disabled={unlinking}>
                      {unlinking ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Unlink className="w-4 h-4 mr-2" />}
                      Unlink Telegram
                    </Button>
                  </>
                ) : (
                  <>
                    {!deepLink ? (
                      <Button onClick={handleConnect} disabled={generating}>
                        {generating ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Send className="w-4 h-4 mr-2" />}
                        Connect Telegram
                      </Button>
                    ) : (
                      <div className="space-y-4">
                        <p className="text-sm text-muted-foreground">
                          Open this link in Telegram (or scan the QR from your phone) and send the
                          message to link your account. The link expires in 10 minutes.
                        </p>
                        {qrDataUrl && (
                          <img
                            src={qrDataUrl}
                            alt="Linking QR"
                            className="rounded-lg border border-border bg-white p-2"
                            width={240}
                            height={240}
                          />
                        )}
                        <div className="flex flex-wrap gap-2">
                          <Button asChild>
                            <a href={deepLink} target="_blank" rel="noopener noreferrer">
                              <ExternalLink className="w-4 h-4 mr-2" /> Open Telegram
                            </a>
                          </Button>
                          <Button variant="secondary" onClick={copyLink}>
                            <Copy className="w-4 h-4 mr-2" /> Copy link
                          </Button>
                          <Button variant="outline" onClick={loadProfile}>
                            <RefreshCw className="w-4 h-4 mr-2" /> I've linked it
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
