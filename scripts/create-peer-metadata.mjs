import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing SUPABASE env vars. NEXT_PUBLIC_SUPABASE_URL:", !!supabaseUrl, "Key:", !!supabaseKey);
  process.exit(1);
}

console.log("Connecting to Supabase:", supabaseUrl);

const supabase = createClient(supabaseUrl, supabaseKey);

// First check if table already exists by trying a query
const { error: checkError } = await supabase
  .from("peer_metadata")
  .select("id")
  .limit(1);

if (!checkError) {
  console.log("peer_metadata table already exists! No migration needed.");
  process.exit(0);
}

if (checkError && checkError.code !== "42P01") {
  console.log("Table exists but got error:", checkError.message, "code:", checkError.code);
  // Table likely exists with different permissions, that's OK
  process.exit(0);
}

// Table doesn't exist - need to create it
console.log("Table does not exist. Attempting to create via SQL...");

// Try using the SQL endpoint directly
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

CREATE POLICY "Allow all select" ON public.peer_metadata FOR SELECT USING (true);
CREATE POLICY "Allow all insert" ON public.peer_metadata FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow all delete" ON public.peer_metadata FOR DELETE USING (true);
CREATE POLICY "Allow all update" ON public.peer_metadata FOR UPDATE USING (true);
`;

// Use the Supabase REST SQL endpoint
const response = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "apikey": supabaseKey,
    "Authorization": `Bearer ${supabaseKey}`,
  },
  body: JSON.stringify({ query: sqlQuery }),
});

if (response.ok) {
  console.log("peer_metadata table created successfully via RPC!");
} else {
  const errText = await response.text();
  console.log("RPC approach failed:", errText);
  console.log("");
  console.log("=== MANUAL SETUP REQUIRED ===");
  console.log("Please run this SQL in your Supabase SQL Editor:");
  console.log(`URL: ${supabaseUrl.replace('.supabase.co', '')}/project/default/sql`);
  console.log("");
  console.log(sqlQuery);
  console.log("=== END SQL ===");
}
