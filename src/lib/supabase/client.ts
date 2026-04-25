import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

  // During build time, return a mock client if env vars are not set
  if (!supabaseUrl || !supabaseAnonKey) {
    if (typeof window === "undefined") {
      // Server-side during build - return a dummy client
      return {
        auth: {
          getUser: () => Promise.resolve({ data: { user: null }, error: null }),
          signOut: () => Promise.resolve({ error: null }),
          signInWithOAuth: () => Promise.resolve({ data: null, error: null }),
          onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
        },
        from: () => ({
          select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: null, error: null }), data: null, error: null }), data: null, error: null }),
          insert: () => Promise.resolve({ data: null, error: null }),
          update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }),
          delete: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }),
          upsert: () => Promise.resolve({ data: null, error: null }),
        }),
      } as ReturnType<typeof createBrowserClient>;
    }
  }

  return createBrowserClient(supabaseUrl, supabaseAnonKey);
}
