'use server';
import { requireProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { validateEntry } from './common';
import type { EntryResult, QueuedEntry } from './types';
export async function saveAssociateEntry(entry: QueuedEntry): Promise<EntryResult> {
    const profile = await requireProfile();
    if (entry.owner !== profile.id)
        return { error: 'This saved draft belongs to a different account. Sign in to its owner to sync.' };
    if (entry.undo) {
        const db = await createClient();
        const { error } = await db.rpc('associate_undo', { p_request_id: entry.request_id });
        if (error)
            return { error: error.message };
        revalidatePath('/', 'layout');
        return { id: entry.request_id, request_id: entry.request_id, undone: true };
    }
    const errors = validateEntry(entry.kind, entry.payload);
    if (errors.length)
        return { error: errors.join(' ') };
    if (JSON.stringify(entry.payload).length > 64000)
        return { error: 'This entry is too long. Split it into smaller updates.' };
    const db = await createClient();
    const { data, error } = await db.rpc('associate_save', { p_kind: entry.kind, p_payload: entry.payload, p_request_id: entry.request_id });
    if (error && /fetch failed|timeout|network|ECONN/i.test(error.message))
        return { message: 'Connection interrupted. Your entry remains pending sync.' };
    if (error)
        return { error: error.code === 'PGRST202' ? 'Entry saving is being set up. Your draft is safe; try again after setup finishes.' : error.message };
    for (const path of ['/home', '/my-sheet', '/leads', '/partners'])
        revalidatePath(path, 'layout');
    return data as EntryResult;
}
export async function undoAssociateEntry(owner: string, requestId: string): Promise<{
    error?: string;
}> {
    const profile = await requireProfile();
    if (profile.id !== owner)
        return { error: 'Sign in to the account that saved this entry.' };
    const db = await createClient();
    const { error } = await db.rpc('associate_undo', { p_request_id: requestId });
    if (error)
        return { error: error.message };
    revalidatePath('/', 'layout');
    return {};
}
