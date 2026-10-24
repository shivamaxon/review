"use client";
import type { TeamResult } from "./actions";

/** Shown once, right after create / reset. The admin passes it to the person (WhatsApp, in person). */
export function TempPassword({ result }: { result: NonNullable<TeamResult> }) {
  return (
    <div role="status" className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
      <div className="font-medium">{result.ok}</div>
      <div className="mt-1 text-muted-foreground">
        Share this with them now. It is shown only once, and they must replace it on first login.
      </div>
      <div className="mt-2 grid gap-1 font-mono text-sm">
        <div>Login: <span className="select-all">{result.email}</span></div>
        <div>Temporary password: <span className="select-all font-semibold" data-testid="temp-password">{result.tempPassword}</span></div>
      </div>
    </div>
  );
}
