'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Logo } from '@/components/Logo';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Shield,
  Zap,
  Globe,
  Lock,
  Server,
  CheckCircle,
  ArrowRight,
  Wifi,
  MapPin,
  Clock,
  CreditCard,
  Sparkles,
  ChevronDown,
} from 'lucide-react';

const features = [
  {
    icon: Shield,
    title: 'Real Dedicated IP',
    description: 'Your own exclusive residential IP address. Never shared, always fresh.',
  },
  {
    icon: Globe,
    title: 'Global Locations',
    description: 'Choose from multiple countries, states, and cities worldwide.',
  },
  {
    icon: Zap,
    title: 'WireGuard Protocol',
    description: 'Next-generation VPN protocol. Faster, lighter, more secure.',
  },
  {
    icon: Lock,
    title: 'Military-Grade Encryption',
    description: 'State-of-the-art cryptography protects your data at all times.',
  },
  {
    icon: Server,
    title: 'Fresh Residential IPs',
    description: 'Clean IPs from real ISPs. No datacenter detection.',
  },
  {
    icon: Clock,
    title: 'Instant Activation',
    description: 'Your VPN is ready within seconds after payment.',
  },
];

const pricingPlans = [
  {
    duration: '1 Month',
    price: 40,
    discount: 0,
    popular: false,
  },
  {
    duration: '3 Months',
    price: 108,
    originalPrice: 120,
    discount: 10,
    popular: true,
  },
  {
    duration: '6 Months',
    price: 204,
    originalPrice: 240,
    discount: 15,
    popular: false,
  },
  {
    duration: '1 Year',
    price: 384,
    originalPrice: 480,
    discount: 20,
    popular: false,
  },
];

const testimonials = [
  {
    name: 'Alex M.',
    role: 'Security Researcher',
    content: 'Finally a VPN with real residential IPs. No more captchas or blocks.',
  },
  {
    name: 'Sarah K.',
    role: 'Digital Nomad',
    content: 'WireGuard makes it blazing fast. Best investment for my privacy.',
  },
  {
    name: 'Mike R.',
    role: 'Developer',
    content: 'Clean IPs, instant setup, and excellent uptime. Highly recommended.',
  },
];

export default function LandingPage() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 50);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <div className="min-h-screen bg-black">
      {/* Navigation */}
      <nav
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
          scrolled ? 'bg-black/80 backdrop-blur-xl border-b border-zinc-800' : ''
        }`}
      >
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <Logo size="md" />
          <div className="flex items-center gap-4">
            <Link href="/login">
              <Button variant="ghost" className="text-zinc-400 hover:text-white">
                Login
              </Button>
            </Link>
            <Link href="/register">
              <Button className="btn-primary">
                Get Started
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative min-h-screen flex items-center justify-center overflow-hidden">
        {/* Background Effects */}
        <div className="absolute inset-0 grid-pattern opacity-30" />
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-emerald-500/5 rounded-full blur-3xl" />

        <div className="relative z-10 max-w-6xl mx-auto px-6 text-center pt-24">
          <Badge className="mb-6 bg-emerald-500/10 text-emerald-400 border-emerald-500/20 px-4 py-2">
            <Sparkles className="w-4 h-4 mr-2" />
            Now Available - Real Residential IPs
          </Badge>

          <h1 className="text-5xl md:text-7xl font-bold mb-6 leading-tight">
            <span className="text-white">Real Dedicated</span>
            <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-green-500 glow-text">
              Fresh Residential IP
            </span>
          </h1>

          <p className="text-xl md:text-2xl text-zinc-400 mb-8 max-w-3xl mx-auto">
            Premium VPN service with exclusive residential IPs.
            Powered by WireGuard protocol for maximum speed and security.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-12">
            <Link href="/register">
              <Button size="lg" className="btn-primary text-lg px-8 py-6">
                Start Now - $40/month
                <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </Link>
            <Link href="#pricing">
              <Button size="lg" variant="outline" className="text-lg px-8 py-6 border-zinc-700 hover:border-emerald-500/50">
                View Pricing
              </Button>
            </Link>
          </div>

          <div className="flex items-center justify-center gap-8 text-sm text-zinc-500">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-emerald-500" />
              <span>No Logs Policy</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-emerald-500" />
              <span>Crypto Payments</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-emerald-500" />
              <span>Instant Setup</span>
            </div>
          </div>

          <div className="mt-16 animate-bounce">
            <ChevronDown className="w-8 h-8 text-zinc-600 mx-auto" />
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-24 relative">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <Badge className="mb-4 bg-zinc-800 text-zinc-400 border-zinc-700">
              Why Choose Us
            </Badge>
            <h2 className="text-4xl md:text-5xl font-bold text-white mb-4">
              Premium Features
            </h2>
            <p className="text-xl text-zinc-400 max-w-2xl mx-auto">
              Everything you need for ultimate privacy and unrestricted access.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((feature, index) => (
              <Card
                key={index}
                className="bg-zinc-900/50 border-zinc-800 card-hover group"
              >
                <CardContent className="p-6">
                  <div className="w-12 h-12 rounded-xl bg-emerald-500/10 flex items-center justify-center mb-4 group-hover:bg-emerald-500/20 transition-colors">
                    <feature.icon className="w-6 h-6 text-emerald-400" />
                  </div>
                  <h3 className="text-xl font-semibold text-white mb-2">
                    {feature.title}
                  </h3>
                  <p className="text-zinc-400">{feature.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-24 bg-zinc-900/30">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <Badge className="mb-4 bg-zinc-800 text-zinc-400 border-zinc-700">
              Simple Process
            </Badge>
            <h2 className="text-4xl md:text-5xl font-bold text-white mb-4">
              How It Works
            </h2>
          </div>

          <div className="grid md:grid-cols-4 gap-8">
            {[
              { step: '01', icon: CreditCard, title: 'Create Account', desc: 'Sign up in seconds' },
              { step: '02', icon: MapPin, title: 'Choose Location', desc: 'Select your preferred city' },
              { step: '03', icon: Wifi, title: 'Pay with Crypto', desc: 'Secure anonymous payment' },
              { step: '04', icon: Shield, title: 'Connect & Enjoy', desc: 'Download config & connect' },
            ].map((item, index) => (
              <div key={index} className="text-center">
                <div className="relative mb-6">
                  <div className="text-6xl font-bold text-zinc-800">{item.step}</div>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center">
                      <item.icon className="w-8 h-8 text-emerald-400" />
                    </div>
                  </div>
                </div>
                <h3 className="text-xl font-semibold text-white mb-2">{item.title}</h3>
                <p className="text-zinc-400">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section id="pricing" className="py-24">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <Badge className="mb-4 bg-emerald-500/10 text-emerald-400 border-emerald-500/20">
              Pricing Plans
            </Badge>
            <h2 className="text-4xl md:text-5xl font-bold text-white mb-4">
              Choose Your Plan
            </h2>
            <p className="text-xl text-zinc-400">
              Save up to 20% with longer subscriptions
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {pricingPlans.map((plan, index) => (
              <Card
                key={index}
                className={`relative overflow-hidden ${
                  plan.popular
                    ? 'bg-gradient-to-b from-emerald-500/10 to-zinc-900 border-emerald-500/30'
                    : 'bg-zinc-900/50 border-zinc-800'
                } card-hover`}
              >
                {plan.popular && (
                  <div className="absolute top-0 left-0 right-0 bg-emerald-500 text-black text-center py-1 text-sm font-semibold">
                    MOST POPULAR
                  </div>
                )}
                <CardContent className={`p-6 ${plan.popular ? 'pt-10' : ''}`}>
                  <h3 className="text-xl font-semibold text-white mb-2">
                    {plan.duration}
                  </h3>
                  {plan.discount > 0 && (
                    <Badge className="mb-2 bg-emerald-500/20 text-emerald-400 border-none">
                      Save {plan.discount}%
                    </Badge>
                  )}
                  <div className="my-4">
                    {plan.originalPrice && (
                      <span className="text-zinc-500 line-through text-lg mr-2">
                        ${plan.originalPrice}
                      </span>
                    )}
                    <span className="text-4xl font-bold text-white">${plan.price}</span>
                    <span className="text-zinc-400 ml-1">
                      {plan.duration === '1 Month' ? '/mo' : ''}
                    </span>
                  </div>
                  <ul className="space-y-3 mb-6">
                    <li className="flex items-center gap-2 text-zinc-300">
                      <CheckCircle className="w-4 h-4 text-emerald-500" />
                      Dedicated Residential IP
                    </li>
                    <li className="flex items-center gap-2 text-zinc-300">
                      <CheckCircle className="w-4 h-4 text-emerald-500" />
                      WireGuard Protocol
                    </li>
                    <li className="flex items-center gap-2 text-zinc-300">
                      <CheckCircle className="w-4 h-4 text-emerald-500" />
                      Unlimited Bandwidth
                    </li>
                    <li className="flex items-center gap-2 text-zinc-300">
                      <CheckCircle className="w-4 h-4 text-emerald-500" />
                      Auto-Renew Option
                    </li>
                  </ul>
                  <Link href="/register">
                    <Button
                      className={`w-full ${
                        plan.popular
                          ? 'btn-primary'
                          : 'bg-zinc-800 hover:bg-zinc-700 text-white'
                      }`}
                    >
                      Get Started
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="py-24 bg-zinc-900/30">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <Badge className="mb-4 bg-zinc-800 text-zinc-400 border-zinc-700">
              Testimonials
            </Badge>
            <h2 className="text-4xl md:text-5xl font-bold text-white mb-4">
              Trusted by Thousands
            </h2>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            {testimonials.map((testimonial, index) => (
              <Card key={index} className="bg-zinc-900/50 border-zinc-800">
                <CardContent className="p-6">
                  <div className="flex items-center gap-1 mb-4">
                    {[...Array(5)].map((_, i) => (
                      <Sparkles key={i} className="w-4 h-4 text-emerald-400 fill-emerald-400" />
                    ))}
                  </div>
                  <p className="text-zinc-300 mb-4">"{testimonial.content}"</p>
                  <div>
                    <p className="font-semibold text-white">{testimonial.name}</p>
                    <p className="text-sm text-zinc-500">{testimonial.role}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-24">
        <div className="max-w-4xl mx-auto px-6 text-center">
          <div className="gradient-border rounded-2xl p-12 glow-green">
            <h2 className="text-4xl md:text-5xl font-bold text-white mb-4">
              Ready to Get Started?
            </h2>
            <p className="text-xl text-zinc-400 mb-8">
              Join thousands of users enjoying real privacy with dedicated residential IPs.
            </p>
            <Link href="/register">
              <Button size="lg" className="btn-primary text-lg px-12 py-6">
                Create Your Account
                <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-zinc-800 py-12">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <Logo size="sm" />
            <div className="flex items-center gap-6 text-sm text-zinc-500">
              <span>vpn.blackgott.com</span>
              <span>|</span>
              <span>Secure. Private. Fast.</span>
            </div>
            <p className="text-sm text-zinc-600">
              © 2024 BlackGott VPN. All rights reserved.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
