import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { recordTable, displayValue } from '@/lib/quality';
import { IssueActions } from './issue-actions';
export default async function QualityPage({ searchParams }: {
    searchParams: Promise<{
        history?: string;
        status?: string;
    }>;
}) {
    await requireRole(['branch_admin', 'super_admin']);
    const params = await searchParams;
    const db = await createClient();
    let query = db.from('data_quality_issues').select('*').is('deleted_at', null).order('legacy_key').limit(1000);
    if (params.history === 'hide')
        query = query.eq('is_historical', false);
    if (params.status !== 'all')
        query = query.eq('status', 'open');
    const [{ data: issues, error }, { data: people, error: peopleError }] = await Promise.all([query, db.from('profiles').select('id,full_name,branch_id').eq('active', true).in('role', ['associate', 'team_lead']).is('deleted_at', null)]);
    if (error || peopleError)
        throw new Error(error?.message || peopleError?.message);
    const grouped = new Map<string, typeof issues>();
    for (const q of [...(issues ?? [])].sort((a, b) => Number(b.issue_type === 'plot_double_booked') - Number(a.issue_type === 'plot_double_booked') || ['fix', 'review', 'info'].indexOf(a.severity) - ['fix', 'review', 'info'].indexOf(b.severity) || a.issue_type.localeCompare(b.issue_type))) {
        const key = `${q.severity} · ${q.issue_type}`;
        grouped.set(key, [...(grouped.get(key) ?? []), q]);
    }
    // Fetch each table once through RLS, then render the competing records side by side.
    const records = new Map<string, Record<string, unknown>>();
    for (const table of new Set((issues ?? []).map(q => String(q.table_name)))) {
        if (!recordTable(table))
            continue;
        const ids = [...new Set((issues ?? []).filter(q => q.table_name === table).flatMap(q => q.record_ids as string[]))];
        if (!ids.length)
            continue;
        const res = await db.rpc('record_read',{p_table:table,p_ids:ids,p_include_deleted:true});
        if (res.error)
            throw res.error;
        for (const r of res.data ?? [])
            records.set(r.id, r);
    }
    return <div className="space-y-6"><h1 className="text-2xl font-semibold">Data quality inbox</h1>
 <p>{issues?.length ?? 0} issues · Fix data, confirm it is correct, or assign someone to investigate.</p>
 <form className="flex flex-wrap items-center gap-3"><label>History <select name="history" defaultValue={params.history ?? 'show'} className="h-11 rounded border px-2"><option value="show">Include historical rows</option><option value="hide">Hide historical rows</option></select></label>
 <select aria-label="Issue status" name="status" defaultValue={params.status ?? 'open'} className="h-11 rounded border px-2"><option value="open">Open issues</option><option value="all">All statuses</option></select><button className="h-11 rounded border px-4">Apply</button></form>
 {[...grouped].map(([group, items]) => <section key={group} className="space-y-4"><h2 className="text-lg font-semibold capitalize">{group.replaceAll('_', ' ')}</h2>{items?.map(q => {
                const table = String(q.table_name);
                if (!recordTable(table))
                    return null;
                const rows = (q.record_ids as string[]).map(id => records.get(id)).filter((r): r is Record<string, unknown> => !!r);
                return <article id={q.legacy_key} key={q.id} className="space-y-4 rounded-lg border p-4"><div className="flex flex-wrap justify-between gap-2"><strong>{q.legacy_key} · {q.status}</strong><span className="text-sm">{q.is_historical ? 'Historical' : ''}{q.assigned_to ? ` · Assigned: ${people?.find(p => p.id === q.assigned_to)?.full_name ?? 'associate'}` : ''}</span></div><p>{q.detail}</p><p className="text-sm text-muted-foreground">{q.action_taken} {q.source_tab && `· ${q.source_tab}, row ${q.source_row ?? 'unknown'}`}</p>
 <div className="grid gap-3 md:grid-cols-2">{rows.map((r, i) => <div className="space-y-2 rounded border p-3" key={String(r.id)}><Link className="font-semibold underline" href={`/explorer/${table}/${r.id}`}>{q.issue_type === 'plot_double_booked' ? `${i === 0 ? 'A' : 'B'} · ` : ''}{String(r.legacy_key)} · Open record</Link><p>{String((r.raw_json as Record<string, unknown>)?.customer_name ?? '')} · {people?.find(p => p.id === r.associate_id)?.full_name} · {String((r.raw_json as Record<string, unknown>)?.project ?? '')}</p><dl className="space-y-1 text-sm">{(table === 'bookings' ? ['lead_id', 'associate_id', 'plot_no', 'status', 'booking_date', 'value', 'cp_text_as_written', 'remarks'] : ['name', 'rating_after', 'current_rating', 'occurred_on', 'remark', 'next_action', 'next_action_date']).filter(k => r[k] != null).map(k => <div key={k}><dt className="inline text-muted-foreground">{k.replaceAll('_', ' ')}: </dt><dd className="inline break-words">{displayValue(r[k])}</dd></div>)}</dl></div>)}</div>
 {!rows.length && <p className="text-sm">Source-level issue; consult the source tab and row above.</p>}
 <IssueActions issue={q.id} table={table} records={rows} people={(people ?? []).filter(p => p.branch_id === q.branch_id)} conflict={q.issue_type === 'plot_double_booked'} open={q.status === 'open'}/>
 </article>;
            })}</section>)}{!issues?.length && <p>No issues match these filters.</p>}</div>;
}
