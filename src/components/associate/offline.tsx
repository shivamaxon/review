'use client';
import { useState } from 'react';
import Link from 'next/link';
import { savedBundle } from '@/lib/associate/storage';
import { AssociateRuntime, useHydrated } from './runtime';
import { EntryForm } from './entry-form';
export function OfflineScreen() { const hydrated = useHydrated(); return hydrated ? <LoadedOffline /> : <p>Opening your saved workspace…</p>; }
function LoadedOffline() { const [data] = useState(savedBundle); const [kind, setKind] = useState<'customer' | 'cp' | 'booking'>('customer'); if (!data)
    return <div className="associate-card space-y-4"><h1 className="text-2xl font-semibold">You’re offline</h1><p>Connect and sign in once to prepare this phone for offline entry. Your saved drafts will stay on this phone.</p><Link className="touch-button bg-teal-700 text-white" href="/home">Reconnect & sign in</Link></div>; return <AssociateRuntime data={data}><header className="mb-5 space-y-3"><h1 className="text-xl font-semibold">AXON · Your offline workspace</h1><p className="text-sm">Hello, {data.name.split(' ')[0]}. Keep logging. We’ll sync to your account when the connection returns.</p><div className="flex flex-wrap gap-2">{(['customer', 'cp', 'booking'] as const).map(k => <button className="chip capitalize" aria-pressed={kind === k} key={k} onClick={() => setKind(k)}>{k === 'customer' ? 'Customer meeting' : k === 'cp' ? 'CP meeting' : 'Booking'}</button>)}</div><Link className="touch-button underline" href="/home">Return to Today</Link></header><EntryForm key={kind} kind={kind}/></AssociateRuntime>; }
