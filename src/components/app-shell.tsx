import Link from "next/link";
import { AssociateSignOut } from "@/components/associate/sign-out";
import { Badge } from "@/components/ui/badge";
import { ROLE_LABEL, isAdmin, isReviewer, type Profile } from "@/lib/types";
import { NavLinks, type NavItem } from "@/components/nav-links";

function navFor(p: Profile): NavItem[] {
  const items: NavItem[] = [];
  if (isReviewer(p.role)) items.push({ href: "/command", label: "Command" });
  items.push({ href: "/home", label: "Today" }, { href: "/leads", label: "Customers" }, { href: "/partners", label: "CPs" }, { href: "/my-sheet", label: "My Sheet" });
  if (isReviewer(p.role)) items.push({ href: "/explorer", label: "Explorer" });
  if (isAdmin(p.role)) items.push({ href: "/admin/quality", label: "Quality" }, { href: "/admin/team", label: "Team" });
  return items;
}

export function AppShell({ profile, children }: { profile: Profile; children: React.ReactNode }) {
  const items = navFor(profile);
  const phoneItems = items.filter(i=>["/command","/home","/leads","/partners","/my-sheet"].includes(i.href));
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-7xl items-center gap-2 px-4">
          <Link href="/" className="font-semibold tracking-tight"><span className="text-teal-800">AXON</span><span className="ml-2 hidden text-xs font-normal text-muted-foreground xl:inline">Branch Review</span></Link>
          <nav aria-label="Main" className="ml-4 hidden gap-1 overflow-x-auto md:flex">
            <NavLinks items={items} variant="top" />
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <div className="hidden text-right leading-tight sm:block">
              <div className="text-sm font-medium">{profile.full_name}</div>
              <div className="text-xs text-muted-foreground">{profile.branch_name}</div>
            </div>
            <Badge variant="secondary">{ROLE_LABEL[profile.role]}</Badge>
            <AssociateSignOut />
            {isReviewer(profile.role)&&<details className="relative md:hidden"><summary className="touch-button">More</summary><div className="absolute right-0 top-14 z-40 min-w-48 rounded-xl border bg-background p-2 shadow-lg">{items.filter(i=>!phoneItems.includes(i)).map(i=><Link key={i.href} href={i.href} className="touch-button w-full justify-start">{i.label}</Link>)}</div></details>}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 pb-24 md:pb-8">{children}</main>

      {/* phones: thumb-reachable bottom tabs */}
      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-20 border-t bg-background pb-[env(safe-area-inset-bottom)] md:hidden">
        <div className="mx-auto flex max-w-5xl">
          <NavLinks items={phoneItems} variant="bottom" />
        </div>
      </nav>
    </div>
  );
}
