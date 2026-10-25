import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic gate + session refresh. NOT the security boundary:
 * real authorization happens in src/lib/auth.ts (server) and Row Level Security (database).
 */
export async function proxy(request: NextRequest) {
  // Public shell contains no signed-in data; it must load before a session exists.
  if (["/offline", "/auth/admin-access"].includes(request.nextUrl.pathname)) return NextResponse.next();
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet) => {
          toSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          toSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  const { data } = await supabase.auth.getClaims();
  const signedIn = !!data?.claims;
  const path = request.nextUrl.pathname;

  if (!signedIn && path !== "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  if (signedIn && path === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // Forced password change: anyone flagged must_change_password can only see /change-password until it is done.
  // (Optimistic gate; src/lib/auth.ts re-checks on every page, so this is never the only lock.)
  if (signedIn && path !== "/change-password") {
    const { data: me } = await supabase
      .from("profiles")
      .select("must_change_password")
      .eq("id", String(data!.claims.sub))
      .maybeSingle();
    if (me?.must_change_password) {
      const url = request.nextUrl.clone();
      url.pathname = "/change-password";
      url.search = "";
      return NextResponse.redirect(url);
    }
  }
  return response;
}

export const config = {
  // Everything except static assets, the PWA files and the icons (these must load while signed out).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|icons/|.*\\.(?:png|jpg|jpeg|svg|webp|ico)$).*)"],
};
