# BlackGott VPN - Development Todos

## Completed
- [x] Project setup with Next.js + shadcn/ui
- [x] Landing page with marketing content
- [x] Client registration and login system
- [x] Client dashboard with VPN purchase flow
- [x] Admin dashboard with IP management
- [x] Pricing management system (customizable from admin)
- [x] Subscription tracking with auto-disable
- [x] WireGuard configuration generator
- [x] Cryptomus payment API integration (demo mode)
- [x] Store management with Zustand (persisted)
- [x] Logo and branding

## Configuration Required (for Production)
- [ ] Set CRYPTOMUS_MERCHANT_ID in environment
- [ ] Set CRYPTOMUS_API_KEY in environment
- [ ] Configure real WireGuard server endpoint
- [ ] Set up database (currently using localStorage)

## How to Use

### Admin Access
- Email: admin@blackgott.com
- Password: admin123

### Features
1. **Landing Page**: Marketing with pricing
2. **Client Flow**: Register → Select Location → Choose Plan → Pay → Get Config
3. **Admin Flow**: Add IPs → Set Location → Manage Pricing → Monitor Subscriptions

### Pricing (Customizable in Admin)
- 1 Month: $40
- 3 Months: $108 (10% off)
- 6 Months: $204 (15% off)
- 1 Year: $384 (20% off)

### Domain
- vpn.blackgott.com
