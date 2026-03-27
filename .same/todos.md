# WireGuard Manager - Tasks

## Completed ✅

- [x] Fix privacy issue: Remove total peer count shown to users who can't see all peers
- [x] Fix capabilities update: Create dedicated API endpoint with service role support
- [x] Fix auto-login on user creation: Return error if service role not configured instead of auto-logging in
- [x] Create migration script v5 for RLS policy fixes
- [x] Update README with configuration instructions

## Requirements for Full Functionality

1. **SUPABASE_SERVICE_ROLE_KEY** must be set in environment variables for:
   - Creating users without auto-login
   - Updating user capabilities

2. **Run Migration V5** in Supabase SQL Editor:
   - `scripts/migration-v5-fix-capabilities-rls.sql`

## Changes Made (March 27, 2026)

### Dashboard (`src/app/dashboard/page.tsx`)
- Removed "of X" from peer count for non-admin users to prevent information leakage

### Admin API (`src/app/api/users/route.ts`)
- Now returns clear error if service role key not configured
- Better error handling for user creation

### New Capabilities API (`src/app/api/users/capabilities/route.ts`)
- New dedicated endpoint for updating user capabilities
- Uses service role client to bypass RLS
- Validates capabilities before saving

### Admin Page (`src/app/admin/page.tsx`)
- Uses new capabilities API endpoint
- Better error messages for service role issues

### Documentation
- Updated README with complete setup instructions
- Added troubleshooting section
