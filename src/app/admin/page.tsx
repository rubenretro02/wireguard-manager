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
  UserCheck,
  Lock,
  LockOpen,
  Clock,
  User
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
  const [profile, setProfile] = useState&lt;Profile | null&gt;(null);
  const [routers, setRouters] = useState&lt;Router[]&gt;([]);
  const [users, setUsers] = useState&lt;Profile[]&gt;([]);
  const [publicIps, setPublicIps] = useState&lt;PublicIP[]&gt;([]);
  const [userRouters, setUserRouters] = useState&lt;UserRouterWithRelations[]&gt;([]);
  const [loading, setLoading] = useState(true);

  // Router states
  const [addRouterOpen, setAddRouterOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [testingId, setTestingId] = useState&lt;string | null&gt;(null);
  const [editingRouter, setEditingRouter] = useState&lt;Router | null&gt;(null);
  const [editRouterOpen, setEditRouterOpen] = useState(false);
  const [wgInterfaces, setWgInterfaces] = useState&lt;WireGuardInterface[]&gt;([]);
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
  const [selectedRouterForIps, setSelectedRouterForIps] = useState&lt;string&gt;("");
  const [addIpOpen, setAddIpOpen] = useState(false);
  const [newIpNumber, setNewIpNumber] = useState("");
  const [addingIp, setAddingIp] = useState(false);
  const [importing, setImporting] = useState(false);
  const [savingImported, setSavingImported] = useState(false);
  const [detectedIps, setDetectedIps] = useState&lt;DetectedIp[]&gt;([]);
  const [partiallyConfiguredIps, setPartiallyConfiguredIps] = useState&lt;DetectedIp[]&gt;([]);
  const [natTraffic, setNatTraffic] = useState&lt;Record&lt;number, NatTraffic&gt;&gt;({});
  const [loadingTraffic, setLoadingTraffic] = useState(false);
  const [creatingRulesFor, setCreatingRulesFor] = useState&lt;number | null&gt;(null);
  const [ipSearchQuery, setIpSearchQuery] = useState("");
  const [peersByIp, setPeersByIp] = useState&lt;Record&lt;string, { count: number; names: string[]; peers: Array&lt;{ id: string; name: string; address: string }&gt; }&gt;&gt;({});

  // Peers detail modal
  const [peersModalOpen, setPeersModalOpen] = useState(false);
  const [selectedIpForPeers, setSelectedIpForPeers] = useState&lt;PublicIP | null&gt;(null);
  const [selectedIpPeers, setSelectedIpPeers] = useState&lt;Array&lt;{ id: string; name: string; address: string }&gt;&gt;([]);

  // User Router Access states
  const [addAccessOpen, setAddAccessOpen] = useState(false);
  const [newAccess, setNewAccess] = useState({ user_id: "", router_id: "" });
  const [addingAccess, setAddingAccess] = useState(false);

  // ... rest of the component
}
