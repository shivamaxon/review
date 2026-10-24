'use client';
import { signOut } from '@/app/login/actions';
import { CURRENT_OWNER } from '@/lib/associate/storage';
export function AssociateSignOut() { return <form action={signOut} onSubmit={() => { localStorage.removeItem(CURRENT_OWNER); }}><button className="touch-button text-sm text-muted-foreground">Sign out</button></form>; }
