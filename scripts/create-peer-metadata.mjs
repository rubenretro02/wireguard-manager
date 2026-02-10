import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing SUPABASE env vars");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const { error } = await supabase.rpc("exec_sql", {
  query: `
    CREATE TABLE IF NOT EXISTS peer_metadata (
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

    ALTER TABLE peer_metadata ENABLE ROW LEVEL SECURITY;

    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Anyone can read peer metadata') THEN
        CREATE POLICY "Anyone can read peer metadata" ON peer_metadata FOR SELECT USING (true);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Anyone can insert peer metadata') THEN
        CREATE POLICY "Anyone can insert peer metadata" ON peer_metadata FOR INSERT WITH CHECK (true);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Anyone can delete peer metadata') THEN
        CREATE POLICY "Anyone can delete peer metadata" ON peer_metadata FOR DELETE USING (true);
      END IF;
    END $$;

    CREATE INDEX IF NOT EXISTS idx_peer_metadata_router ON peer_metadata(router_id);
    CREATE INDEX IF NOT EXISTS idx_peer_metadata_key ON peer_metadata(peer_public_key);
  `,
});

if (error) {
  // If exec_sql doesn't exist, try direct table creation via REST
  console.log("RPC not available, trying direct approach...");

  // Check if table already exists
  const { data, error: checkError } = await supabase
    .from("peer_metadata")
    .select("id")
    .limit(1);

  if (checkError && checkError.code === "42P01") {
    console.log("Table does not exist. Please run the SQL in scripts/create-peer-metadata-table.sql manually in the Supabase SQL Editor.");
    console.log("URL:", `${supabaseUrl}/project/default/sql`);
  } else if (checkError) {
    console.log("Table check error:", checkError.message);
  } else {
    console.log("peer_metadata table already exists!");
  }
} else {
  console.log("peer_metadata table created successfully!");
}
