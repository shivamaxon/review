import type { Bundle, QueuedEntry } from './types';
export const CURRENT_OWNER = 'bro:current-owner';
export const storageKey = (owner: string, part: string) => `bro:v1:${owner}:${part}`;
export function signal() { window.dispatchEvent(new Event('bro-store')); }
export function putEntry(entry: QueuedEntry) { localStorage.setItem(storageKey(entry.owner, `entry:${entry.request_id}`), JSON.stringify(entry)); signal(); }
export function removeEntry(owner: string, id: string) { localStorage.removeItem(storageKey(owner, `entry:${id}`)); signal(); }
export function pendingEntries(owner: string): QueuedEntry[] {
    if (typeof localStorage === 'undefined')
        return [];
    const prefix = storageKey(owner, 'entry:');
    return Object.keys(localStorage).filter(k => k.startsWith(prefix)).map(k => { try {
        return JSON.parse(localStorage.getItem(k)!) as QueuedEntry;
    }
    catch {
        return null;
    } }).filter((x): x is QueuedEntry => !!x).sort((a, b) => a.created_at.localeCompare(b.created_at));
}
export function savedBundle(): Bundle | null { try {
    const owner = localStorage.getItem(CURRENT_OWNER);
    return owner ? JSON.parse(localStorage.getItem(storageKey(owner, 'bundle')) ?? 'null') : null;
}
catch {
    return null;
} }
export function subscribeStorage(fn: () => void) { window.addEventListener('storage', fn); window.addEventListener('bro-store', fn); return () => { window.removeEventListener('storage', fn); window.removeEventListener('bro-store', fn); }; }
