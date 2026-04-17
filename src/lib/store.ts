import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User, IPForSale, Subscription, Pricing, Payment, Order, Location } from './types';

// Mock data for demo
const defaultPricing: Pricing[] = [
  { id: '1', name: '1 Month', duration: '1month', basePrice: 40, discount: 0, finalPrice: 40, isActive: true },
  { id: '2', name: '3 Months', duration: '3months', basePrice: 120, discount: 10, finalPrice: 108, isActive: true },
  { id: '3', name: '6 Months', duration: '6months', basePrice: 240, discount: 15, finalPrice: 204, isActive: true },
  { id: '4', name: '1 Year', duration: '1year', basePrice: 480, discount: 20, finalPrice: 384, isActive: true },
];

const mockIPs: IPForSale[] = [
  { id: '1', ipAddress: '192.168.1.100', country: 'United States', state: 'California', city: 'Los Angeles', isAvailable: true, isSold: false, price: 40, createdAt: new Date() },
  { id: '2', ipAddress: '192.168.1.101', country: 'United States', state: 'California', city: 'San Francisco', isAvailable: true, isSold: false, price: 40, createdAt: new Date() },
  { id: '3', ipAddress: '192.168.1.102', country: 'United States', state: 'New York', city: 'New York City', isAvailable: true, isSold: false, price: 40, createdAt: new Date() },
  { id: '4', ipAddress: '192.168.1.103', country: 'United States', state: 'Texas', city: 'Houston', isAvailable: true, isSold: false, price: 40, createdAt: new Date() },
  { id: '5', ipAddress: '192.168.1.104', country: 'Germany', state: 'Bavaria', city: 'Munich', isAvailable: true, isSold: false, price: 40, createdAt: new Date() },
  { id: '6', ipAddress: '192.168.1.105', country: 'Germany', state: 'Berlin', city: 'Berlin', isAvailable: true, isSold: false, price: 40, createdAt: new Date() },
  { id: '7', ipAddress: '192.168.1.106', country: 'United Kingdom', state: 'England', city: 'London', isAvailable: true, isSold: false, price: 40, createdAt: new Date() },
  { id: '8', ipAddress: '192.168.1.107', country: 'Canada', state: 'Ontario', city: 'Toronto', isAvailable: true, isSold: false, price: 40, createdAt: new Date() },
];

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<boolean>;
  register: (email: string, password: string, name: string) => Promise<boolean>;
  logout: () => void;
}

interface IPState {
  ips: IPForSale[];
  addIP: (ip: Omit<IPForSale, 'id' | 'createdAt'>) => void;
  updateIP: (id: string, updates: Partial<IPForSale>) => void;
  deleteIP: (id: string) => void;
  getAvailableLocations: () => Location[];
  getAvailableIPsByLocation: (country: string, state: string, city: string) => IPForSale[];
  assignIP: (ipId: string, userId: string) => IPForSale | null;
}

interface PricingState {
  pricing: Pricing[];
  updatePricing: (id: string, updates: Partial<Pricing>) => void;
  getPriceForDuration: (duration: '1month' | '3months' | '6months' | '1year') => Pricing | undefined;
}

interface SubscriptionState {
  subscriptions: Subscription[];
  addSubscription: (sub: Omit<Subscription, 'id'>) => Subscription;
  updateSubscription: (id: string, updates: Partial<Subscription>) => void;
  getUserSubscriptions: (userId: string) => Subscription[];
  checkExpiredSubscriptions: () => void;
}

interface OrderState {
  orders: Order[];
  addOrder: (order: Omit<Order, 'id' | 'createdAt'>) => Order;
  updateOrder: (id: string, updates: Partial<Order>) => void;
  getUserOrders: (userId: string) => Order[];
}

interface PaymentState {
  payments: Payment[];
  addPayment: (payment: Omit<Payment, 'id' | 'createdAt'>) => Payment;
  updatePayment: (id: string, updates: Partial<Payment>) => void;
}

// Auth Store
export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      isAuthenticated: false,
      login: async (email: string, password: string) => {
        // Demo admin login
        if (email === 'admin@blackgott.com' && password === 'admin123') {
          set({
            user: {
              id: 'admin-1',
              email: 'admin@blackgott.com',
              name: 'Admin',
              role: 'admin',
              createdAt: new Date(),
              balance: 0,
            },
            isAuthenticated: true,
          });
          return true;
        }
        // Demo client login / auto-register
        if (email && password) {
          set({
            user: {
              id: `user-${Date.now()}`,
              email,
              name: email.split('@')[0],
              role: 'client',
              createdAt: new Date(),
              balance: 0,
            },
            isAuthenticated: true,
          });
          return true;
        }
        return false;
      },
      register: async (email: string, password: string, name: string) => {
        set({
          user: {
            id: `user-${Date.now()}`,
            email,
            name,
            role: 'client',
            createdAt: new Date(),
            balance: 0,
          },
          isAuthenticated: true,
        });
        return true;
      },
      logout: () => set({ user: null, isAuthenticated: false }),
    }),
    { name: 'blackgott-auth' }
  )
);

// IP Store
export const useIPStore = create<IPState>()(
  persist(
    (set, get) => ({
      ips: mockIPs,
      addIP: (ip) => {
        const newIP: IPForSale = {
          ...ip,
          id: `ip-${Date.now()}`,
          createdAt: new Date(),
        };
        set((state) => ({ ips: [...state.ips, newIP] }));
      },
      updateIP: (id, updates) => {
        set((state) => ({
          ips: state.ips.map((ip) => (ip.id === id ? { ...ip, ...updates } : ip)),
        }));
      },
      deleteIP: (id) => {
        set((state) => ({ ips: state.ips.filter((ip) => ip.id !== id) }));
      },
      getAvailableLocations: () => {
        const ips = get().ips.filter((ip) => ip.isAvailable && !ip.isSold);
        const locationMap = new Map<string, Location>();

        for (const ip of ips) {
          const key = `${ip.country}-${ip.state}-${ip.city}`;
          const existing = locationMap.get(key);
          if (existing) {
            existing.availableCount++;
          } else {
            locationMap.set(key, {
              country: ip.country,
              state: ip.state,
              city: ip.city,
              availableCount: 1,
            });
          }
        }

        return Array.from(locationMap.values());
      },
      getAvailableIPsByLocation: (country, state, city) => {
        return get().ips.filter(
          (ip) =>
            ip.isAvailable &&
            !ip.isSold &&
            ip.country === country &&
            ip.state === state &&
            ip.city === city
        );
      },
      assignIP: (ipId, userId) => {
        const ip = get().ips.find((i) => i.id === ipId);
        if (ip && ip.isAvailable && !ip.isSold) {
          set((state) => ({
            ips: state.ips.map((i) =>
              i.id === ipId ? { ...i, isSold: true, isAvailable: false, assignedTo: userId } : i
            ),
          }));
          return { ...ip, isSold: true, isAvailable: false, assignedTo: userId };
        }
        return null;
      },
    }),
    { name: 'blackgott-ips' }
  )
);

// Pricing Store
export const usePricingStore = create<PricingState>()(
  persist(
    (set, get) => ({
      pricing: defaultPricing,
      updatePricing: (id, updates) => {
        set((state) => ({
          pricing: state.pricing.map((p) => {
            if (p.id === id) {
              const updated = { ...p, ...updates };
              // Recalculate final price
              updated.finalPrice = updated.basePrice * (1 - updated.discount / 100);
              return updated;
            }
            return p;
          }),
        }));
      },
      getPriceForDuration: (duration) => {
        return get().pricing.find((p) => p.duration === duration && p.isActive);
      },
    }),
    { name: 'blackgott-pricing' }
  )
);

// Subscription Store
export const useSubscriptionStore = create<SubscriptionState>()(
  persist(
    (set, get) => ({
      subscriptions: [],
      addSubscription: (sub) => {
        const newSub: Subscription = {
          ...sub,
          id: `sub-${Date.now()}`,
        };
        set((state) => ({ subscriptions: [...state.subscriptions, newSub] }));
        return newSub;
      },
      updateSubscription: (id, updates) => {
        set((state) => ({
          subscriptions: state.subscriptions.map((s) =>
            s.id === id ? { ...s, ...updates } : s
          ),
        }));
      },
      getUserSubscriptions: (userId) => {
        return get().subscriptions.filter((s) => s.userId === userId);
      },
      checkExpiredSubscriptions: () => {
        const now = new Date();
        set((state) => ({
          subscriptions: state.subscriptions.map((s) => {
            if (s.status === 'active' && new Date(s.endDate) < now) {
              return { ...s, status: 'expired' };
            }
            return s;
          }),
        }));
      },
    }),
    { name: 'blackgott-subscriptions' }
  )
);

// Order Store
export const useOrderStore = create<OrderState>()(
  persist(
    (set, get) => ({
      orders: [],
      addOrder: (order) => {
        const newOrder: Order = {
          ...order,
          id: `order-${Date.now()}`,
          createdAt: new Date(),
        };
        set((state) => ({ orders: [...state.orders, newOrder] }));
        return newOrder;
      },
      updateOrder: (id, updates) => {
        set((state) => ({
          orders: state.orders.map((o) => (o.id === id ? { ...o, ...updates } : o)),
        }));
      },
      getUserOrders: (userId) => {
        return get().orders.filter((o) => o.userId === userId);
      },
    }),
    { name: 'blackgott-orders' }
  )
);

// Payment Store
export const usePaymentStore = create<PaymentState>()(
  persist(
    (set, get) => ({
      payments: [],
      addPayment: (payment) => {
        const newPayment: Payment = {
          ...payment,
          id: `pay-${Date.now()}`,
          createdAt: new Date(),
        };
        set((state) => ({ payments: [...state.payments, newPayment] }));
        return newPayment;
      },
      updatePayment: (id, updates) => {
        set((state) => ({
          payments: state.payments.map((p) => (p.id === id ? { ...p, ...updates } : p)),
        }));
      },
    }),
    { name: 'blackgott-payments' }
  )
);
