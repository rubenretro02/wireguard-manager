import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing SUPABASE env vars. NEXT_PUBLIC_SUPABASE_URL:", !!supabaseUrl, "Key:", !!supabaseKey);
  process.exit(1);
}

console.log("Connecting to Supabase:", supabaseUrl);
const supabase = createClient(supabaseUrl, supabaseKey);

// Check if table already exists
const { error: checkError } = await supabase
  .from("peer_metadata")
  .select("id")
  .limit(1);

if (!checkError) {
  console.log("peer_metadata table already exists! No migration needed.");
  process.exit(0);
}

console.log("Check error code:", checkError.code, checkError.message);

if (checkError.code !== "42P01" && !checkError.message.includes("does not exist")) {
  console.log("Table may already exist with restricted access. Proceeding...");
  process.exit(0);
}

// Table doesn't exist - create it via SQL
console.log("Table does not exist. Creating via rpc...");

const sqlQuery = `
CREATE TABLE IF NOT EXISTS public.peer_metadata (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  router_id TEXT NOT NULL,
  peer_public_key TEXT NOT NULL,
  peer_name TEXT,
  peer_interface TEXT,
  allowed_address TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  created_by_email TEXT,
  created_by_user_id UUID,
  UNIQUE(router_id, peer_public_key)
);

ALTER TABLE public.peer_metadata ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'peer_metadata' AND policyname = 'allow_all_select_peer_metadata') THEN
    CREATE POLICY allow_all_select_peer_metadata ON public.peer_metadata FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'peer_metadata' AND policyname = 'allow_all_insert_peer_metadata') THEN
    CREATE POLICY allow_all_insert_peer_metadata ON public.peer_metadata FOR INSERT WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'peer_metadata' AND policyname = 'allow_all_delete_peer_metadata') THEN
    CREATE POLICY allow_all_delete_peer_metadata ON public.peer_metadata FOR DELETE USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'peer_metadata' AND policyname = 'allow_all_update_peer_metadata') THEN
    CREATE POLICY allow_all_update_peer_metadata ON public.peer_metadata FOR UPDATE USING (true);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_peer_metadata_router ON public.peer_metadata(router_id);
CREATE INDEX IF NOT EXISTS idx_peer_metadata_peer_key ON public.peer_metadata(peer_public_key);
`;

// Try the Supabase SQL RPC endpoint
const res = await fetch(`${supabaseUrl}/rest/v1/rpc/`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "apikey": supabaseKey,
    "Authorization": `Bearer ${supabaseKey}`,
    "Prefer": "return=minimal",
  },
  body: JSON.stringify({ query: sqlQuery }),
});

if (res.ok) {
  console.log("Table created successfully via RPC!");
  process.exit(0);
}

// Fallback: Try the pg_net approach or just print the SQL
console.log("RPC not available. Please run this SQL manually in your Supabase SQL Editor:");
console.log("Go to: https://supabase.com/dashboard/project/YOUR_PROJECT/sql/new");
console.log("");
console.log(sqlQuery);
console.log("");
console.log("After running the SQL, the Created By and Created At columns will work automatically.");
