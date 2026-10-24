'use client';
import { createContext, useContext, useEffect, useState, useCallback, useRef, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { saveAssociateEntry, undoAssociateEntry } from '@/lib/associate/actions';
import { CURRENT_OWNER, storageKey, putEntry, removeEntry, pendingEntries, subscribeStorage } from '@/lib/associate/storage';
import type { Bundle, QueuedEntry, EntryResult } from '@/lib/associate/types';
const Context = createContext<{
    data: Bundle;
    submit: (entry: QueuedEntry) => Promise<EntryResult>;
    notice: (message: string, request?: string) => void;
} | null>(null);
export function useAssociate() { const value = useContext(Context); if (!value)
    throw new Error('Associate context missing'); return value; }
export const useHydrated = () => useSyncExternalStore(() => () => { }, () => true, () => false);
const onlineSubscribe = (fn: () => void) => { window.addEventListener('online', fn); window.addEventListener('offline', fn); return () => { window.removeEventListener('online', fn); window.removeEventListener('offline', fn); }; };
export function AssociateRuntime({ data, children }: {
    data: Bundle;
    children: React.ReactNode;
}) {
    const router = useRouter();
    const [toast, setToast] = useState<{
        message: string;
        request?: string;
    } | null>(null);
    const syncing = useRef(false);
    const online = useSyncExternalStore(onlineSubscribe, () => navigator.onLine, () => true);
    const pendingRaw = useSyncExternalStore(subscribeStorage, () => JSON.stringify(pendingEntries(data.owner)), () => '[]');
    const pending = JSON.parse(pendingRaw) as QueuedEntry[];
    const notice = useCallback((message: string, request?: string) => setToast({ message, request }), []);
    const send = useCallback(async (entry: QueuedEntry): Promise<EntryResult> => {
        if (!navigator.onLine)
            return { message: 'Saved on this phone. Pending sync.' };
        try {
            let result = await saveAssociateEntry(entry);
            if (pendingEntries(entry.owner).find(e => e.request_id === entry.request_id)?.undo && !entry.undo)
                return result;
            if (result.duplicate_lead_id && entry.fromPaste) {
                entry = { ...entry, payload: { ...entry.payload, lead_id: result.duplicate_lead_id } };
                putEntry(entry);
                result = await saveAssociateEntry(entry);
            }
            if (result.error || result.duplicate_lead_id) {
                putEntry({ ...entry, error: result.error ?? result.message ?? 'Choose the existing customer.' });
                return result;
            }
            if (!result.id)
                return result;
            removeEntry(entry.owner, entry.request_id);
            if (!result.undone) {
                window.dispatchEvent(new CustomEvent('bro-saved', { detail: { ...result, request_id: entry.request_id } }));
                if (entry.payload.project_id)
                    localStorage.setItem(storageKey(entry.owner, 'last-project'), String(entry.payload.project_id));
            }
            notice(result.undone ? 'Undone.' : 'Saved. Your sheet is up to date.', result.undone ? undefined : entry.request_id);
            if (result.undone) {
                window.dispatchEvent(new CustomEvent('bro-undo', { detail: entry.request_id }));
                router.push('/home');
            }
            router.refresh();
            return result;
        }
        catch {
            // A response can be lost after the DB commits. Retry with the same request ID.
            return { message: 'Connection interrupted. Your entry is safe and pending sync.' };
        }
    }, [notice, router]);
    const submit = useCallback(async (entry: QueuedEntry) => { try {
        putEntry(entry);
    }
    catch {
        return { error: 'Phone storage is full. Keep this form open, reconnect and free some storage before saving.' };
    } const result = await send(entry); if (!result.id && !result.error && !result.duplicate_lead_id)
        notice('Saved on this phone. Pending sync.', entry.request_id); return { ...result, request_id: entry.request_id }; }, [send, notice]);
    const sync = useCallback(async (retryErrors = false) => {
        if (syncing.current || !navigator.onLine)
            return;
        syncing.current = true;
        try {
            for (const entry of pendingEntries(data.owner)) {
                if (entry.error && !retryErrors)
                    continue;
                const r = await send({ ...entry, error: undefined });
                if (!r.id && !r.error && !r.duplicate_lead_id)
                    break;
            }
        }
        finally {
            syncing.current = false;
        }
    }, [data.owner, send]);
    useEffect(() => { try {
        localStorage.setItem(storageKey(data.owner, 'bundle'), JSON.stringify(data));
        localStorage.setItem(CURRENT_OWNER, data.owner);
    }
    catch { /* Draft saving reports storage failures directly. */ } }, [data]);
    useEffect(() => { if (online)
        void sync(); }, [online, sync]);
    useEffect(() => { if (!toast)
        return; const id = setTimeout(() => setToast(null), 15000); return () => clearTimeout(id); }, [toast]);
    return <Context.Provider value={{ data, submit, notice }}>
 <div className="mb-5 flex flex-wrap items-center justify-between gap-2 text-sm"><span className="flex items-center gap-2 text-muted-foreground"><span className={`size-2 rounded-full ${online ? 'bg-emerald-500' : 'bg-orange-500'}`}/>{online ? 'Connected' : 'Offline · drafts stay on this phone'}</span>{pending.length > 0 && <button className="touch-button bg-orange-50 text-orange-900" onClick={() => void sync(true)}>{pending.length} pending sync · Retry</button>}</div>
 {!data.schemaReady && <p className="mb-4 rounded-xl bg-orange-50 p-4 text-orange-900">Entry saving is being set up. You can prepare a draft; it will stay safely on this phone.</p>}
 {pending.some(e => e.error) && <details className="mb-5 rounded-xl border border-orange-200 p-3"><summary className="touch-button">Some saved entries need attention</summary>{pending.filter(e => e.error).map(e => <div className="border-t py-3" key={e.request_id}><p className="font-medium">{String(e.payload.name ?? e.kind)}</p><p>{e.error}</p><div className="flex gap-2"><Link className="touch-button underline" href={e.kind.startsWith('edit_') ? '/my-sheet' : `/log/${e.kind}`}>Open form</Link><button className="touch-button" onClick={() => { if (confirm('Discard this pending entry from this phone?'))
        removeEntry(data.owner, e.request_id); }}>Discard</button></div></div>)}</details>}
 {children}
 {toast && <div role="status" className="fixed inset-x-4 bottom-24 z-50 mx-auto flex max-w-lg items-center justify-between gap-3 rounded-2xl bg-slate-950 p-4 text-white shadow-xl"><span>{toast.message}</span>{toast.request && <button className="touch-button shrink-0 bg-white text-slate-950" onClick={async () => { try {
        const queued = pendingEntries(data.owner).find(e => e.request_id === toast.request);
        if (queued) {
            const cancellation = { ...queued, undo: true, error: undefined };
            putEntry(cancellation);
            window.dispatchEvent(new CustomEvent('bro-undo', { detail: queued.request_id }));
            const outcome = await send(cancellation);
            if (outcome.error)
                notice(outcome.error);
            else if (!outcome.id)
                notice('Undo queued. It will sync when connected.');
            return;
        }
        const r = await undoAssociateEntry(data.owner, toast.request!);
        if (r.error)
            notice(r.error);
        else {
            window.dispatchEvent(new CustomEvent('bro-undo', { detail: toast.request }));
            notice('Undone.');
            router.push('/home');
            router.refresh();
        }
    }
    catch {
        notice('Reconnect to undo. The saved entry is unchanged.');
    } }}>Undo</button>}<button className="touch-button shrink-0" aria-label="Dismiss message" onClick={() => setToast(null)}>×</button></div>}
 </Context.Provider>;
}
