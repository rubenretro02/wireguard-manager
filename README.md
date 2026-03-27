# WireGuard Manager

A modern web application for managing WireGuard VPN peers on MikroTik routers with user management, capabilities, and public IP assignment.

## Features

- **Multi-Router Support**: Manage multiple MikroTik routers from a single dashboard
- **User Management**: Create users with different roles (admin/user) and capabilities
- **Peer Management**: Create, edit, enable/disable, and delete WireGuard peers
- **Public IP Management**: Assign public IPs to peers with NAT rules
- **User Capabilities**:
  - `can_auto_expire`: Allow users to set expiration times on peers
  - `can_see_all_peers`: Allow users to view all peers (not just their own)
  - `can_use_restricted_ips`: Allow users to use restricted IP addresses
- **Peer Metadata**: Track who created each peer, when, and expiration status

## Prerequisites

- Node.js 18+ or Bun
- Supabase account (for authentication and database)
- MikroTik router(s) with RouterOS 7.x+ and REST API enabled

## Environment Variables

Create a `.env.local` file with the following variables:

```env
# Supabase Configuration (Required)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key

# Supabase Service Role Key (REQUIRED for admin features)
# This is needed for:
# - Creating users without auto-login
# - Updating user capabilities
# - Admin operations that bypass RLS
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

### Getting the Service Role Key

1. Go to your Supabase dashboard
2. Navigate to Project Settings → API
3. Copy the `service_role` key (keep this secret!)
4. Add it to your `.env.local` file

⚠️ **Important**: Without the `SUPABASE_SERVICE_ROLE_KEY`:
- Creating new users will fail or cause auto-login issues
- Updating user capabilities may not work
- Some admin operations will be restricted

## Database Setup

Run these SQL migrations in your Supabase SQL Editor in order:

1. `scripts/create-peer-metadata-table.sql`
2. `scripts/migration-v2.sql`
3. `scripts/migration-v3-restricted-ips.sql`
4. `scripts/migration-v4-capabilities.sql`
5. `scripts/migration-v5-fix-capabilities-rls.sql`

## Getting Started

```bash
# Install dependencies
bun install

# Run development server
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser.

## Deployment

### Netlify (Recommended)

The project includes a `netlify.toml` for easy deployment. Make sure to set all environment variables in your Netlify dashboard.

### Other Platforms

This is a Next.js project that can be deployed on any platform supporting Next.js:
- Vercel
- AWS Amplify
- Self-hosted with Node.js

## Router Configuration

For each MikroTik router:

1. Enable REST API:
   ```
   /ip/service set www-ssl port=443 disabled=no
   ```

2. Create a dedicated user with WireGuard access:
   ```
   /user add name=wgmanager password=secure-password group=full
   ```

3. Configure IP prefixes in the router settings within the app

## Troubleshooting

### "Service role key required" error
Make sure `SUPABASE_SERVICE_ROLE_KEY` is set in your environment variables.

### Users can't see their capabilities
Run `migration-v5-fix-capabilities-rls.sql` to update RLS policies.

### Auto-login when creating users
This happens when `SUPABASE_SERVICE_ROLE_KEY` is not configured. Set this key to fix the issue.

## License

MIT
