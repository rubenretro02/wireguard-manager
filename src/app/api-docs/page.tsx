"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { DashboardLayout, PageHeader, PageContent } from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Profile } from "@/lib/types";

interface Endpoint {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  description: string;
  body?: string;
  needs?: string;
}

const GROUPS: Array<{ title: string; description: string; endpoints: Endpoint[] }> = [
  {
    title: "Servers and IPs",
    description: "What your account can use.",
    endpoints: [
      { method: "GET", path: "/api/v1/servers", description: "Servers you have access to." },
      { method: "GET", path: "/api/v1/ips?server={id}", description: "Public IPs you may create peers on." },
    ],
  },
  {
    title: "Peers",
    description: "Create and manage VPN peers. New peers use your endpoint domain automatically.",
    endpoints: [
      { method: "GET", path: "/api/v1/peers?server={id}", description: "Your peers on that server, with live status." },
      {
        method: "POST",
        path: "/api/v1/peers",
        description: "Creates a peer and returns its ready-to-use .conf.",
        body: `{ "server": "<server id>", "name": "Client 1", "publicIpId": "<ip id>" }`,
      },
      { method: "GET", path: "/api/v1/peers/{id}", description: "One peer." },
      { method: "GET", path: "/api/v1/peers/{id}/config", description: "Its config. Add ?format=text to download the file." },
      { method: "POST", path: "/api/v1/peers/{id}/enable", description: "Puts the peer back on the server." },
      { method: "POST", path: "/api/v1/peers/{id}/disable", description: "Removes it from the server, keeping its keys." },
      {
        method: "POST",
        path: "/api/v1/peers/{id}/expiry",
        description: "Sets the expiry timer (shared with the Telegram store).",
        body: `{ "days": 30 }  ·  { "expiresAt": "2026-12-01T00:00:00Z" }  ·  { "expiresAt": null }`,
        needs: "can_auto_expire",
      },
      { method: "DELETE", path: "/api/v1/peers/{id}", description: "Deletes the peer.", needs: "can_delete" },
    ],
  },
  {
    title: "Users",
    description: "The users under your account.",
    endpoints: [
      { method: "GET", path: "/api/v1/users", description: "Users you created.", needs: "can_create_users" },
      {
        method: "POST",
        path: "/api/v1/users",
        description: "Creates a user under you. You can only grant capabilities you hold yourself.",
        body: `{ "email": "a@b.com", "password": "…", "capabilities": { "can_delete": true }, "servers": ["<id>"] }`,
        needs: "can_create_users",
      },
      { method: "PATCH", path: "/api/v1/users/{id}", description: "Changes password, username or capabilities.", needs: "can_create_users" },
      { method: "DELETE", path: "/api/v1/users/{id}", description: "Deletes a user you created.", needs: "can_delete" },
    ],
  },
  {
    title: "SOCKS5 proxies",
    description: "Your proxies. Every change rebuilds the server config.",
    endpoints: [
      { method: "GET", path: "/api/v1/proxies?server={id}", description: "Your proxies, with credentials and traffic." },
      {
        method: "POST",
        path: "/api/v1/proxies",
        description: "Creates a proxy on one of your public IPs.",
        body: `{ "server": "<id>", "username": "u", "password": "p", "publicIp": "1.2.3.4" }`,
      },
      { method: "PATCH", path: "/api/v1/proxies/{id}", description: "Changes password, name, limit, expiry or enables/disables it." },
      { method: "DELETE", path: "/api/v1/proxies/{id}", description: "Deletes the proxy.", needs: "can_delete" },
    ],
  },
];

const METHOD_COLORS: Record<string, string> = {
  GET: "text-sky-400 border-sky-400/50",
  POST: "text-emerald-400 border-emerald-400/50",
  PATCH: "text-amber-400 border-amber-400/50",
  DELETE: "text-red-400 border-red-400/50",
};

export default function ApiDocsPage() {
  const router = useRouter();
  const supabase = createClient();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [origin, setOrigin] = useState("https://vpn.example.com");

  useEffect(() => {
    setOrigin(window.location.origin);
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }
      const { data } = await supabase.from("profiles").select("*").eq("id", user.id).single();
      if (data) setProfile(data as Profile);
    })();
  }, [supabase, router]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/login");
  };

  return (
    <DashboardLayout
      userRole={profile?.role}
      userEmail={profile?.email}
      userCapabilities={profile?.capabilities}
      onLogout={handleLogout}
    >
      <PageHeader title="API" description="Manage your account from your own systems" />
      <PageContent>
        <div className="max-w-3xl space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Getting started</CardTitle>
              <CardDescription>
                Create a key in your Profile and send it on every request. The key acts with your own
                permissions: it can do exactly what you can do in the panel, no more.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <pre className="bg-secondary/60 rounded-lg p-3 text-xs overflow-x-auto">
{`curl ${origin}/api/v1/servers \\
  -H "Authorization: Bearer wgm_live_xxxxxxxxxxxx"`}
              </pre>
              <p className="text-xs text-muted-foreground">
                Everything is JSON. Errors come back as
                <code className="mx-1 font-mono">{`{"error":{"message":"…","code":"…"}}`}</code>
                with the matching HTTP status. Limit: 120 requests per minute per key.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Create a peer end to end</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="bg-secondary/60 rounded-lg p-3 text-xs overflow-x-auto">
{`# 1. pick a server
curl ${origin}/api/v1/servers -H "Authorization: Bearer $KEY"

# 2. pick one of your public IPs on it
curl "${origin}/api/v1/ips?server=$SERVER" -H "Authorization: Bearer $KEY"

# 3. create the peer — the response already carries the .conf
curl -X POST ${origin}/api/v1/peers \\
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \\
  -d '{"server":"'$SERVER'","name":"Client 1","publicIpId":"'$IP'"}'`}
              </pre>
            </CardContent>
          </Card>

          {GROUPS.map((group) => (
            <Card key={group.title}>
              <CardHeader>
                <CardTitle className="text-lg">{group.title}</CardTitle>
                <CardDescription>{group.description}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {group.endpoints.map((e) => (
                  <div key={e.method + e.path} className="border-b border-border last:border-0 pb-3 last:pb-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className={`font-mono text-[10px] ${METHOD_COLORS[e.method]}`}>
                        {e.method}
                      </Badge>
                      <code className="font-mono text-xs">{e.path}</code>
                      {e.needs && (
                        <Badge variant="outline" className="text-[10px] text-muted-foreground">
                          needs {e.needs}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{e.description}</p>
                    {e.body && (
                      <pre className="bg-secondary/60 rounded p-2 text-[11px] mt-2 overflow-x-auto">{e.body}</pre>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      </PageContent>
    </DashboardLayout>
  );
}
