import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/** Server client acting AS THE SIGNED-IN USER (Row Level Security applies). */
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet) => {
          try {
            toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Called from a Server Component: cookies can't be written there. proxy.ts refreshes the session.
          }
        },
      },
    },
  );
}
