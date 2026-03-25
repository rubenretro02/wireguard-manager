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
  Pencil,
  Check,
  X,
  Shield,
  Network
} from "lucide-react";
import type { Profile, Router, ConnectionType, UserRole, PublicIP, UserRouter } from "@/lib/types";

interface UserRouterWithRelations extends UserRouter {
  profiles: { id: string; email: string; username: string | null } | null;
  routers: { id: string; name: string } | null;
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
    }
  }, [selectedRouterForIps, fetchPublicIps]);

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
        fetchData();
      } else {
        toast.error(data.error || "Failed to update router");
      }
    } catch {
      toast.error("Failed to update router");
    }
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
                        <Select value={newRouter.connection_type} onValueChange={(v: ConnectionType) => setNewRouter({ ...newRouter, connection_type: v })}>
                          <SelectTrigger className="bg-secondary border-border"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="api">API (Port 8728)</SelectItem>
                            <SelectItem value="rest">REST API (HTTPS 443)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      {newRouter.connection_type === "api" ? (
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
                            <Badge variant={r.connection_type === "api" ? "default" : "secondary"}>
                              {r.connection_type === "api" ? `API:${r.api_port || 8728}` : `REST:${r.port || 443}`}
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
                                onClick={() => {
                                  setEditingRouter(r);
                                  setEditRouterOpen(true);
                                }}
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
                  <CardDescription>Manage public IPs for each router</CardDescription>
                </div>
                <div className="flex items-center gap-3">
                  <Select value={selectedRouterForIps} onValueChange={setSelectedRouterForIps}>
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
                {!selectedRouter?.public_ip_prefix ? (
                  <div className="text-center py-8">
                    <Network className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                    <p className="text-muted-foreground mb-2">Router IP configuration not set</p>
                    <p className="text-sm text-muted-foreground">
                      Go to Routers tab and click the settings icon to configure IP prefixes.
                    </p>
                  </div>
                ) : publicIps.length === 0 ? (
                  <div className="text-center py-8">
                    <Globe className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                    <p className="text-muted-foreground">No public IPs configured for this router.</p>
                    <p className="text-sm text-muted-foreground mt-1">Click "Add IP" to add your first public IP.</p>
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className="border-border">
                        <TableHead>#</TableHead>
                        <TableHead>Public IP</TableHead>
                        <TableHead>Internal Subnet</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {publicIps.map((ip) => (
                        <TableRow key={ip.id} className="border-border">
                          <TableCell className="font-mono text-muted-foreground">{ip.ip_number}</TableCell>
                          <TableCell className="font-mono text-emerald-400">{ip.public_ip}</TableCell>
                          <TableCell className="font-mono text-cyan-400">{ip.internal_subnet}.0/24</TableCell>
                          <TableCell>
                            <Badge variant={ip.enabled ? "default" : "secondary"} className={ip.enabled ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : ""}>
                              {ip.enabled ? "Enabled" : "Disabled"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
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
                      ))}
                    </TableBody>
                  </Table>
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
                    <Input
                      placeholder="wg0"
                      value={editingRouter.wg_interface || "wg0"}
                      onChange={(e) => setEditingRouter({ ...editingRouter, wg_interface: e.target.value })}
                      className="bg-secondary border-border font-mono"
                    />
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
    </div>
  );
}
