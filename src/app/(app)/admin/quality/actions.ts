'use server';
import { requireRole } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { EDIT_FIELDS, recordTable } from '@/lib/quality';
export async function qualityAction(_previous: {
    error?: string;
    success?: string;
}, form: FormData): Promise<{
    error?: string;
    success?: string;
}> {
    await requireRole(['branch_admin', 'super_admin']);
    const action = String(form.get('action') || '');
    const patch: Record<string, unknown> = {};
    if (action === 'fix') {
        const table = String(form.get('table'));
        const field = String(form.get('field'));
        if (!recordTable(table) || !EDIT_FIELDS[table].includes(field))
            return { error: 'Choose a valid field' };
        const raw = String(form.get('value') ?? '').trim();
        patch[field] = field === 'plot_names' ? raw.split('|').map(x => x.trim()).filter(Boolean) : field === 'value' ? (raw ? Number(raw) : null) : raw || null;
        if (field === 'value' && raw && !Number.isFinite(patch[field]))
            return { error: 'Enter a valid amount' };
    }
    const db = await createClient();
    const { error } = await db.rpc('resolve_quality_issue', { p_issue: form.get('issue'), p_action: action, p_record: form.get('record') || null, p_patch: patch, p_assignee: form.get('assignee') || null });
    if (error)
        return { error: error.message };
    revalidatePath('/admin/quality');
    revalidatePath('/explorer');
    revalidatePath('/command');
    revalidatePath('/home');
    return { success: action === 'assign' ? 'Assigned.' : 'Saved.' };
}
