"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  Settings,
  Globe,
  Users,
  Server,
  Trash2,
  Plus,
  Check,
  X,
  Shield,
  Network,
  RefreshCw,
  Download,
  CheckCircle,
  AlertCircle,
  Zap,
  Activity,
  Search,
  UserCheck
} from "lucide-react";
import type { Profile, Router, ConnectionType, UserRole, PublicIP, UserRouter, WireGuardInterface } from "@/lib/types";

interface UserRouterWithRelations extends UserRouter {
  profiles: { id: string; email: string; username: string | null } | null;
  routers: { id: string; name: string } | null;
}

interface DetectedIp {
  ip_number: number;
  public_ip: string;
  internal_subnet: string;
  has_nat_rule: boolean;
  has_ip_address: boolean;
  has_wg_ip: boolean;
  nat_rule_id?: string;
  ip_address_id?: string;
  wg_ip_id?: string;
  nat_bytes?: number;
  nat_packets?: number;
}

interface NatTraffic {
  ip_number: number;
  public_ip: string;
  internal_subnet: string;
  bytes: number;
  packets: number;
  nat_rule_id: string;
}

export default function AdminPage() {
  const router = useRouter();
  const supabase = createClient();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [routers, setRouters] = useState<Router[]>([]);
  const [users, setUsers] = useState<Profile[]>([]);
  const [publicIps, setPublicIps] = useState<PublicIP[]>([]);
  const [userRouters, setUserRouters] = useState<UserRouterWithRelations[]>([]);
  const [loading, setLoading] = useState(true);

  // Router states
  const [addRouterOpen, setAddRouterOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [editingRouter, setEditingRouter] = useState<Router | null>(null);
  const [editRouterOpen, setEditRouterOpen] = useState(false);
  const [wgInterfaces, setWgInterfaces] = useState<WireGuardInterface[]>([]);
  const [loadingInterfaces, setLoadingInterfaces] = useState(false);
  const [newRouter, setNewRouter] = useState({
    name: "",
    host: "",
    port: "443",
    api_port: "8728",
    username: "",
    password: "",
    use_ssl: false,
    connection_type: "api" as ConnectionType,
  });

  // User states
  const [addUserOpen, setAddUserOpen] = useState(false);
  const [creatingUser, setCreatingUser] = useState(false);
  const [newUser, setNewUser] = useState({
    email: "",
    password: "",
    username: "",
    role: "user" as UserRole,
  });

  // Public IP states
  const [selectedRouterForIps, setSelectedRouterForIps] = useState<string>("");
  const [addIpOpen, setAddIpOpen] = useState(false);
  const [newIpNumber, setNewIpNumber] = useState("");
  const [addingIp, setAddingIp] = useState(false);
  const [importing, setImporting] = useState(false);
  const [savingImported, setSavingImported] = useState(false);
  const [detectedIps, setDetectedIps] = useState<DetectedIp[]>([]);
  const [partiallyConfiguredIps, setPartiallyConfiguredIps] = useState<DetectedIp[]>([]);
  const [natTraffic, setNatTraffic] = useState<Record<number, NatTraffic>>({});
  const [loadingTraffic, setLoadingTraffic] = useState(false);
  const [creatingRulesFor, setCreatingRulesFor] = useState<number | null>(null);
  const [ipSearchQuery, setIpSearchQuery] = useState("");
  const [peersByIp, setPeersByIp] = useState<Record<string, { count: number; names: string[]; peers: Array<{ id: string; name: string; address: string }> }>>({});

  // Peers detail modal
  const [peersModalOpen, setPeersModalOpen] = useState(false);
  const [selectedIpForPeers, setSelectedIpForPeers] = useState<PublicIP | null>(null);
  const [selectedIpPeers, setSelectedIpPeers] = useState<Array<{ id: string; name: string; address: string }>>([]);

  // User Router Access states
  const [addAccessOpen, setAddAccessOpen] = useState(false);
  const [newAccess, setNewAccess] = useState({ user_id: "", router_id: "" });
  const [addingAccess, setAddingAccess] = useState(false);

  const fetchData = useCallback(async () => {
    const { data: routersData } = await supabase
      .from("routers")
      .select("*")
      .order("created_at", { ascending: false });
    if (routersData) {
      setRouters(routersData as Router[]);
      if (routersData.length > 0 && !selectedRouterForIps) {
        setSelectedRouterForIps(routersData[0].id);
      }
    }

    const { data: usersData } = await supabase
      .from("profiles")
      .select("*")
      .order("created_at", { ascending: false });
    if (usersData) setUsers(usersData as Profile[]);

    const { data: userRoutersData } = await supabase
      .from("user_routers")
      .select(`
        *,
        profiles:user_id (id, email, username),
        routers:router_id (id, name)
      `)
      .order("created_at", { ascending: false });
    if (userRoutersData) setUserRouters(userRoutersData as UserRouterWithRelations[]);
  }, [supabase, selectedRouterForIps]);

  const fetchPublicIps = useCallback(async (routerId: string) => {
    if (!routerId) return;
    const res = await fetch(`/api/public-ips?routerId=${routerId}`);
    const data = await res.json();
    if (data.publicIps) setPublicIps(data.publicIps);
  }, []);

  const fetchNatTraffic = useCallback(async (routerId: string) => {
    if (!routerId) return;
    setLoadingTraffic(true);
    try {
      const res = await fetch("/api/wireguard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "getNatRuleTraffic", routerId }),
      });
      const data = await res.json();
      if (data.traffic) {
        const trafficMap: Record<number, NatTraffic> = {};
        for (const t of data.traffic) {
          trafficMap[t.ip_number] = t;
        }
        setNatTraffic(trafficMap);
      }
    } catch {
      console.error("Failed to fetch NAT traffic");
    }
    setLoadingTraffic(false);
  }, []);

  const fetchPeersByIp = useCallback(async (routerId: string) => {
    if (!routerId) return;
    try {
      const res = await fetch("/api/wireguard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "getPeers", routerId }),
      });
      const data = await res.json();
      if (data.peers) {
        const peerMap: Record<string, { count: number; names: string[]; peers: Array<{ id: string; name: string; address: string }> }> = {};
        for (const peer of data.peers) {
          const addr = peer["allowed-address"]?.split("/")[0] || "";
          const parts = addr.split(".");
          if (parts.length >= 3) {
            const subnet = `${parts[0]}.${parts[1]}.${parts[2]}`;
            if (!peerMap[subnet]) {
              peerMap[subnet] = { count: 0, names: [], peers: [] };
            }
            peerMap[subnet].count++;
            const name = peer.name || peer.comment || `Peer ${peer[".id"]}`;
            peerMap[subnet].peers.push({
              id: peer[".id"],
              name: name,
              address: peer["allowed-address"] || ""
            });
            if (peerMap[subnet].names.length < 3) {
              peerMap[subnet].names.push(name);
            }
          }
        }
        setPeersByIp(peerMap);
      }
    } catch {
      console.error("Failed to fetch peers");
    }
  }, []);

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }
      const { data: profileData } = await supabase.from("profiles").select("*").eq("id", user.id).single();
      if (!profileData || profileData.role !== "admin") { router.push("/dashboard"); return; }
      setProfile(profileData as Profile);
      await fetchData();
      setLoading(false);
    };
    checkAuth();
  }, [router, supabase, fetchData]);

  useEffect(() => {
    if (selectedRouterForIps) {
      fetchPublicIps(selectedRouterForIps);
      fetchNatTraffic(selectedRouterForIps);
      fetchPeersByIp(selectedRouterForIps);
    }
  }, [selectedRouterForIps, fetchPublicIps, fetchNatTraffic, fetchPeersByIp]);

  // Filter public IPs based on search
  const filteredPublicIps = publicIps.filter((ip) => {
    if (!ipSearchQuery.trim()) return true;
    const query = ipSearchQuery.toLowerCase().trim();
    return (
      String(ip.ip_number).includes(query) ||
      ip.public_ip.toLowerCase().includes(query) ||
      ip.internal_subnet.toLowerCase().includes(query)
    );
  });

  const handleAddRouter = async () => {
    setAdding(true);
    try {
      const res = await fetch("/api/routers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...newRouter,
          port: Number.parseInt(newRouter.port),
          api_port: Number.parseInt(newRouter.api_port),
        }),
      });
      const data = await res.json();
      if (data.router) {
        toast.success("Router added successfully");
        setAddRouterOpen(false);
        setNewRouter({
          name: "", host: "", port: "443", api_port: "8728",
          username: "", password: "", use_ssl: false, connection_type: "api",
        });
        fetchData();
      } else {
        toast.error(data.error || "Failed to add router");
      }
    } catch {
      toast.error("Failed to add router");
    }
    setAdding(false);
  };

  const handleUpdateRouter = async () => {
    if (!editingRouter) return;
    try {
      const res = await fetch("/api/routers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editingRouter),
      });
      const data = await res.json();
      if (data.success) {
        toast.success("Router updated successfully");
        setEditRouterOpen(false);
        setEditingRouter(null);
        setWgInterfaces([]);
        fetchData();
      } else {
        toast.error(data.error || "Failed to update router");
      }
    } catch {
      toast.error("Failed to update router");
    }
  };

  const fetchWgInterfaces = async (routerId: string) => {
    setLoadingInterfaces(true);
    try {
      const res = await fetch("/api/wireguard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "getInterfaces", routerId }),
      });
      const data = await res.json();
      if (data.interfaces) {
        setWgInterfaces(data.interfaces);
      }
    } catch {
      console.error("Failed to fetch WireGuard interfaces");
    }
    setLoadingInterfaces(false);
  };

  const openEditRouter = (r: Router) => {
    setEditingRouter(r);
    setEditRouterOpen(true);
    fetchWgInterfaces(r.id);
  };

  const handleDeleteRouter = async (id: string) => {
    if (!confirm("Delete this router?")) return;
    const res = await fetch(`/api/routers?id=${id}`, { method: "DELETE" });
    const data = await res.json();
    if (data.success) { toast.success("Router deleted"); fetchData(); }
    else toast.error(data.error || "Failed");
  };

  const handleTestConnection = async (routerId: string) => {
    setTestingId(routerId);
    try {
      const res = await fetch("/api/wireguard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "testConnection", routerId }),
      });
      const data = await res.json();
      if (data.connected) {
        toast.success("Connection successful!");
      } else {
        toast.error(data.error || "Connection failed");
      }
    } catch {
      toast.error("Connection test failed");
    }
    setTestingId(null);
  };

  const handleUpdateRole = async (userId: string, newRole: "admin" | "user") => {
    const { error } = await supabase.from("profiles").update({ role: newRole }).eq("id", userId);
    if (error) toast.error(error.message);
    else { toast.success("Role updated"); fetchData(); }
  };

  const handleAddUser = async () => {
    setCreatingUser(true);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newUser),
      });
      const data = await res.json();
      if (data.success) {
        toast.success("User created successfully");
        setAddUserOpen(false);
        setNewUser({ email: "", password: "", username: "", role: "user" });
        fetchData();
      } else {
        toast.error(data.error || "Failed to create user");
      }
    } catch {
      toast.error("Failed to create user");
    }
    setCreatingUser(false);
  };

  const handleDeleteUser = async (userId: string) => {
    if (!confirm("Delete this user?")) return;
    try {
      const res = await fetch(`/api/users?id=${userId}`, { method: "DELETE" });
      const data = await res.json();
      if (data.success) { toast.success("User deleted"); fetchData(); }
      else toast.error(data.error || "Failed to delete user");
    } catch {
      toast.error("Failed to delete user");
    }
  };

  const handleAddPublicIp = async () => {
    if (!selectedRouterForIps || !newIpNumber) return;
    setAddingIp(true);
    try {
      const res = await fetch("/api/public-ips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          router_id: selectedRouterForIps,
          ip_number: Number.parseInt(newIpNumber),
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`IP .${newIpNumber} added successfully`);
        setAddIpOpen(false);
        setNewIpNumber("");
        fetchPublicIps(selectedRouterForIps);
      } else {
        toast.error(data.error || "Failed to add IP");
      }
    } catch {
      toast.error("Failed to add IP");
    }
    setAddingIp(false);
  };

  const handleDeletePublicIp = async (id: string) => {
    if (!confirm("Delete this public IP?")) return;
    const res = await fetch(`/api/public-ips?id=${id}`, { method: "DELETE" });
    const data = await res.json();
    if (data.success) {
      toast.success("IP deleted");
      fetchPublicIps(selectedRouterForIps);
    } else {
      toast.error(data.error || "Failed to delete IP");
    }
  };

  const handleImportFromMikroTik = async () => {
    if (!selectedRouterForIps) return;
    setImporting(true);
    setDetectedIps([]);
    setPartiallyConfiguredIps([]);
    try {
      const res = await fetch("/api/wireguard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "importPublicIps", routerId: selectedRouterForIps }),
      });
      const data = await res.json();
      if (data.detectedIps) {
        setDetectedIps(data.detectedIps);
        setPartiallyConfiguredIps(data.partiallyConfiguredIps || []);

        if (data.detectedIps.length === 0 && (!data.partiallyConfiguredIps || data.partiallyConfiguredIps.length === 0)) {
          toast.info("No new public IPs detected in MikroTik");
        } else {
          const fullyCount = data.detectedIps.length;
          const partialCount = data.partiallyConfiguredIps?.length || 0;
          const savedCount = data.alreadySavedCount || 0;

          let message = "";
          if (fullyCount > 0) message += `${fullyCount} fully configured`;
          if (partialCount > 0) message += `${message ? ", " : ""}${partialCount} partial`;
          if (savedCount > 0) message += `${message ? ", " : ""}${savedCount} already saved`;

          toast.success(`Detected: ${message}`);
        }
      } else {
        toast.error(data.error || "Failed to import");
      }
    } catch {
      toast.error("Failed to import from MikroTik");
    }
    setImporting(false);
  };

  const handleSaveAllDetectedIps = async () => {
    if (detectedIps.length === 0) return;
    setSavingImported(true);
    try {
      const res = await fetch("/api/wireguard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "saveImportedIps",
          routerId: selectedRouterForIps,
          data: { ips: detectedIps }
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`Saved ${data.savedCount} IPs to database`);
        setDetectedIps([]);
        fetchPublicIps(selectedRouterForIps);
      } else {
        toast.error(data.error || "Failed to save IPs");
      }
    } catch {
      toast.error("Failed to save IPs");
    }
    setSavingImported(false);
  };

  const handleSaveDetectedIp = async (ip: DetectedIp) => {
    try {
      const res = await fetch("/api/wireguard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "saveImportedIps",
          routerId: selectedRouterForIps,
          data: { ips: [ip] }
        }),
      });
      const data = await res.json();
      if (data.success && data.savedCount > 0) {
        toast.success(`Saved ${ip.public_ip}`);
        setDetectedIps(prev => prev.filter(d => d.ip_number !== ip.ip_number));
        fetchPublicIps(selectedRouterForIps);
      } else {
        toast.error(data.error || "Failed to save IP");
      }
    } catch {
      toast.error("Failed to save IP");
    }
  };

  const handleCreateMikroTikRules = async (ipNumber: number) => {
    setCreatingRulesFor(ipNumber);
    try {
      const res = await fetch("/api/wireguard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "createMikroTikRules",
          routerId: selectedRouterForIps,
          data: { ip_number: ipNumber }
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success("Rules created successfully in MikroTik");
        fetchPublicIps(selectedRouterForIps);
        fetchNatTraffic(selectedRouterForIps);
      } else {
        const errors = data.errors?.join(", ") || "Unknown error";
        toast.error(`Failed to create some rules: ${errors}`);
        fetchPublicIps(selectedRouterForIps);
      }
    } catch {
      toast.error("Failed to create MikroTik rules");
    }
    setCreatingRulesFor(null);
  };

  const formatBytes = (bytes?: number) => {
    if (!bytes || bytes === 0) return "0 B";
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / 1024 ** i).toFixed(1)} ${sizes[i]}`;
  };

  const handleTogglePublicIp = async (ip: PublicIP) => {
    const res = await fetch("/api/public-ips", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: ip.id, enabled: !ip.enabled }),
    });
    const data = await res.json();
    if (data.success) {
      toast.success(ip.enabled ? "IP disabled" : "IP enabled");
      fetchPublicIps(selectedRouterForIps);
    } else {
      toast.error(data.error || "Failed to update IP");
    }
  };

  const handleAddAccess = async () => {
    if (!newAccess.user_id || !newAccess.router_id) return;
    setAddingAccess(true);
    try {
      const res = await fetch("/api/user-routers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newAccess),
      });
      const data = await res.json();
      if (data.success) {
        toast.success("Access granted");
        setAddAccessOpen(false);
        setNewAccess({ user_id: "", router_id: "" });
        fetchData();
      } else {
        toast.error(data.error || "Failed to grant access");
      }
    } catch {
      toast.error("Failed to grant access");
    }
    setAddingAccess(false);
  };

  const handleDeleteAccess = async (id: string) => {
    if (!confirm("Remove this access?")) return;
    const res = await fetch(`/api/user-routers?id=${id}`, { method: "DELETE" });
    const data = await res.json();
    if (data.success) { toast.success("Access removed"); fetchData(); }
    else toast.error(data.error || "Failed to remove access");
  };

  const selectedRouter = routers.find(r => r.id === selectedRouterForIps);

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="animate-spin w-8 h-8 border-2 border-muted-foreground border-t-foreground rounded-full" />
    </div>
  );

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 bg-emerald-500/10 rounded-lg flex items-center justify-center">
              <Shield className="w-5 h-5 text-emerald-500" />
            </div>
            <h1 className="text-xl font-semibold">Admin Panel</h1>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-muted-foreground text-sm">
              {profile?.email} <Badge variant="destructive">admin</Badge>
            </span>
            <Button variant="ghost" onClick={() => router.push("/dashboard")}>Dashboard</Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <Tabs defaultValue="routers">
          <TabsList className="mb-6 bg-secondary">
            <TabsTrigger value="routers" className="gap-2">
              <Server className="w-4 h-4" /> Routers
            </TabsTrigger>
            <TabsTrigger value="ips" className="gap-2">
              <Globe className="w-4 h-4" /> Public IPs
            </TabsTrigger>
            <TabsTrigger value="access" className="gap-2">
              <Shield className="w-4 h-4" /> Access Control
            </TabsTrigger>
            <TabsTrigger value="users" className="gap-2">
              <Users className="w-4 h-4" /> Users
            </TabsTrigger>
          </TabsList>

          {/* ROUTERS TAB */}
          <TabsContent value="routers">
            <Card className="bg-card border-border">
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>MikroTik Routers</CardTitle>
                  <CardDescription>Manage your MikroTik routers and IP configuration</CardDescription>
                </div>
                <Dialog open={addRouterOpen} onOpenChange={setAddRouterOpen}>
                  <DialogTrigger asChild>
                    <Button className="gap-2"><Plus className="w-4 h-4" /> Add Router</Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-md bg-card border-border">
                    <DialogHeader>
                      <DialogTitle>Add Router</DialogTitle>
                      <DialogDescription>Connect a new MikroTik router (RouterOS v7+)</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                      <div className="space-y-2">
                        <Label>Name</Label>
                        <Input placeholder="Office Router" value={newRouter.name} onChange={(e) => setNewRouter({ ...newRouter, name: e.target.value })} className="bg-secondary border-border" />
                      </div>
                      <div className="space-y-2">
                        <Label>Host</Label>
                        <Input placeholder="192.168.1.1" value={newRouter.host} onChange={(e) => setNewRouter({ ...newRouter, host: e.target.value })} className="bg-secondary border-border" />
                      </div>
                      <div className="space-y-2">
                        <Label>Connection Type</Label>
                        <Select value={newRouter.connection_type} onValueChange={(v: ConnectionType) => {
                          const updates: Partial<typeof newRouter> = { connection_type: v };
                          // Set default ports based on connection type
                          if (v === "api") updates.api_port = "8728";
                          else if (v === "api-ssl") updates.api_port = "8729";
                          else if (v === "rest") updates.port = "443";
                          else if (v === "rest-8443") updates.port = "8443";
                          setNewRouter({ ...newRouter, ...updates });
                        }}>
                          <SelectTrigger className="bg-secondary border-border"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="api">API (Port 8728)</SelectItem>
                            <SelectItem value="api-ssl">API-SSL (Port 8729)</SelectItem>
                            <SelectItem value="rest">REST API (HTTPS 443)</SelectItem>
                            <SelectItem value="rest-8443">REST API (HTTPS 8443)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      {(newRouter.connection_type === "api" || newRouter.connection_type === "api-ssl") ? (
                        <div className="space-y-2">
                          <Label>API Port</Label>
                          <Input type="number" value={newRouter.api_port} onChange={(e) => setNewRouter({ ...newRouter, api_port: e.target.value })} className="bg-secondary border-border" />
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <Label>HTTPS Port</Label>
                          <Input type="number" value={newRouter.port} onChange={(e) => setNewRouter({ ...newRouter, port: e.target.value })} className="bg-secondary border-border" />
                        </div>
                      )}
                      <div className="space-y-2">
                        <Label>Username</Label>
                        <Input placeholder="admin" value={newRouter.username} onChange={(e) => setNewRouter({ ...newRouter, username: e.target.value })} className="bg-secondary border-border" />
                      </div>
                      <div className="space-y-2">
                        <Label>Password</Label>
                        <Input type="password" value={newRouter.password} onChange={(e) => setNewRouter({ ...newRouter, password: e.target.value })} className="bg-secondary border-border" />
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setAddRouterOpen(false)}>Cancel</Button>
                      <Button onClick={handleAddRouter} disabled={adding || !newRouter.name || !newRouter.host || !newRouter.username || !newRouter.password}>
                        {adding ? "Adding..." : "Add Router"}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </CardHeader>
              <CardContent>
                {routers.length === 0 ? (
                  <p className="text-muted-foreground text-center py-8">No routers configured.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className="border-border">
                        <TableHead>Name</TableHead>
                        <TableHead>Host</TableHead>
                        <TableHead>Connection</TableHead>
                        <TableHead>IP Config</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {routers.map((r) => (
                        <TableRow key={r.id} className="border-border">
                          <TableCell className="font-medium">{r.name}</TableCell>
                          <TableCell className="font-mono text-sm text-muted-foreground">{r.host}</TableCell>
                          <TableCell>
                            <Badge variant={(r.connection_type === "api" || r.connection_type === "api-ssl") ? "default" : "secondary"}>
                              {r.connection_type === "api" ? `API:${r.api_port || 8728}` :
                               r.connection_type === "api-ssl" ? `API-SSL:${r.api_port || 8729}` :
                               r.connection_type === "rest-8443" ? `REST:${r.port || 8443}` :
                               `REST:${r.port || 443}`}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {r.public_ip_prefix ? (
                              <div className="text-xs space-y-0.5">
                                <div className="text-emerald-400">{r.public_ip_prefix}.x{r.public_ip_mask}</div>
                                <div className="text-muted-foreground">{r.internal_prefix}.x.0/24</div>
                              </div>
                            ) : (
                              <span className="text-amber-400 text-xs">Not configured</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => openEditRouter(r)}
                                title="Configure"
                              >
                                <Settings className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleTestConnection(r.id)}
                                disabled={testingId === r.id}
                              >
                                {testingId === r.id ? "Testing..." : "Test"}
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="text-destructive"
                                onClick={() => handleDeleteRouter(r.id)}
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* PUBLIC IPS TAB */}
          <TabsContent value="ips">
            <Card className="bg-card border-border">
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>Public IPs Configuration</CardTitle>
                  <CardDescription>Manage public IPs for each router. IPs must have WG internal IP + Public IP + NAT rule.</CardDescription>
                </div>
                <div className="flex items-center gap-3 flex-wrap">
                  <Select value={selectedRouterForIps} onValueChange={(v) => { setSelectedRouterForIps(v); setDetectedIps([]); setPartiallyConfiguredIps([]); setIpSearchQuery(""); }}>
                    <SelectTrigger className="w-[200px] bg-secondary border-border">
                      <Server className="w-4 h-4 mr-2" />
                      <SelectValue placeholder="Select router" />
                    </SelectTrigger>
                    <SelectContent>
                      {routers.map((r) => (
                        <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => fetchNatTraffic(selectedRouterForIps)}
                    disabled={!selectedRouterForIps || loadingTraffic}
                    title="Refresh NAT Traffic"
                  >
                    <Activity className={`w-4 h-4 ${loadingTraffic ? "animate-pulse" : ""}`} />
                  </Button>
                  <Button
                    variant="outline"
                    className="gap-2"
                    onClick={handleImportFromMikroTik}
                    disabled={!selectedRouterForIps || importing}
                  >
                    <RefreshCw className={`w-4 h-4 ${importing ? "animate-spin" : ""}`} />
                    {importing ? "Scanning..." : "Scan MikroTik"}
                  </Button>
                  <Dialog open={addIpOpen} onOpenChange={setAddIpOpen}>
                    <DialogTrigger asChild>
                      <Button className="gap-2" disabled={!selectedRouter?.public_ip_prefix}>
                        <Plus className="w-4 h-4" /> Add IP
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-sm bg-card border-border">
                      <DialogHeader>
                        <DialogTitle>Add Public IP</DialogTitle>
                        <DialogDescription>
                          Enter the last octet of the public IP
                        </DialogDescription>
                      </DialogHeader>
                      <div className="py-4">
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground font-mono">
                            {selectedRouter?.public_ip_prefix}.
                          </span>
                          <Input
                            type="number"
                            min="1"
                            max="254"
                            placeholder="200"
                            value={newIpNumber}
                            onChange={(e) => setNewIpNumber(e.target.value)}
                            className="w-24 bg-secondary border-border font-mono"
                          />
                        </div>
                        {newIpNumber && selectedRouter && (
                          <div className="mt-4 p-3 bg-secondary rounded-lg text-sm space-y-1">
                            <p><span className="text-muted-foreground">Public IP:</span> <span className="text-emerald-400 font-mono">{selectedRouter.public_ip_prefix}.{newIpNumber}{selectedRouter.public_ip_mask}</span></p>
                            <p><span className="text-muted-foreground">Internal Subnet:</span> <span className="text-cyan-400 font-mono">{selectedRouter.internal_prefix}.{newIpNumber}.0/24</span></p>
                          </div>
                        )}
                      </div>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setAddIpOpen(false)}>Cancel</Button>
                        <Button onClick={handleAddPublicIp} disabled={addingIp || !newIpNumber}>
                          {addingIp ? "Adding..." : "Add IP"}
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>
              </CardHeader>
              <CardContent>
                {/* Detected Fully Configured IPs from MikroTik */}
                {detectedIps.length > 0 && (
                  <div className="mb-6 p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <CheckCircle className="w-5 h-5 text-emerald-400" />
                        <h4 className="text-sm font-medium text-emerald-400">
                          Fully Configured IPs ({detectedIps.length})
                        </h4>
                      </div>
                      <Button
                        size="sm"
                        onClick={handleSaveAllDetectedIps}
                        disabled={savingImported}
                        className="gap-2"
                      >
                        <Download className="w-3 h-3" />
                        {savingImported ? "Saving..." : "Save All"}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground mb-3">
                      These IPs have all 3 required conditions: WG internal IP + Public IP on interface + NAT rule
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                      {detectedIps.map((ip) => (
                        <div key={ip.ip_number} className="flex items-center justify-between p-3 bg-secondary rounded-lg">
                          <div>
                            <div className="font-mono text-emerald-400 font-medium">{ip.public_ip}</div>
                            <div className="text-xs text-muted-foreground">{ip.internal_subnet}.0/24</div>
                            <div className="flex gap-1 mt-1">
                              <Badge variant="outline" className="text-[10px] py-0 text-cyan-400 border-cyan-400/30">WG</Badge>
                              <Badge variant="outline" className="text-[10px] py-0 text-blue-400 border-blue-400/30">IP</Badge>
                              <Badge variant="outline" className="text-[10px] py-0 text-amber-400 border-amber-400/30">NAT</Badge>
                            </div>
                          </div>
                          <Button size="sm" variant="ghost" onClick={() => handleSaveDetectedIp(ip)}>
                            <Plus className="w-4 h-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Partially Configured IPs */}
                {partiallyConfiguredIps.length > 0 && (
                  <div className="mb-6 p-4 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <AlertCircle className="w-5 h-5 text-amber-400" />
                        <h4 className="text-sm font-medium text-amber-400">
                          Partially Configured IPs ({partiallyConfiguredIps.length})
                        </h4>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground mb-3">
                      These IPs are missing one or more conditions. Configure them in MikroTik first.
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                      {partiallyConfiguredIps.map((ip) => (
                        <div key={ip.ip_number} className="p-3 bg-secondary rounded-lg flex items-center justify-between">
                          <div>
                            <div className="font-mono text-amber-400 font-medium">{ip.public_ip || `*.${ip.ip_number}`}</div>
                            <div className="text-xs text-muted-foreground">{ip.internal_subnet}.0/24</div>
                            <div className="flex gap-1 mt-1">
                              <Badge
                                variant="outline"
                                className={`text-[10px] py-0 ${ip.has_wg_ip ? "text-cyan-400 border-cyan-400/30" : "text-muted-foreground border-muted-foreground/30"}`}
                              >
                                {ip.has_wg_ip ? <Check className="w-2 h-2 mr-0.5" /> : <X className="w-2 h-2 mr-0.5" />}
                                WG
                              </Badge>
                              <Badge
                                variant="outline"
                                className={`text-[10px] py-0 ${ip.has_ip_address ? "text-blue-400 border-blue-400/30" : "text-muted-foreground border-muted-foreground/30"}`}
                              >
                                {ip.has_ip_address ? <Check className="w-2 h-2 mr-0.5" /> : <X className="w-2 h-2 mr-0.5" />}
                                IP
                              </Badge>
                              <Badge
                                variant="outline"
                                className={`text-[10px] py-0 ${ip.has_nat_rule ? "text-amber-400 border-amber-400/30" : "text-muted-foreground border-muted-foreground/30"}`}
                              >
                                {ip.has_nat_rule ? <Check className="w-2 h-2 mr-0.5" /> : <X className="w-2 h-2 mr-0.5" />}
                                NAT
                              </Badge>
                            </div>
                          </div>
                          <div className="flex gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={async () => {
                                // First save the IP to database
                                await handleSaveDetectedIp(ip);
                                // Then create missing rules
                                await handleCreateMikroTikRules(ip.ip_number);
                              }}
                              disabled={creatingRulesFor === ip.ip_number}
                              title="Import & Create Missing Rules"
                              className="text-amber-400 hover:text-amber-300"
                            >
                              <Zap className={`w-4 h-4 ${creatingRulesFor === ip.ip_number ? "animate-pulse" : ""}`} />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {!selectedRouter?.public_ip_prefix ? (
                  <div className="text-center py-8">
                    <Network className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                    <p className="text-muted-foreground mb-2">Router IP configuration not set</p>
                    <p className="text-sm text-muted-foreground">
                      Go to Routers tab and click the settings icon to configure IP prefixes.
                    </p>
                    <Button variant="outline" className="mt-4" onClick={handleImportFromMikroTik} disabled={!selectedRouterForIps || importing}>
                      {importing ? "Scanning..." : "Auto-detect from MikroTik"}
                    </Button>
                  </div>
                ) : publicIps.length === 0 ? (
                  <div className="text-center py-8">
                    <Globe className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                    <p className="text-muted-foreground">No public IPs saved for this router.</p>
                    <p className="text-sm text-muted-foreground mt-1">Click "Scan MikroTik" to detect and import IPs, or "Add IP" to add manually.</p>
                  </div>
                ) : (
                  <>
                  {/* Search Bar */}
                  <div className="mb-4 flex items-center gap-4">
                    <div className="relative flex-1 max-w-sm">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        placeholder="Search IPs..."
                        value={ipSearchQuery}
                        onChange={(e) => setIpSearchQuery(e.target.value)}
                        className="pl-9 bg-secondary border-border"
                      />
                    </div>
                    <span className="text-sm text-muted-foreground">
                      {filteredPublicIps.length} of {publicIps.length} IPs
                    </span>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow className="border-border">
                        <TableHead>#</TableHead>
                        <TableHead>Public IP</TableHead>
                        <TableHead>Internal Subnet</TableHead>
                        <TableHead>Config</TableHead>
                        <TableHead>Peers</TableHead>
                        <TableHead>NAT Traffic</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredPublicIps.map((ip) => {
                        const traffic = natTraffic[ip.ip_number];
                        const allRulesCreated = ip.wg_ip_created && ip.ip_address_created && ip.nat_rule_created;
                        const peersInfo = peersByIp[ip.internal_subnet];
                        return (
                          <TableRow key={ip.id} className="border-border">
                            <TableCell className="font-mono text-muted-foreground">{ip.ip_number}</TableCell>
                            <TableCell className="font-mono text-emerald-400">{ip.public_ip}</TableCell>
                            <TableCell className="font-mono text-cyan-400">{ip.internal_subnet}.0/24</TableCell>
                            <TableCell>
                              <div className="flex gap-1">
                                <Badge
                                  variant="outline"
                                  className={`text-[10px] py-0 ${ip.wg_ip_created ? "text-cyan-400 border-cyan-400/30" : "text-muted-foreground border-muted-foreground/30"}`}
                                >
                                  WG
                                </Badge>
                                <Badge
                                  variant="outline"
                                  className={`text-[10px] py-0 ${ip.ip_address_created ? "text-blue-400 border-blue-400/30" : "text-muted-foreground border-muted-foreground/30"}`}
                                >
                                  IP
                                </Badge>
                                <Badge
                                  variant="outline"
                                  className={`text-[10px] py-0 ${ip.nat_rule_created ? "text-amber-400 border-amber-400/30" : "text-muted-foreground border-muted-foreground/30"}`}
                                >
                                  NAT
                                </Badge>
                              </div>
                            </TableCell>
                            <TableCell>
                              {peersInfo && peersInfo.count > 0 ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelectedIpForPeers(ip);
                                    setSelectedIpPeers(peersInfo.peers);
                                    setPeersModalOpen(true);
                                  }}
                                  className="text-xs text-left hover:bg-secondary/50 p-1 rounded transition-colors cursor-pointer"
                                >
                                  <div className="flex items-center gap-1">
                                    <UserCheck className="w-3 h-3 text-emerald-400" />
                                    <span className="text-emerald-400 font-medium underline underline-offset-2">{peersInfo.count}</span>
                                  </div>
                                  {peersInfo.names.length > 0 && (
                                    <div className="text-muted-foreground mt-0.5 max-w-[120px] truncate" title={peersInfo.names.join(", ")}>
                                      {peersInfo.names.slice(0, 2).join(", ")}
                                      {peersInfo.names.length > 2 && "..."}
                                    </div>
                                  )}
                                </button>
                              ) : (
                                <span className="text-xs text-muted-foreground">0</span>
                              )}
                            </TableCell>
                            <TableCell>
                              {traffic ? (
                                <div className="text-xs">
                                  <div className="text-emerald-400 font-mono">{formatBytes(traffic.bytes)}</div>
                                  <div className="text-muted-foreground">{traffic.packets.toLocaleString()} pkts</div>
                                </div>
                              ) : (
                                <span className="text-xs text-muted-foreground">-</span>
                              )}
                            </TableCell>
                            <TableCell>
                              <Badge variant={ip.enabled ? "default" : "secondary"} className={ip.enabled ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : ""}>
                                {ip.enabled ? "Enabled" : "Disabled"}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-1">
                                {!allRulesCreated && (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => handleCreateMikroTikRules(ip.ip_number)}
                                    disabled={creatingRulesFor === ip.ip_number}
                                    title="Create missing rules in MikroTik"
                                    className="text-amber-400 hover:text-amber-300"
                                  >
                                    <Zap className={`w-4 h-4 ${creatingRulesFor === ip.ip_number ? "animate-pulse" : ""}`} />
                                  </Button>
                                )}
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => handleTogglePublicIp(ip)}
                                  title={ip.enabled ? "Disable" : "Enable"}
                                >
                                  {ip.enabled ? <X className="w-4 h-4 text-amber-400" /> : <Check className="w-4 h-4 text-emerald-400" />}
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="text-destructive"
                                  onClick={() => handleDeletePublicIp(ip.id)}
                                >
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ACCESS CONTROL TAB */}
          <TabsContent value="access">
            <Card className="bg-card border-border">
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>User Access Control</CardTitle>
                  <CardDescription>Manage which users can access which routers</CardDescription>
                </div>
                <Dialog open={addAccessOpen} onOpenChange={setAddAccessOpen}>
                  <DialogTrigger asChild>
                    <Button className="gap-2"><Plus className="w-4 h-4" /> Grant Access</Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-md bg-card border-border">
                    <DialogHeader>
                      <DialogTitle>Grant Router Access</DialogTitle>
                      <DialogDescription>Allow a user to access a router</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                      <div className="space-y-2">
                        <Label>User</Label>
                        <Select value={newAccess.user_id} onValueChange={(v) => setNewAccess({ ...newAccess, user_id: v })}>
                          <SelectTrigger className="bg-secondary border-border">
                            <SelectValue placeholder="Select user" />
                          </SelectTrigger>
                          <SelectContent>
                            {users.filter(u => u.role !== "admin").map((u) => (
                              <SelectItem key={u.id} value={u.id}>
                                {u.email} {u.username && `(${u.username})`}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Router</Label>
                        <Select value={newAccess.router_id} onValueChange={(v) => setNewAccess({ ...newAccess, router_id: v })}>
                          <SelectTrigger className="bg-secondary border-border">
                            <SelectValue placeholder="Select router" />
                          </SelectTrigger>
                          <SelectContent>
                            {routers.map((r) => (
                              <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setAddAccessOpen(false)}>Cancel</Button>
                      <Button onClick={handleAddAccess} disabled={addingAccess || !newAccess.user_id || !newAccess.router_id}>
                        {addingAccess ? "Granting..." : "Grant Access"}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </CardHeader>
              <CardContent>
                {userRouters.length === 0 ? (
                  <div className="text-center py-8">
                    <Shield className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                    <p className="text-muted-foreground">No access rules configured.</p>
                    <p className="text-sm text-muted-foreground mt-1">Admins have access to all routers by default.</p>
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className="border-border">
                        <TableHead>User</TableHead>
                        <TableHead>Router</TableHead>
                        <TableHead>Granted</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {userRouters.map((ur) => (
                        <TableRow key={ur.id} className="border-border">
                          <TableCell>
                            <div>
                              <div className="font-medium">{ur.profiles?.email}</div>
                              {ur.profiles?.username && (
                                <div className="text-xs text-muted-foreground">@{ur.profiles.username}</div>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">{ur.routers?.name}</Badge>
                          </TableCell>
                          <TableCell className="text-muted-foreground text-sm">
                            {new Date(ur.created_at).toLocaleDateString()}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-destructive"
                              onClick={() => handleDeleteAccess(ur.id)}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* USERS TAB */}
          <TabsContent value="users">
            <Card className="bg-card border-border">
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>Users</CardTitle>
                  <CardDescription>Manage users and their roles</CardDescription>
                </div>
                <Dialog open={addUserOpen} onOpenChange={setAddUserOpen}>
                  <DialogTrigger asChild>
                    <Button className="gap-2"><Plus className="w-4 h-4" /> Add User</Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-md bg-card border-border">
                    <DialogHeader>
                      <DialogTitle>Create User</DialogTitle>
                      <DialogDescription>Create a new user account</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                      <div className="space-y-2">
                        <Label>Email</Label>
                        <Input type="email" placeholder="user@example.com" value={newUser.email} onChange={(e) => setNewUser({ ...newUser, email: e.target.value })} className="bg-secondary border-border" />
                      </div>
                      <div className="space-y-2">
                        <Label>Username</Label>
                        <Input placeholder="johndoe" value={newUser.username} onChange={(e) => setNewUser({ ...newUser, username: e.target.value })} className="bg-secondary border-border" />
                      </div>
                      <div className="space-y-2">
                        <Label>Password</Label>
                        <Input type="password" placeholder="Min 6 characters" value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} className="bg-secondary border-border" />
                      </div>
                      <div className="space-y-2">
                        <Label>Role</Label>
                        <Select value={newUser.role} onValueChange={(v: UserRole) => setNewUser({ ...newUser, role: v })}>
                          <SelectTrigger className="bg-secondary border-border"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="user">User</SelectItem>
                            <SelectItem value="admin">Admin</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setAddUserOpen(false)}>Cancel</Button>
                      <Button onClick={handleAddUser} disabled={creatingUser || !newUser.email || !newUser.password || newUser.password.length < 6}>
                        {creatingUser ? "Creating..." : "Create User"}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow className="border-border">
                      <TableHead>Email</TableHead>
                      <TableHead>Username</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {users.map((u) => (
                      <TableRow key={u.id} className="border-border">
                        <TableCell>{u.email}</TableCell>
                        <TableCell>{u.username || "-"}</TableCell>
                        <TableCell>
                          <Badge variant={u.role === "admin" ? "destructive" : "secondary"}>{u.role}</Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {new Date(u.created_at).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="text-right">
                          {u.id !== profile?.id && (
                            <div className="flex items-center justify-end gap-1">
                              <Button variant="ghost" size="sm" onClick={() => handleUpdateRole(u.id, u.role === "admin" ? "user" : "admin")}>
                                {u.role === "admin" ? "Make User" : "Make Admin"}
                              </Button>
                              <Button variant="ghost" size="icon" className="text-destructive" onClick={() => handleDeleteUser(u.id)}>
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>

      {/* EDIT ROUTER DIALOG */}
      <Dialog open={editRouterOpen} onOpenChange={setEditRouterOpen}>
        <DialogContent className="max-w-lg bg-card border-border">
          <DialogHeader>
            <DialogTitle>Router Configuration</DialogTitle>
            <DialogDescription>Configure IP settings for {editingRouter?.name}</DialogDescription>
          </DialogHeader>
          {editingRouter && (
            <div className="space-y-6 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Name</Label>
                  <Input
                    value={editingRouter.name}
                    onChange={(e) => setEditingRouter({ ...editingRouter, name: e.target.value })}
                    className="bg-secondary border-border"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Host</Label>
                  <Input
                    value={editingRouter.host}
                    onChange={(e) => setEditingRouter({ ...editingRouter, host: e.target.value })}
                    className="bg-secondary border-border font-mono"
                  />
                </div>
              </div>

              <div className="border-t border-border pt-4">
                <h4 className="text-sm font-medium mb-4 flex items-center gap-2">
                  <Server className="w-4 h-4" /> Connection Settings
                </h4>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Connection Type</Label>
                    <Select
                      value={editingRouter.connection_type}
                      onValueChange={(v: ConnectionType) => {
                        const updates: Partial<Router> = { connection_type: v };
                        if (v === "api") updates.api_port = 8728;
                        else if (v === "api-ssl") updates.api_port = 8729;
                        else if (v === "rest") updates.port = 443;
                        else if (v === "rest-8443") updates.port = 8443;
                        setEditingRouter({ ...editingRouter, ...updates });
                      }}
                    >
                      <SelectTrigger className="bg-secondary border-border">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="api">API (Port 8728)</SelectItem>
                        <SelectItem value="api-ssl">API-SSL (Port 8729)</SelectItem>
                        <SelectItem value="rest">REST API (HTTPS 443)</SelectItem>
                        <SelectItem value="rest-8443">REST API (HTTPS 8443)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>{(editingRouter.connection_type === "api" || editingRouter.connection_type === "api-ssl") ? "API Port" : "HTTPS Port"}</Label>
                    <Input
                      type="number"
                      value={(editingRouter.connection_type === "api" || editingRouter.connection_type === "api-ssl") ? editingRouter.api_port : editingRouter.port}
                      onChange={(e) => {
                        const port = parseInt(e.target.value) || 0;
                        if (editingRouter.connection_type === "api" || editingRouter.connection_type === "api-ssl") {
                          setEditingRouter({ ...editingRouter, api_port: port });
                        } else {
                          setEditingRouter({ ...editingRouter, port: port });
                        }
                      }}
                      className="bg-secondary border-border font-mono"
                    />
                  </div>
                </div>
              </div>

              <div className="border-t border-border pt-4">
                <h4 className="text-sm font-medium mb-4 flex items-center gap-2">
                  <Network className="w-4 h-4" /> IP Configuration
                </h4>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Public IP Prefix</Label>
                    <Input
                      placeholder="76.245.59"
                      value={editingRouter.public_ip_prefix || ""}
                      onChange={(e) => setEditingRouter({ ...editingRouter, public_ip_prefix: e.target.value })}
                      className="bg-secondary border-border font-mono"
                    />
                    <p className="text-xs text-muted-foreground">First 3 octets of public IP</p>
                  </div>
                  <div className="space-y-2">
                    <Label>Public IP Mask</Label>
                    <Input
                      placeholder="/25"
                      value={editingRouter.public_ip_mask || "/25"}
                      onChange={(e) => setEditingRouter({ ...editingRouter, public_ip_mask: e.target.value })}
                      className="bg-secondary border-border font-mono"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Public IP Network</Label>
                    <Input
                      placeholder="76.245.59.128"
                      value={editingRouter.public_ip_network || ""}
                      onChange={(e) => setEditingRouter({ ...editingRouter, public_ip_network: e.target.value })}
                      className="bg-secondary border-border font-mono"
                    />
                    <p className="text-xs text-muted-foreground">Network address of IP block</p>
                  </div>
                  <div className="space-y-2">
                    <Label>Internal Prefix</Label>
                    <Input
                      placeholder="10.10"
                      value={editingRouter.internal_prefix || "10.10"}
                      onChange={(e) => setEditingRouter({ ...editingRouter, internal_prefix: e.target.value })}
                      className="bg-secondary border-border font-mono"
                    />
                    <p className="text-xs text-muted-foreground">First 2 octets of internal IP</p>
                  </div>
                  <div className="space-y-2">
                    <Label>Out Interface</Label>
                    <Input
                      placeholder="ether2"
                      value={editingRouter.out_interface || "ether2"}
                      onChange={(e) => setEditingRouter({ ...editingRouter, out_interface: e.target.value })}
                      className="bg-secondary border-border font-mono"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>WireGuard Interface</Label>
                    <Select
                      value={editingRouter.wg_interface || ""}
                      onValueChange={(v) => setEditingRouter({ ...editingRouter, wg_interface: v })}
                    >
                      <SelectTrigger className="bg-secondary border-border font-mono">
                        <SelectValue placeholder={loadingInterfaces ? "Loading..." : "Select interface"} />
                      </SelectTrigger>
                      <SelectContent>
                        {wgInterfaces.length === 0 ? (
                          <SelectItem value="_none" disabled>
                            {loadingInterfaces ? "Loading interfaces..." : "No interfaces found"}
                          </SelectItem>
                        ) : (
                          wgInterfaces.map((iface) => (
                            <SelectItem key={iface[".id"]} value={iface.name}>
                              {iface.name}
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              {editingRouter.public_ip_prefix && editingRouter.internal_prefix && (
                <div className="bg-secondary p-4 rounded-lg text-sm">
                  <p className="text-muted-foreground mb-2">Example mapping:</p>
                  <p>
                    <span className="text-emerald-400 font-mono">{editingRouter.public_ip_prefix}.200{editingRouter.public_ip_mask || "/25"}</span>
                    <span className="text-muted-foreground mx-2">→</span>
                    <span className="text-cyan-400 font-mono">{editingRouter.internal_prefix}.200.0/24</span>
                  </p>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditRouterOpen(false)}>Cancel</Button>
            <Button onClick={handleUpdateRouter}>Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Peers by IP Modal */}
      <Dialog open={peersModalOpen} onOpenChange={setPeersModalOpen}>
        <DialogContent className="bg-card border-border max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserCheck className="w-5 h-5 text-emerald-400" />
              Peers using {selectedIpForPeers?.public_ip}
            </DialogTitle>
            <DialogDescription>
              {selectedIpPeers.length} peer{selectedIpPeers.length !== 1 ? "s" : ""} on subnet {selectedIpForPeers?.internal_subnet}.0/24
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 max-h-[400px] overflow-y-auto">
            {selectedIpPeers.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">No peers found</p>
            ) : (
              <div className="space-y-2">
                {selectedIpPeers.map((peer) => (
                  <div key={peer.id} className="flex items-center justify-between p-3 bg-secondary rounded-lg">
                    <div>
                      <div className="font-medium">{peer.name}</div>
                      <div className="text-xs text-cyan-400 font-mono">{peer.address}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setPeersModalOpen(false)}>
              Close
            </Button>
            <Button
              onClick={() => {
                setPeersModalOpen(false);
                // Redirect to dashboard with this IP pre-selected
                router.push(`/dashboard?publicIp=${selectedIpForPeers?.id}`);
              }}
              className="gap-2"
            >
              <Plus className="w-4 h-4" />
              Add Peer to this IP
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
