import type { Metadata } from "next";
import { Button } from "@/components/ui/button";
import { signOut } from "@/app/login/actions";

export const metadata: Metadata = { title: "No access" };

export default function NoAccess() {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm space-y-4 text-center">
        <h1 className="text-xl font-semibold">Your account isn&apos;t set up yet</h1>
        <p className="text-sm text-muted-foreground">
          You signed in, but there is no team profile for you. Ask your branch admin to add you under Admin → Team.
        </p>
        <form action={signOut}><Button variant="outline" className="h-10">Sign out</Button></form>
      </div>
    </main>
  );
}
