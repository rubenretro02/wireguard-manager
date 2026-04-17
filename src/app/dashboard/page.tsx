'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Logo } from '@/components/Logo';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { useAuthStore, useIPStore, usePricingStore, useSubscriptionStore } from '@/lib/store';
import { daysRemaining, formatDuration, isExpiringSoon, isExpired, calculateEndDate, createPeerConfiguration } from '@/lib/wireguard';
import {
  Shield,
  Globe,
  Download,
  Clock,
  CreditCard,
  LogOut,
  MapPin,
  Zap,
  RefreshCw,
  Copy,
  CheckCircle,
  AlertCircle,
  Plus,
  Settings,
  User,
} from 'lucide-react';

export default function DashboardPage() {
  const router = useRouter();
  const { user, logout, isAuthenticated } = useAuthStore();
  const { getAvailableLocations, getAvailableIPsByLocation, assignIP } = useIPStore();
  const { pricing, getPriceForDuration } = usePricingStore();
  const { subscriptions, getUserSubscriptions, addSubscription } = useSubscriptionStore();

  const [selectedCountry, setSelectedCountry] = useState('');
  const [selectedState, setSelectedState] = useState('');
  const [selectedCity, setSelectedCity] = useState('');
  const [selectedDuration, setSelectedDuration] = useState<'1month' | '3months' | '6months' | '1year'>('1month');
  const [purchaseDialogOpen, setPurchaseDialogOpen] = useState(false);
  const [configDialogOpen, setConfigDialogOpen] = useState(false);
  const [selectedConfig, setSelectedConfig] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login');
    }
  }, [isAuthenticated, router]);

  if (!user) return null;

  const userSubscriptions = getUserSubscriptions(user.id);
  const activeSubscriptions = userSubscriptions.filter((s) => s.status === 'active');
  const locations = getAvailableLocations();

  const countries = [...new Set(locations.map((l) => l.country))];
  const states = selectedCountry
    ? [...new Set(locations.filter((l) => l.country === selectedCountry).map((l) => l.state))]
    : [];
  const cities = selectedCountry && selectedState
    ? [...new Set(locations.filter((l) => l.country === selectedCountry && l.state === selectedState).map((l) => l.city))]
    : [];

  const selectedPrice = getPriceForDuration(selectedDuration);
  const availableIPs = selectedCountry && selectedState && selectedCity
    ? getAvailableIPsByLocation(selectedCountry, selectedState, selectedCity)
    : [];

  const handlePurchase = () => {
    if (!selectedCountry || !selectedState || !selectedCity || availableIPs.length === 0) return;

    // Get random available IP
    const randomIndex = Math.floor(Math.random() * availableIPs.length);
    const ip = availableIPs[randomIndex];

    // Assign IP to user
    const assignedIP = assignIP(ip.id, user.id);
    if (!assignedIP) return;

    // Create peer configuration
    const peerConfig = createPeerConfiguration(assignedIP.ipAddress);

    // Create subscription
    const startDate = new Date();
    const endDate = calculateEndDate(startDate, selectedDuration);

    addSubscription({
      userId: user.id,
      ipId: assignedIP.id,
      peerId: `peer-${Date.now()}`,
      startDate,
      endDate,
      duration: selectedDuration,
      status: 'active',
      autoRenew: false,
      price: selectedPrice?.finalPrice || 40,
      peerConfig: peerConfig.config,
    });

    setPurchaseDialogOpen(false);
    setSelectedCountry('');
    setSelectedState('');
    setSelectedCity('');
  };

  const copyConfig = (config: string) => {
    navigator.clipboard.writeText(config);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const downloadConfig = (config: string, index: number) => {
    const blob = new Blob([config], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `blackgott-vpn-${index + 1}.conf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-black">
      {/* Header */}
      <header className="border-b border-zinc-800 bg-zinc-900/50 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <Logo size="md" />
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-sm text-zinc-400">
              <User size={16} />
              <span>{user.name}</span>
            </div>
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
        <div className="grid md:grid-cols-3 gap-6 mb-8">
          <Card className="bg-zinc-900/50 border-zinc-800">
            <CardContent className="p-6">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-emerald-500/10 flex items-center justify-center">
                  <Shield className="w-6 h-6 text-emerald-400" />
                </div>
                <div>
                  <p className="text-sm text-zinc-400">Active VPNs</p>
                  <p className="text-2xl font-bold text-white">{activeSubscriptions.length}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-zinc-900/50 border-zinc-800">
            <CardContent className="p-6">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-emerald-500/10 flex items-center justify-center">
                  <Globe className="w-6 h-6 text-emerald-400" />
                </div>
                <div>
                  <p className="text-sm text-zinc-400">Available Locations</p>
                  <p className="text-2xl font-bold text-white">{locations.length}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-zinc-900/50 border-zinc-800">
            <CardContent className="p-6">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-emerald-500/10 flex items-center justify-center">
                  <Zap className="w-6 h-6 text-emerald-400" />
                </div>
                <div>
                  <p className="text-sm text-zinc-400">Protocol</p>
                  <p className="text-2xl font-bold text-white">WireGuard</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Purchase New VPN */}
        <Card className="bg-zinc-900/50 border-zinc-800 mb-8">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-white">Get New VPN</CardTitle>
                <CardDescription className="text-zinc-400">
                  Purchase a new dedicated residential IP
                </CardDescription>
              </div>
              <Dialog open={purchaseDialogOpen} onOpenChange={setPurchaseDialogOpen}>
                <DialogTrigger asChild>
                  <Button className="btn-primary">
                    <Plus size={16} className="mr-2" />
                    New Purchase
                  </Button>
                </DialogTrigger>
                <DialogContent className="bg-zinc-900 border-zinc-800 text-white max-w-lg">
                  <DialogHeader>
                    <DialogTitle>Purchase New VPN</DialogTitle>
                    <DialogDescription className="text-zinc-400">
                      Select your preferred location and subscription plan
                    </DialogDescription>
                  </DialogHeader>

                  <div className="space-y-4 mt-4">
                    <div className="space-y-2">
                      <label className="text-sm text-zinc-300">Country</label>
                      <Select value={selectedCountry} onValueChange={(v) => {
                        setSelectedCountry(v);
                        setSelectedState('');
                        setSelectedCity('');
                      }}>
                        <SelectTrigger className="bg-zinc-800 border-zinc-700">
                          <SelectValue placeholder="Select country" />
                        </SelectTrigger>
                        <SelectContent className="bg-zinc-800 border-zinc-700">
                          {countries.map((country) => (
                            <SelectItem key={country} value={country}>
                              {country}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {selectedCountry && (
                      <div className="space-y-2">
                        <label className="text-sm text-zinc-300">State</label>
                        <Select value={selectedState} onValueChange={(v) => {
                          setSelectedState(v);
                          setSelectedCity('');
                        }}>
                          <SelectTrigger className="bg-zinc-800 border-zinc-700">
                            <SelectValue placeholder="Select state" />
                          </SelectTrigger>
                          <SelectContent className="bg-zinc-800 border-zinc-700">
                            {states.map((state) => (
                              <SelectItem key={state} value={state}>
                                {state}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}

                    {selectedState && (
                      <div className="space-y-2">
                        <label className="text-sm text-zinc-300">City</label>
                        <Select value={selectedCity} onValueChange={setSelectedCity}>
                          <SelectTrigger className="bg-zinc-800 border-zinc-700">
                            <SelectValue placeholder="Select city" />
                          </SelectTrigger>
                          <SelectContent className="bg-zinc-800 border-zinc-700">
                            {cities.map((city) => (
                              <SelectItem key={city} value={city}>
                                {city}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}

                    <div className="space-y-2">
                      <label className="text-sm text-zinc-300">Subscription Plan</label>
                      <Select value={selectedDuration} onValueChange={(v) => setSelectedDuration(v as typeof selectedDuration)}>
                        <SelectTrigger className="bg-zinc-800 border-zinc-700">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-zinc-800 border-zinc-700">
                          {pricing.filter((p) => p.isActive).map((plan) => (
                            <SelectItem key={plan.id} value={plan.duration}>
                              <div className="flex items-center justify-between gap-4">
                                <span>{plan.name}</span>
                                <span className="text-emerald-400">
                                  ${plan.finalPrice}
                                  {plan.discount > 0 && (
                                    <span className="text-xs text-zinc-500 ml-1">
                                      (-{plan.discount}%)
                                    </span>
                                  )}
                                </span>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {selectedCity && availableIPs.length > 0 && (
                      <div className="p-4 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                        <div className="flex items-center gap-2 text-emerald-400">
                          <CheckCircle size={16} />
                          <span>{availableIPs.length} IPs available in {selectedCity}</span>
                        </div>
                      </div>
                    )}

                    {selectedCity && availableIPs.length === 0 && (
                      <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/20">
                        <div className="flex items-center gap-2 text-red-400">
                          <AlertCircle size={16} />
                          <span>No IPs available in this location</span>
                        </div>
                      </div>
                    )}

                    <div className="pt-4 border-t border-zinc-800">
                      <div className="flex items-center justify-between mb-4">
                        <span className="text-zinc-400">Total</span>
                        <span className="text-2xl font-bold text-white">
                          ${selectedPrice?.finalPrice || 40}
                        </span>
                      </div>
                      <Button
                        className="w-full btn-primary"
                        disabled={!selectedCity || availableIPs.length === 0}
                        onClick={handlePurchase}
                      >
                        <CreditCard size={16} className="mr-2" />
                        Pay with Crypto
                      </Button>
                      <p className="text-xs text-zinc-500 text-center mt-2">
                        Powered by Cryptomus
                      </p>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </CardHeader>
        </Card>

        {/* Active Subscriptions */}
        <Card className="bg-zinc-900/50 border-zinc-800">
          <CardHeader>
            <CardTitle className="text-white">Your VPNs</CardTitle>
            <CardDescription className="text-zinc-400">
              Manage your active VPN subscriptions
            </CardDescription>
          </CardHeader>
          <CardContent>
            {activeSubscriptions.length === 0 ? (
              <div className="text-center py-12">
                <Shield className="w-12 h-12 text-zinc-600 mx-auto mb-4" />
                <p className="text-zinc-400 mb-4">You don't have any active VPNs yet</p>
                <Button className="btn-primary" onClick={() => setPurchaseDialogOpen(true)}>
                  <Plus size={16} className="mr-2" />
                  Get Your First VPN
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                {activeSubscriptions.map((sub, index) => {
                  const days = daysRemaining(sub.endDate);
                  const totalDays = sub.duration === '1month' ? 30 : sub.duration === '3months' ? 90 : sub.duration === '6months' ? 180 : 365;
                  const progress = ((totalDays - days) / totalDays) * 100;
                  const expiringSoon = isExpiringSoon(sub.endDate);

                  return (
                    <div
                      key={sub.id}
                      className="p-4 rounded-lg bg-zinc-800/50 border border-zinc-700"
                    >
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                            <Shield className="w-5 h-5 text-emerald-400" />
                          </div>
                          <div>
                            <p className="font-medium text-white">VPN #{index + 1}</p>
                            <p className="text-sm text-zinc-400">{formatDuration(sub.duration)}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {expiringSoon && (
                            <Badge className="bg-yellow-500/20 text-yellow-400 border-none">
                              Expiring Soon
                            </Badge>
                          )}
                          <Badge className="bg-emerald-500/20 text-emerald-400 border-none">
                            Active
                          </Badge>
                        </div>
                      </div>

                      <div className="mb-4">
                        <div className="flex items-center justify-between text-sm mb-2">
                          <span className="text-zinc-400">Time Remaining</span>
                          <span className="text-white">{days} days</span>
                        </div>
                        <Progress value={100 - progress} className="h-2" />
                      </div>

                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="flex-1 border-zinc-700 hover:bg-zinc-700"
                          onClick={() => {
                            setSelectedConfig(sub.peerConfig || '');
                            setConfigDialogOpen(true);
                          }}
                        >
                          <Settings size={14} className="mr-2" />
                          View Config
                        </Button>
                        <Button
                          size="sm"
                          className="flex-1 btn-primary"
                          onClick={() => downloadConfig(sub.peerConfig || '', index)}
                        >
                          <Download size={14} className="mr-2" />
                          Download
                        </Button>
                        {expiringSoon && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-yellow-500/50 text-yellow-400 hover:bg-yellow-500/10"
                          >
                            <RefreshCw size={14} className="mr-2" />
                            Renew
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Config Dialog */}
        <Dialog open={configDialogOpen} onOpenChange={setConfigDialogOpen}>
          <DialogContent className="bg-zinc-900 border-zinc-800 text-white max-w-lg">
            <DialogHeader>
              <DialogTitle>WireGuard Configuration</DialogTitle>
              <DialogDescription className="text-zinc-400">
                Copy or download your VPN configuration file
              </DialogDescription>
            </DialogHeader>
            <div className="mt-4">
              <div className="relative">
                <pre className="p-4 rounded-lg bg-zinc-800 text-sm text-zinc-300 overflow-x-auto mono">
                  {selectedConfig}
                </pre>
                <Button
                  size="sm"
                  variant="ghost"
                  className="absolute top-2 right-2"
                  onClick={() => copyConfig(selectedConfig)}
                >
                  {copied ? (
                    <CheckCircle size={16} className="text-emerald-400" />
                  ) : (
                    <Copy size={16} />
                  )}
                </Button>
              </div>
              <p className="text-xs text-zinc-500 mt-4">
                Import this configuration into your WireGuard client to connect.
              </p>
            </div>
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
}
