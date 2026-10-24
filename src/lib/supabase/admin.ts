import "server-only"; // build fails if this file is ever imported into browser code
import { createClient } from "@supabase/supabase-js";

/**
 * SERVICE-ROLE client. Bypasses Row Level Security. Server-only.
 * Use ONLY after you have verified the caller's role yourself (see src/lib/auth.ts requireRole).
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
