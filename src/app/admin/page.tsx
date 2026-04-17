'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Logo } from '@/components/Logo';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuthStore, useIPStore, usePricingStore, useSubscriptionStore } from '@/lib/store';
import {
  Shield,
  Globe,
  Users,
  DollarSign,
  LogOut,
  Plus,
  Trash2,
  Edit,
  Server,
  MapPin,
  Settings,
  TrendingUp,
  Clock,
  CheckCircle,
  XCircle,
} from 'lucide-react';

export default function AdminDashboard() {
  const router = useRouter();
  const { user, logout, isAuthenticated } = useAuthStore();
  const { ips, addIP, updateIP, deleteIP } = useIPStore();
  const { pricing, updatePricing } = usePricingStore();
  const { subscriptions } = useSubscriptionStore();

  const [addIPDialogOpen, setAddIPDialogOpen] = useState(false);
  const [newIP, setNewIP] = useState({
    ipAddress: '',
    country: '',
    state: '',
    city: '',
    price: 40,
  });

  useEffect(() => {
    if (!isAuthenticated || user?.role !== 'admin') {
      router.push('/login');
    }
  }, [isAuthenticated, user, router]);

  if (!user || user.role !== 'admin') return null;

  const totalIPs = ips.length;
  const availableIPs = ips.filter((ip) => ip.isAvailable && !ip.isSold).length;
  const soldIPs = ips.filter((ip) => ip.isSold).length;
  const activeSubscriptions = subscriptions.filter((s) => s.status === 'active').length;
  const totalRevenue = subscriptions.reduce((acc, s) => acc + s.price, 0);

  const handleAddIP = () => {
    if (!newIP.ipAddress || !newIP.country || !newIP.state || !newIP.city) return;

    addIP({
      ipAddress: newIP.ipAddress,
      country: newIP.country,
      state: newIP.state,
      city: newIP.city,
      price: newIP.price,
      isAvailable: true,
      isSold: false,
    });

    setNewIP({
      ipAddress: '',
      country: '',
      state: '',
      city: '',
      price: 40,
    });
    setAddIPDialogOpen(false);
  };

  return (
    <div className="min-h-screen bg-black">
      {/* Header */}
      <header className="border-b border-zinc-800 bg-zinc-900/50 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Logo size="md" />
            <Badge className="bg-red-500/20 text-red-400 border-red-500/30">Admin</Badge>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-zinc-400">{user.email}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                logout();
                router.push('/');
              }}
              className="text-zinc-400 hover:text-white"
            >
              <LogOut size={16} className="mr-2" />
              Logout
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Stats */}
        <div className="grid md:grid-cols-5 gap-4 mb-8">
          <Card className="bg-zinc-900/50 border-zinc-800">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                  <Server className="w-5 h-5 text-emerald-400" />
                </div>
                <div>
                  <p className="text-xs text-zinc-400">Total IPs</p>
                  <p className="text-xl font-bold text-white">{totalIPs}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-zinc-900/50 border-zinc-800">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                  <Globe className="w-5 h-5 text-blue-400" />
                </div>
                <div>
                  <p className="text-xs text-zinc-400">Available</p>
                  <p className="text-xl font-bold text-white">{availableIPs}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-zinc-900/50 border-zinc-800">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-yellow-500/10 flex items-center justify-center">
                  <CheckCircle className="w-5 h-5 text-yellow-400" />
                </div>
                <div>
                  <p className="text-xs text-zinc-400">Sold</p>
                  <p className="text-xl font-bold text-white">{soldIPs}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-zinc-900/50 border-zinc-800">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center">
                  <Users className="w-5 h-5 text-purple-400" />
                </div>
                <div>
                  <p className="text-xs text-zinc-400">Active Subs</p>
                  <p className="text-xl font-bold text-white">{activeSubscriptions}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-zinc-900/50 border-zinc-800">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center">
                  <DollarSign className="w-5 h-5 text-green-400" />
                </div>
                <div>
                  <p className="text-xs text-zinc-400">Revenue</p>
                  <p className="text-xl font-bold text-white">${totalRevenue}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="ips" className="space-y-6">
          <TabsList className="bg-zinc-800 border border-zinc-700">
            <TabsTrigger value="ips" className="data-[state=active]:bg-emerald-500 data-[state=active]:text-black">
              <Server size={16} className="mr-2" />
              IPs for Sale
            </TabsTrigger>
            <TabsTrigger value="pricing" className="data-[state=active]:bg-emerald-500 data-[state=active]:text-black">
              <DollarSign size={16} className="mr-2" />
              Pricing
            </TabsTrigger>
            <TabsTrigger value="subscriptions" className="data-[state=active]:bg-emerald-500 data-[state=active]:text-black">
              <Shield size={16} className="mr-2" />
              Subscriptions
            </TabsTrigger>
          </TabsList>

          {/* IPs Tab */}
          <TabsContent value="ips">
            <Card className="bg-zinc-900/50 border-zinc-800">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-white">IPs for Sale</CardTitle>
                    <CardDescription className="text-zinc-400">
                      Manage available residential IPs
                    </CardDescription>
                  </div>
                  <Dialog open={addIPDialogOpen} onOpenChange={setAddIPDialogOpen}>
                    <DialogTrigger asChild>
                      <Button className="btn-primary">
                        <Plus size={16} className="mr-2" />
                        Add IP
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="bg-zinc-900 border-zinc-800 text-white">
                      <DialogHeader>
                        <DialogTitle>Add New IP</DialogTitle>
                        <DialogDescription className="text-zinc-400">
                          Add a new residential IP for sale
                        </DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4 mt-4">
                        <div className="space-y-2">
                          <Label className="text-zinc-300">IP Address</Label>
                          <Input
                            placeholder="192.168.1.100"
                            value={newIP.ipAddress}
                            onChange={(e) => setNewIP({ ...newIP, ipAddress: e.target.value })}
                            className="bg-zinc-800 border-zinc-700"
                          />
                        </div>
                        <div className="grid grid-cols-3 gap-4">
                          <div className="space-y-2">
                            <Label className="text-zinc-300">Country</Label>
                            <Input
                              placeholder="United States"
                              value={newIP.country}
                              onChange={(e) => setNewIP({ ...newIP, country: e.target.value })}
                              className="bg-zinc-800 border-zinc-700"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label className="text-zinc-300">State</Label>
                            <Input
                              placeholder="California"
                              value={newIP.state}
                              onChange={(e) => setNewIP({ ...newIP, state: e.target.value })}
                              className="bg-zinc-800 border-zinc-700"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label className="text-zinc-300">City</Label>
                            <Input
                              placeholder="Los Angeles"
                              value={newIP.city}
                              onChange={(e) => setNewIP({ ...newIP, city: e.target.value })}
                              className="bg-zinc-800 border-zinc-700"
                            />
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label className="text-zinc-300">Price ($/month)</Label>
                          <Input
                            type="number"
                            value={newIP.price}
                            onChange={(e) => setNewIP({ ...newIP, price: Number(e.target.value) })}
                            className="bg-zinc-800 border-zinc-700"
                          />
                        </div>
                        <Button className="w-full btn-primary" onClick={handleAddIP}>
                          <Plus size={16} className="mr-2" />
                          Add IP
                        </Button>
                      </div>
                    </DialogContent>
                  </Dialog>
                </div>
              </CardHeader>
              <CardContent>
                <div className="rounded-lg border border-zinc-800 overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-zinc-800 hover:bg-zinc-800/50">
                        <TableHead className="text-zinc-400">IP Address</TableHead>
                        <TableHead className="text-zinc-400">Location</TableHead>
                        <TableHead className="text-zinc-400">Status</TableHead>
                        <TableHead className="text-zinc-400">Price</TableHead>
                        <TableHead className="text-zinc-400 text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {ips.map((ip) => (
                        <TableRow key={ip.id} className="border-zinc-800 hover:bg-zinc-800/30">
                          <TableCell className="font-mono text-white">{ip.ipAddress}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2 text-zinc-300">
                              <MapPin size={14} className="text-zinc-500" />
                              {ip.city}, {ip.state}, {ip.country}
                            </div>
                          </TableCell>
                          <TableCell>
                            {ip.isSold ? (
                              <Badge className="bg-yellow-500/20 text-yellow-400 border-none">
                                Sold
                              </Badge>
                            ) : ip.isAvailable ? (
                              <Badge className="bg-emerald-500/20 text-emerald-400 border-none">
                                Available
                              </Badge>
                            ) : (
                              <Badge className="bg-red-500/20 text-red-400 border-none">
                                Unavailable
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-white">${ip.price}/mo</TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-2">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-zinc-400 hover:text-white"
                                onClick={() => updateIP(ip.id, { isAvailable: !ip.isAvailable })}
                              >
                                {ip.isAvailable ? <XCircle size={16} /> : <CheckCircle size={16} />}
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-red-400 hover:text-red-300"
                                onClick={() => deleteIP(ip.id)}
                              >
                                <Trash2 size={16} />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Pricing Tab */}
          <TabsContent value="pricing">
            <Card className="bg-zinc-900/50 border-zinc-800">
              <CardHeader>
                <CardTitle className="text-white">Pricing Plans</CardTitle>
                <CardDescription className="text-zinc-400">
                  Customize your subscription pricing
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
                  {pricing.map((plan) => (
                    <div
                      key={plan.id}
                      className="p-4 rounded-lg bg-zinc-800/50 border border-zinc-700"
                    >
                      <h3 className="font-semibold text-white mb-2">{plan.name}</h3>
                      <div className="space-y-3">
                        <div>
                          <Label className="text-xs text-zinc-400">Base Price ($)</Label>
                          <Input
                            type="number"
                            value={plan.basePrice}
                            onChange={(e) =>
                              updatePricing(plan.id, { basePrice: Number(e.target.value) })
                            }
                            className="bg-zinc-900 border-zinc-700 h-8 text-sm"
                          />
                        </div>
                        <div>
                          <Label className="text-xs text-zinc-400">Discount (%)</Label>
                          <Input
                            type="number"
                            value={plan.discount}
                            onChange={(e) =>
                              updatePricing(plan.id, { discount: Number(e.target.value) })
                            }
                            className="bg-zinc-900 border-zinc-700 h-8 text-sm"
                          />
                        </div>
                        <div className="pt-2 border-t border-zinc-700">
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-zinc-400">Final Price</span>
                            <span className="text-lg font-bold text-emerald-400">
                              ${plan.finalPrice.toFixed(2)}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Subscriptions Tab */}
          <TabsContent value="subscriptions">
            <Card className="bg-zinc-900/50 border-zinc-800">
              <CardHeader>
                <CardTitle className="text-white">Active Subscriptions</CardTitle>
                <CardDescription className="text-zinc-400">
                  Monitor all customer subscriptions
                </CardDescription>
              </CardHeader>
              <CardContent>
                {subscriptions.length === 0 ? (
                  <div className="text-center py-12">
                    <Shield className="w-12 h-12 text-zinc-600 mx-auto mb-4" />
                    <p className="text-zinc-400">No subscriptions yet</p>
                  </div>
                ) : (
                  <div className="rounded-lg border border-zinc-800 overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow className="border-zinc-800 hover:bg-zinc-800/50">
                          <TableHead className="text-zinc-400">ID</TableHead>
                          <TableHead className="text-zinc-400">User</TableHead>
                          <TableHead className="text-zinc-400">Duration</TableHead>
                          <TableHead className="text-zinc-400">Status</TableHead>
                          <TableHead className="text-zinc-400">Price</TableHead>
                          <TableHead className="text-zinc-400">End Date</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {subscriptions.map((sub) => (
                          <TableRow key={sub.id} className="border-zinc-800 hover:bg-zinc-800/30">
                            <TableCell className="font-mono text-white text-xs">
                              {sub.id.slice(0, 12)}...
                            </TableCell>
                            <TableCell className="text-zinc-300">{sub.userId}</TableCell>
                            <TableCell className="text-zinc-300">{sub.duration}</TableCell>
                            <TableCell>
                              <Badge
                                className={
                                  sub.status === 'active'
                                    ? 'bg-emerald-500/20 text-emerald-400 border-none'
                                    : sub.status === 'expired'
                                    ? 'bg-red-500/20 text-red-400 border-none'
                                    : 'bg-yellow-500/20 text-yellow-400 border-none'
                                }
                              >
                                {sub.status}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-white">${sub.price}</TableCell>
                            <TableCell className="text-zinc-400">
                              {new Date(sub.endDate).toLocaleDateString()}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
