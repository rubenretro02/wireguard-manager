"use client";

import { useEffect, useState } from "react";
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
import type { Profile, Router, ConnectionType, UserRole } from "@/lib/types";

export default function AdminPage() {
  const router = useRouter();
  const supabase = createClient();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [routers, setRouters] = useState<Router[]>([]);
  const [users, setUsers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);

  // Router states
  const [addRouterOpen, setAddRouterOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
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
  }, [router, supabase]);

  const fetchData = async () => {
    const { data: routersData } = await supabase
      .from("routers")
      .select("id, name, host, port, api_port, username, use_ssl, connection_type, created_at")
      .order("created_at", { ascending: false });
    if (routersData) setRouters(routersData as Router[]);
    const { data: usersData } = await supabase.from("profiles").select("*").order("created_at", { ascending: false });
    if (usersData) setUsers(usersData as Profile[]);
  };

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
          name: "",
          host: "",
          port: "443",
          api_port: "8728",
          username: "",
          password: "",
          use_ssl: false,
          connection_type: "api",
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
    if (!confirm("Delete this user? This action cannot be undone.")) return;
    try {
      const res = await fetch(`/api/users?id=${userId}`, { method: "DELETE" });
      const data = await res.json();
      if (data.success) {
        toast.success("User deleted");
        fetchData();
      } else {
        toast.error(data.error || "Failed to delete user");
      }
    } catch {
      toast.error("Failed to delete user");
    }
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center"><div className="animate-spin w-8 h-8 border-2 border-muted-foreground border-t-foreground rounded-full" /></div>;

  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-card">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 bg-muted rounded-full flex items-center justify-center">
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" /></svg>
            </div>
            <h1 className="text-xl font-semibold">Admin Panel</h1>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-muted-foreground text-sm">{profile?.email} <Badge variant="destructive">admin</Badge></span>
            <Button variant="ghost" onClick={() => router.push("/dashboard")}>Dashboard</Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <Tabs defaultValue="routers">
          <TabsList className="mb-6"><TabsTrigger value="routers">Routers</TabsTrigger><TabsTrigger value="users">Users</TabsTrigger></TabsList>

          <TabsContent value="routers">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div><CardTitle>MikroTik Routers</CardTitle><CardDescription>Manage your MikroTik routers</CardDescription></div>
                <Dialog open={addRouterOpen} onOpenChange={setAddRouterOpen}>
                  <DialogTrigger asChild><Button>Add Router</Button></DialogTrigger>
                  <DialogContent className="max-w-md">
                    <DialogHeader>
                      <DialogTitle>Add Router</DialogTitle>
                      <DialogDescription>Connect a new MikroTik router (RouterOS v7+)</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                      <div className="space-y-2">
                        <Label>Name</Label>
                        <Input placeholder="Office Router" value={newRouter.name} onChange={(e) => setNewRouter({ ...newRouter, name: e.target.value })} />
                      </div>
                      <div className="space-y-2">
                        <Label>Host</Label>
                        <Input placeholder="192.168.1.1 or router.example.com" value={newRouter.host} onChange={(e) => setNewRouter({ ...newRouter, host: e.target.value })} />
                      </div>
                      <div className="space-y-2">
                        <Label>Connection Type</Label>
                        <Select value={newRouter.connection_type} onValueChange={(v: ConnectionType) => setNewRouter({ ...newRouter, connection_type: v })}>
                          <SelectTrigger>
                            <SelectValue placeholder="Select connection type" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="api">API (Port 8728) - Recommended</SelectItem>
                            <SelectItem value="rest">REST API (HTTPS Port 443)</SelectItem>
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">
                          {newRouter.connection_type === "api"
                            ? "Uses MikroTik API protocol on port 8728. Works without SSL certificate."
                            : "Uses REST API over HTTPS. Requires SSL certificate on the router."}
                        </p>
                      </div>
                      {newRouter.connection_type === "api" ? (
                        <div className="space-y-2">
                          <Label>API Port</Label>
                          <Input type="number" placeholder="8728" value={newRouter.api_port} onChange={(e) => setNewRouter({ ...newRouter, api_port: e.target.value })} />
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <Label>HTTPS Port</Label>
                          <Input type="number" placeholder="443" value={newRouter.port} onChange={(e) => setNewRouter({ ...newRouter, port: e.target.value })} />
                        </div>
                      )}
                      <div className="space-y-2">
                        <Label>Username</Label>
                        <Input placeholder="admin" value={newRouter.username} onChange={(e) => setNewRouter({ ...newRouter, username: e.target.value })} />
                      </div>
                      <div className="space-y-2">
                        <Label>Password</Label>
                        <Input type="password" value={newRouter.password} onChange={(e) => setNewRouter({ ...newRouter, password: e.target.value })} />
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="ghost" onClick={() => setAddRouterOpen(false)}>Cancel</Button>
                      <Button onClick={handleAddRouter} disabled={adding || !newRouter.name || !newRouter.host || !newRouter.username || !newRouter.password}>
                        {adding ? "Adding..." : "Add Router"}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </CardHeader>
              <CardContent>
                {routers.length === 0 ? <p className="text-muted-foreground text-center py-8">No routers configured. Add your first MikroTik router above.</p> : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Host</TableHead>
                        <TableHead>Connection</TableHead>
                        <TableHead>Username</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {routers.map((r) => (
                        <TableRow key={r.id}>
                          <TableCell className="font-medium">{r.name}</TableCell>
                          <TableCell>{r.host}</TableCell>
                          <TableCell>
                            <Badge variant={r.connection_type === "api" ? "default" : "secondary"}>
                              {r.connection_type === "api" ? `API:${r.api_port || 8728}` : `REST:${r.port || 443}`}
                            </Badge>
                          </TableCell>
                          <TableCell>{r.username}</TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleTestConnection(r.id)}
                              disabled={testingId === r.id}
                            >
                              {testingId === r.id ? "Testing..." : "Test"}
                            </Button>
                            <Button variant="ghost" size="sm" className="text-destructive" onClick={() => handleDeleteRouter(r.id)}>Delete</Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="users">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div><CardTitle>Users</CardTitle><CardDescription>Manage users and their roles</CardDescription></div>
                <Dialog open={addUserOpen} onOpenChange={setAddUserOpen}>
                  <DialogTrigger asChild><Button>Add User</Button></DialogTrigger>
                  <DialogContent className="max-w-md">
                    <DialogHeader>
                      <DialogTitle>Create User</DialogTitle>
                      <DialogDescription>Create a new user account</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                      <div className="space-y-2">
                        <Label>Email</Label>
                        <Input
                          type="email"
                          placeholder="user@example.com"
                          value={newUser.email}
                          onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Username</Label>
                        <Input
                          placeholder="johndoe"
                          value={newUser.username}
                          onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Password</Label>
                        <Input
                          type="password"
                          placeholder="Minimum 6 characters"
                          value={newUser.password}
                          onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Role</Label>
                        <Select value={newUser.role} onValueChange={(v: UserRole) => setNewUser({ ...newUser, role: v })}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="user">User</SelectItem>
                            <SelectItem value="admin">Admin</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="ghost" onClick={() => setAddUserOpen(false)}>Cancel</Button>
                      <Button
                        onClick={handleAddUser}
                        disabled={creatingUser || !newUser.email || !newUser.password || newUser.password.length < 6}
                      >
                        {creatingUser ? "Creating..." : "Create User"}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Email</TableHead>
                      <TableHead>Username</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {users.map((u) => (
                      <TableRow key={u.id}>
                        <TableCell>{u.email}</TableCell>
                        <TableCell>{u.username || "-"}</TableCell>
                        <TableCell><Badge variant={u.role === "admin" ? "destructive" : "secondary"}>{u.role}</Badge></TableCell>
                        <TableCell>{new Date(u.created_at).toLocaleDateString()}</TableCell>
                        <TableCell className="text-right">
                          {u.id !== profile?.id && (
                            <>
                              <Button variant="ghost" size="sm" onClick={() => handleUpdateRole(u.id, u.role === "admin" ? "user" : "admin")}>
                                {u.role === "admin" ? "Make User" : "Make Admin"}
                              </Button>
                              <Button variant="ghost" size="sm" className="text-destructive" onClick={() => handleDeleteUser(u.id)}>
                                Delete
                              </Button>
                            </>
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
    </div>
  );
}
