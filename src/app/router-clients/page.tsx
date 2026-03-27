"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { DashboardLayout, PageHeader, PageContent } from "@/components/DashboardLayout";
import { StatCard } from "@/components/StatCard";
import {
  Router,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Power,
  Wifi,
  WifiOff,
  Settings,
  Terminal,
  Play,
  Eye,
  EyeOff,
  Copy,
  Check,
  Cpu,
  HardDrive,
  Clock,
  AlertCircle,
  CheckCircle,
  XCircle,
  Upload,
  FileCode,
} from "lucide-react";
import type { Profile, RouterClient, VpnPeerConfig, RouterClientLog } from "@/lib/types";

export default function RouterClientsPage() {
  const router = useRouter();
  const supabase = createClient();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [routerClients, setRouterClients] = useState<RouterClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Add/Edit dialog
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editingRouter, setEditingRouter] = useState<RouterClient | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    host: "",
    api_port: 8729,
    username: "admin",
    password: "",
    use_ssl: true,
    notes: "",
  });
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Deploy VPN dialog
  const [deployDialogOpen, setDeployDialogOpen] = useState(false);
  const [selectedRouter, setSelectedRouter] = useState<RouterClient | null>(null);
  const [vpnConfigText, setVpnConfigText] = useState("");
  const [deploying, setDeploying] = useState(false);

  // Terminal dialog
  const [terminalDialogOpen, setTerminalDialogOpen] = useState(false);
  const [terminalRouter, setTerminalRouter] = useState<RouterClient | null>(null);
  const [terminalCommand, setTerminalCommand] = useState("/system/resource");
  const [terminalOutput, setTerminalOutput] = useState<string>("");
  const [executingCommand, setExecutingCommand] = useState(false);

  // Details dialog
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);
  const [detailsRouter, setDetailsRouter] = useState<RouterClient | null>(null);
  const [routerLogs, setRouterLogs] = useState<RouterClientLog[]>([]);

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }

      const { data: profileData } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();

      if (profileData) setProfile(profileData as Profile);
      setLoading(false);
    };
    checkAuth();
  }, [router, supabase]);

  const fetchRouterClients = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/router-clients");
      const data = await res.json();
      if (data.routerClients) {
        setRouterClients(data.routerClients);
      }
    } catch {
      toast.error("Failed to fetch router clients");
    }
    setRefreshing(false);
  }, []);

  useEffect(() => {
    if (profile) {
      fetchRouterClients();
    }
  }, [profile, fetchRouterClients]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/login");
  };

  // Parse WireGuard config text
  const parseWireGuardConfig = (configText: string): VpnPeerConfig | null => {
    try {
      const lines = configText.split("\n");
      const config: Partial<VpnPeerConfig> = {
        mtu: 1420,
        keepalive: 25,
        dns1: "8.8.8.8",
        dns2: "8.8.4.4",
      };

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("PrivateKey")) {
          config.privateKey = trimmed.split("=")[1]?.trim();
        } else if (trimmed.startsWith("Address")) {
          config.address = trimmed.split("=")[1]?.trim();
        } else if (trimmed.startsWith("DNS")) {
          const dns = trimmed.split("=")[1]?.trim().split(",");
          if (dns) {
            config.dns1 = dns[0]?.trim();
            config.dns2 = dns[1]?.trim() || "8.8.4.4";
          }
        } else if (trimmed.startsWith("MTU")) {
          config.mtu = parseInt(trimmed.split("=")[1]?.trim()) || 1420;
        } else if (trimmed.startsWith("PublicKey")) {
          config.peerPublicKey = trimmed.split("=")[1]?.trim();
        } else if (trimmed.startsWith("Endpoint")) {
          const endpoint = trimmed.split("=")[1]?.trim();
          if (endpoint) {
            const [ip, port] = endpoint.split(":");
            config.endpointIP = ip;
            config.endpointPort = parseInt(port) || 51820;
          }
        } else if (trimmed.startsWith("PersistentKeepalive")) {
          config.keepalive = parseInt(trimmed.split("=")[1]?.trim()) || 25;
        }
      }

      if (!config.privateKey || !config.address || !config.peerPublicKey || !config.endpointIP) {
        return null;
      }

      return config as VpnPeerConfig;
    } catch {
      return null;
    }
  };

  const handleTestConnection = async () => {
    setTesting(true);
    try {
      const res = await fetch("/api/router-clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "test-connection",
          data: {
            host: formData.host,
            api_port: formData.api_port,
            username: formData.username,
            password: formData.password,
            use_ssl: formData.use_ssl,
          },
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`Connected! Model: ${data.info?.model}, Version: ${data.info?.version}`);
      } else {
        toast.error(`Connection failed: ${data.error}`);
      }
    } catch {
      toast.error("Connection test failed");
    }
    setTesting(false);
  };

  const handleSaveRouter = async () => {
    if (!formData.name || !formData.host || !formData.username || !formData.password) {
      toast.error("Please fill all required fields");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/router-clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: editingRouter ? "update" : "create",
          data: editingRouter ? { id: editingRouter.id, ...formData } : formData,
        }),
      });
      const data = await res.json();

      if (data.error) {
        toast.error(data.error);
      } else {
        toast.success(editingRouter ? "Router updated" : "Router added");
        setAddDialogOpen(false);
        setEditingRouter(null);
        setFormData({
          name: "",
          host: "",
          api_port: 8729,
          username: "admin",
          password: "",
          use_ssl: true,
          notes: "",
        });
        fetchRouterClients();
      }
    } catch {
      toast.error("Failed to save router");
    }
    setSaving(false);
  };

  const handleCheckOnline = async (routerClient: RouterClient) => {
    try {
      const res = await fetch("/api/router-clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "check-online",
          data: { id: routerClient.id },
        }),
      });
      const data = await res.json();

      if (data.success) {
        toast.success(`${routerClient.name} is online`);
      } else {
        toast.error(`${routerClient.name} is offline: ${data.error}`);
      }
      fetchRouterClients();
    } catch {
      toast.error("Failed to check status");
    }
  };

  const handleDeployVpn = async () => {
    if (!selectedRouter || !vpnConfigText) {
      toast.error("Please paste the VPN configuration");
      return;
    }

    const vpnConfig = parseWireGuardConfig(vpnConfigText);
    if (!vpnConfig) {
      toast.error("Invalid WireGuard configuration. Please check the format.");
      return;
    }

    setDeploying(true);
    try {
      const res = await fetch("/api/router-clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "deploy-vpn",
          data: {
            id: selectedRouter.id,
            vpnConfig,
          },
        }),
      });
      const data = await res.json();

      if (data.success) {
        toast.success("VPN deployed successfully!");
        setDeployDialogOpen(false);
        setSelectedRouter(null);
        setVpnConfigText("");
        fetchRouterClients();
      } else {
        toast.error(`Deployment failed: ${data.error}`);
      }
    } catch {
      toast.error("Failed to deploy VPN");
    }
    setDeploying(false);
  };

  const handleExecuteCommand = async () => {
    if (!terminalRouter || !terminalCommand) return;

    setExecutingCommand(true);
    try {
      const res = await fetch("/api/router-clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "execute-command",
          data: {
            id: terminalRouter.id,
            command: terminalCommand,
          },
        }),
      });
      const data = await res.json();

      if (data.success) {
        setTerminalOutput(JSON.stringify(data.result, null, 2));
      } else {
        setTerminalOutput(`Error: ${data.error}`);
      }
    } catch {
      setTerminalOutput("Failed to execute command");
    }
    setExecutingCommand(false);
  };

  const handleDeleteRouter = async (routerClient: RouterClient) => {
    if (!confirm(`Delete router "${routerClient.name}"?`)) return;

    try {
      const res = await fetch("/api/router-clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "delete",
          data: { id: routerClient.id },
        }),
      });
      const data = await res.json();

      if (data.success) {
        toast.success("Router deleted");
        fetchRouterClients();
      } else {
        toast.error(data.error);
      }
    } catch {
      toast.error("Failed to delete router");
    }
  };

  const openEditDialog = (routerClient: RouterClient) => {
    setEditingRouter(routerClient);
    setFormData({
      name: routerClient.name,
      host: routerClient.host,
      api_port: routerClient.api_port,
      username: routerClient.username,
      password: routerClient.password,
      use_ssl: routerClient.use_ssl,
      notes: routerClient.notes || "",
    });
    setAddDialogOpen(true);
  };

  const openDeployDialog = (routerClient: RouterClient) => {
    setSelectedRouter(routerClient);
    setVpnConfigText("");
    setDeployDialogOpen(true);
  };

  const openTerminalDialog = (routerClient: RouterClient) => {
    setTerminalRouter(routerClient);
    setTerminalCommand("/system/resource");
    setTerminalOutput("");
    setTerminalDialogOpen(true);
  };

  const openDetailsDialog = async (routerClient: RouterClient) => {
    setDetailsRouter(routerClient);
    setDetailsDialogOpen(true);

    // Fetch logs
    const { data: logs } = await supabase
      .from("router_client_logs")
      .select("*")
      .eq("router_client_id", routerClient.id)
      .order("created_at", { ascending: false })
      .limit(20);

    if (logs) {
      setRouterLogs(logs as RouterClientLog[]);
    }
  };

  // Stats
  const stats = {
    total: routerClients.length,
    online: routerClients.filter(r => r.is_online).length,
    vpnConfigured: routerClients.filter(r => r.vpn_configured).length,
    vpnConnected: routerClients.filter(r => r.vpn_connected).length,
  };

  // Filtered routers
  const filteredRouters = routerClients.filter(r => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      r.name.toLowerCase().includes(query) ||
      r.host.toLowerCase().includes(query) ||
      r.router_model?.toLowerCase().includes(query)
    );
  });

  const formatDate = (dateString: string | null) => {
    if (!dateString) return "-";
    return new Date(dateString).toLocaleString();
  };

  const formatBytes = (bytes: number | null) => {
    if (!bytes) return "-";
    const mb = bytes / 1024 / 1024;
    return `${mb.toFixed(0)} MB`;
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <DashboardLayout
      userRole={profile?.role}
      userEmail={profile?.email}
      onLogout={handleLogout}
    >
      <PageHeader title="Router Clients" description="Manage your remote MikroTik routers">
        <Button onClick={() => {
          setEditingRouter(null);
          setFormData({
            name: "",
            host: "",
            api_port: 8729,
            username: "admin",
            password: "",
            use_ssl: true,
            notes: "",
          });
          setAddDialogOpen(true);
        }} className="gap-2">
          <Plus className="w-4 h-4" />
          Add Router
        </Button>
      </PageHeader>

      <PageContent>
        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <StatCard
            title="Total Routers"
            value={stats.total}
            icon={Router}
            iconColor="primary"
          />
          <StatCard
            title="Online"
            value={stats.online}
            subtitle={`${stats.total > 0 ? ((stats.online / stats.total) * 100).toFixed(0) : 0}% online`}
            icon={Wifi}
            iconColor="emerald"
          />
          <StatCard
            title="VPN Configured"
            value={stats.vpnConfigured}
            icon={Settings}
            iconColor="cyan"
          />
          <StatCard
            title="VPN Connected"
            value={stats.vpnConnected}
            icon={CheckCircle}
            iconColor="emerald"
          />
        </div>

        {/* Router List */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-border flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <h2 className="text-lg font-semibold">
              Routers
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                ({filteredRouters.length})
              </span>
            </h2>
            <div className="flex items-center gap-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search routers..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 w-[200px] bg-secondary border-border"
                />
              </div>
              <Button
                variant="outline"
                size="icon"
                onClick={fetchRouterClients}
                disabled={refreshing}
              >
                <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
              </Button>
            </div>
          </div>

          {filteredRouters.length === 0 ? (
            <div className="py-16 text-center text-muted-foreground">
              {searchQuery ? "No routers match your search" : "No routers added yet. Click 'Add Router' to get started."}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent border-border">
                  <TableHead className="text-muted-foreground">Name</TableHead>
                  <TableHead className="text-muted-foreground">Host</TableHead>
                  <TableHead className="text-muted-foreground">Model</TableHead>
                  <TableHead className="text-muted-foreground">Status</TableHead>
                  <TableHead className="text-muted-foreground">VPN</TableHead>
                  <TableHead className="text-muted-foreground">Resources</TableHead>
                  <TableHead className="text-muted-foreground">Last Seen</TableHead>
                  <TableHead className="text-muted-foreground text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRouters.map((routerClient) => (
                  <TableRow key={routerClient.id} className="table-row-hover border-border">
                    <TableCell>
                      <button
                        onClick={() => openDetailsDialog(routerClient)}
                        className="font-medium hover:text-primary transition-colors"
                      >
                        {routerClient.name}
                      </button>
                    </TableCell>
                    <TableCell>
                      <span className="font-mono text-sm text-cyan-400">
                        {routerClient.host}:{routerClient.api_port}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm">
                        {routerClient.router_model || "-"}
                      </span>
                      {routerClient.router_os_version && (
                        <span className="text-xs text-muted-foreground ml-2">
                          v{routerClient.router_os_version}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={routerClient.is_online ? "badge-success" : "badge-danger"}
                      >
                        {routerClient.is_online ? (
                          <><Wifi className="w-3 h-3 mr-1" /> Online</>
                        ) : (
                          <><WifiOff className="w-3 h-3 mr-1" /> Offline</>
                        )}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {routerClient.vpn_configured ? (
                        <Badge
                          variant="outline"
                          className={routerClient.vpn_connected ? "text-emerald-400 border-emerald-400" : "text-amber-400 border-amber-400"}
                        >
                          {routerClient.vpn_connected ? (
                            <><CheckCircle className="w-3 h-3 mr-1" /> Connected</>
                          ) : (
                            <><AlertCircle className="w-3 h-3 mr-1" /> Configured</>
                          )}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground">
                          <XCircle className="w-3 h-3 mr-1" /> Not Configured
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {routerClient.cpu_load !== null && (
                        <div className="flex items-center gap-3 text-xs">
                          <span className="flex items-center gap-1">
                            <Cpu className="w-3 h-3 text-cyan-400" />
                            {routerClient.cpu_load}%
                          </span>
                          {routerClient.memory_used && routerClient.memory_total && (
                            <span className="flex items-center gap-1">
                              <HardDrive className="w-3 h-3 text-emerald-400" />
                              {formatBytes(routerClient.memory_used)}/{formatBytes(routerClient.memory_total)}
                            </span>
                          )}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-muted-foreground flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {routerClient.last_seen ? formatDate(routerClient.last_seen) : "Never"}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleCheckOnline(routerClient)}
                          title="Check status"
                        >
                          <RefreshCw className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openDeployDialog(routerClient)}
                          title="Deploy VPN"
                          className="text-emerald-400 hover:text-emerald-300"
                        >
                          <Upload className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openTerminalDialog(routerClient)}
                          title="Terminal"
                        >
                          <Terminal className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEditDialog(routerClient)}
                          title="Edit"
                        >
                          <Settings className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDeleteRouter(routerClient)}
                          className="text-destructive hover:text-destructive"
                          title="Delete"
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
        </div>
      </PageContent>

      {/* Add/Edit Router Dialog */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="bg-card border-border">
          <DialogHeader>
            <DialogTitle>{editingRouter ? "Edit Router" : "Add Router"}</DialogTitle>
            <DialogDescription>
              {editingRouter ? "Update router connection details" : "Add a new MikroTik router to manage remotely"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Name *</Label>
              <Input
                placeholder="Office Router"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="bg-secondary border-border"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Host (IP or DDNS) *</Label>
                <Input
                  placeholder="192.168.1.1 or router.mynetname.net"
                  value={formData.host}
                  onChange={(e) => setFormData({ ...formData, host: e.target.value })}
                  className="bg-secondary border-border font-mono"
                />
              </div>
              <div className="space-y-2">
                <Label>API Port</Label>
                <Input
                  type="number"
                  value={formData.api_port}
                  onChange={(e) => setFormData({ ...formData, api_port: parseInt(e.target.value) || 8729 })}
                  className="bg-secondary border-border"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Username *</Label>
                <Input
                  placeholder="admin"
                  value={formData.username}
                  onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                  className="bg-secondary border-border"
                />
              </div>
              <div className="space-y-2">
                <Label>Password *</Label>
                <div className="relative">
                  <Input
                    type={showPassword ? "text" : "password"}
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    className="bg-secondary border-border pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="use_ssl"
                checked={formData.use_ssl}
                onChange={(e) => setFormData({ ...formData, use_ssl: e.target.checked })}
                className="rounded border-border"
              />
              <Label htmlFor="use_ssl" className="cursor-pointer">Use SSL (recommended for API-SSL port 8729)</Label>
            </div>
            <div className="space-y-2">
              <Label>Notes</Label>
              <Input
                placeholder="Optional notes..."
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                className="bg-secondary border-border"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={handleTestConnection}
              disabled={testing || !formData.host || !formData.username || !formData.password}
            >
              {testing ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Power className="w-4 h-4 mr-2" />}
              Test Connection
            </Button>
            <Button variant="outline" onClick={() => setAddDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveRouter} disabled={saving}>
              {saving ? "Saving..." : editingRouter ? "Update" : "Add Router"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Deploy VPN Dialog */}
      <Dialog open={deployDialogOpen} onOpenChange={setDeployDialogOpen}>
        <DialogContent className="bg-card border-border max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload className="w-5 h-5 text-emerald-400" />
              Deploy VPN to {selectedRouter?.name}
            </DialogTitle>
            <DialogDescription>
              Paste your WireGuard configuration below. The script will be executed automatically.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>WireGuard Configuration</Label>
              <textarea
                placeholder={`[Interface]
PrivateKey = your_private_key_here
Address = 10.10.251.15/32
DNS = 68.94.156.1, 68.94.157.1
MTU = 1420

[Peer]
PublicKey = server_public_key_here
AllowedIPs = 0.0.0.0/0, ::/0
Endpoint = 76.245.59.251:13231
PersistentKeepalive = 25`}
                value={vpnConfigText}
                onChange={(e) => setVpnConfigText(e.target.value)}
                className="w-full h-64 p-4 bg-secondary border border-border rounded-lg font-mono text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-lg">
              <p className="text-sm text-amber-400 flex items-center gap-2">
                <AlertCircle className="w-4 h-4" />
                This will configure WireGuard VPN, NAT, Firewall, MSS, and Kill Switch automatically.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeployDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleDeployVpn}
              disabled={deploying || !vpnConfigText}
              className="gap-2"
            >
              {deploying ? (
                <><RefreshCw className="w-4 h-4 animate-spin" /> Deploying...</>
              ) : (
                <><Play className="w-4 h-4" /> Deploy VPN</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Terminal Dialog */}
      <Dialog open={terminalDialogOpen} onOpenChange={setTerminalDialogOpen}>
        <DialogContent className="bg-card border-border max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Terminal className="w-5 h-5" />
              Terminal - {terminalRouter?.name}
            </DialogTitle>
            <DialogDescription>
              Execute RouterOS commands on this router
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="flex gap-2">
              <Input
                placeholder="/system/resource"
                value={terminalCommand}
                onChange={(e) => setTerminalCommand(e.target.value)}
                className="bg-secondary border-border font-mono flex-1"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleExecuteCommand();
                }}
              />
              <Button
                onClick={handleExecuteCommand}
                disabled={executingCommand}
              >
                {executingCommand ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              </Button>
            </div>
            <div className="space-y-2">
              <Label className="text-muted-foreground text-xs">Output</Label>
              <pre className="bg-black/50 p-4 rounded-lg text-sm overflow-auto max-h-96 font-mono text-green-400 border border-border">
                {terminalOutput || "// Output will appear here"}
              </pre>
            </div>
            <div className="flex gap-2 flex-wrap">
              <Badge
                variant="outline"
                className="cursor-pointer hover:bg-secondary"
                onClick={() => setTerminalCommand("/system/resource")}
              >
                /system/resource
              </Badge>
              <Badge
                variant="outline"
                className="cursor-pointer hover:bg-secondary"
                onClick={() => setTerminalCommand("/interface/wireguard")}
              >
                /interface/wireguard
              </Badge>
              <Badge
                variant="outline"
                className="cursor-pointer hover:bg-secondary"
                onClick={() => setTerminalCommand("/interface/wireguard/peers")}
              >
                /interface/wireguard/peers
              </Badge>
              <Badge
                variant="outline"
                className="cursor-pointer hover:bg-secondary"
                onClick={() => setTerminalCommand("/ip/route")}
              >
                /ip/route
              </Badge>
              <Badge
                variant="outline"
                className="cursor-pointer hover:bg-secondary"
                onClick={() => setTerminalCommand("/ip/firewall/nat")}
              >
                /ip/firewall/nat
              </Badge>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTerminalDialogOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Details Dialog */}
      <Dialog open={detailsDialogOpen} onOpenChange={setDetailsDialogOpen}>
        <DialogContent className="bg-card border-border max-w-2xl">
          <DialogHeader>
            <DialogTitle>{detailsRouter?.name}</DialogTitle>
            <DialogDescription>
              {detailsRouter?.host}:{detailsRouter?.api_port}
            </DialogDescription>
          </DialogHeader>
          {detailsRouter && (
            <Tabs defaultValue="info" className="w-full">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="info">Info</TabsTrigger>
                <TabsTrigger value="vpn">VPN Config</TabsTrigger>
                <TabsTrigger value="logs">Logs</TabsTrigger>
              </TabsList>
              <TabsContent value="info" className="space-y-4 py-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-muted-foreground text-xs">Model</Label>
                    <p className="font-mono text-sm">{detailsRouter.router_model || "-"}</p>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-muted-foreground text-xs">RouterOS Version</Label>
                    <p className="font-mono text-sm">{detailsRouter.router_os_version || "-"}</p>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-muted-foreground text-xs">Uptime</Label>
                    <p className="font-mono text-sm">{detailsRouter.uptime || "-"}</p>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-muted-foreground text-xs">CPU Load</Label>
                    <p className="font-mono text-sm">{detailsRouter.cpu_load ? `${detailsRouter.cpu_load}%` : "-"}</p>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-muted-foreground text-xs">Memory</Label>
                    <p className="font-mono text-sm">
                      {detailsRouter.memory_used && detailsRouter.memory_total
                        ? `${formatBytes(detailsRouter.memory_used)} / ${formatBytes(detailsRouter.memory_total)}`
                        : "-"}
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-muted-foreground text-xs">Last Seen</Label>
                    <p className="text-sm">{formatDate(detailsRouter.last_seen)}</p>
                  </div>
                </div>
                {detailsRouter.last_error && (
                  <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
                    <p className="text-sm text-red-400">{detailsRouter.last_error}</p>
                  </div>
                )}
              </TabsContent>
              <TabsContent value="vpn" className="space-y-4 py-4">
                {detailsRouter.vpn_configured ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label className="text-muted-foreground text-xs">Interface</Label>
                        <p className="font-mono text-sm">{detailsRouter.vpn_interface_name || "-"}</p>
                      </div>
                      <div className="space-y-2">
                        <Label className="text-muted-foreground text-xs">Status</Label>
                        <Badge variant="outline" className={detailsRouter.vpn_connected ? "text-emerald-400" : "text-amber-400"}>
                          {detailsRouter.vpn_connected ? "Connected" : "Disconnected"}
                        </Badge>
                      </div>
                      <div className="space-y-2">
                        <Label className="text-muted-foreground text-xs">Address</Label>
                        <p className="font-mono text-sm text-cyan-400">{detailsRouter.vpn_address || "-"}</p>
                      </div>
                      <div className="space-y-2">
                        <Label className="text-muted-foreground text-xs">Endpoint</Label>
                        <p className="font-mono text-sm text-emerald-400">
                          {detailsRouter.vpn_endpoint_ip}:{detailsRouter.vpn_endpoint_port}
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <XCircle className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p>VPN not configured</p>
                    <Button
                      variant="outline"
                      className="mt-4"
                      onClick={() => {
                        setDetailsDialogOpen(false);
                        openDeployDialog(detailsRouter);
                      }}
                    >
                      <Upload className="w-4 h-4 mr-2" />
                      Deploy VPN
                    </Button>
                  </div>
                )}
              </TabsContent>
              <TabsContent value="logs" className="py-4">
                {routerLogs.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">No logs available</p>
                ) : (
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {routerLogs.map((log) => (
                      <div
                        key={log.id}
                        className="flex items-start gap-3 p-3 bg-secondary rounded-lg"
                      >
                        {log.status === "success" ? (
                          <CheckCircle className="w-4 h-4 text-emerald-400 mt-0.5" />
                        ) : log.status === "error" ? (
                          <XCircle className="w-4 h-4 text-red-400 mt-0.5" />
                        ) : (
                          <Clock className="w-4 h-4 text-amber-400 mt-0.5" />
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium">{log.action}</p>
                          <p className="text-xs text-muted-foreground truncate">{log.details}</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {formatDate(log.created_at)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </TabsContent>
            </Tabs>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailsDialogOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
