"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export type NavItem = { href: string; label: string };

export function NavLinks({ items, variant }: { items: NavItem[]; variant: "top" | "bottom" }) {
  const pathname = usePathname();
  return (
    <>
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(item.href + "/");
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              variant === "top"
                ? "inline-flex min-h-12 items-center rounded-md px-3 text-sm font-medium whitespace-nowrap hover:bg-muted"
                : "flex min-h-14 flex-1 items-center justify-center px-1 text-center text-xs font-medium",
              active ? "text-primary" : "text-muted-foreground",
              variant === "top" && active && "bg-muted",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </>
  );
}
