'use client';
import { useActionState, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAssociate, useHydrated } from './runtime';
import { RatingBadge } from './rating';
import { normalize } from '@/lib/associate/common';
import { storageKey } from '@/lib/associate/storage';
import { previewPaste, pasteRequestId } from '@/lib/associate/paste';
import type { Row, EntryKind, Payload, EntryResult } from '@/lib/associate/types';
type Tab = 'leads' | 'interactions' | 'cp' | 'bookings';
const columns: Record<Tab, string[]> = { leads: ['name', 'phone'], interactions: ['occurred_on', 'rating_after', 'mode', 'remark', 'next_action', 'next_action_date', 'plot_names', 'cold_reason'], cp: ['occurred_on', 'rating_after', 'remark', 'next_action', 'next_action_date'], bookings: ['status', 'plot_no', 'value', 'booking_date', 'cancel_reason', 'remarks'] };
const labels: Record<string, string> = { name: 'Customer', phone: 'Phone', occurred_on: 'Meeting date', rating_after: 'Rating', mode: 'Meeting type', remark: 'Remark', next_action: 'Next action', next_action_date: 'Next date', plot_names: 'Plots', cold_reason: 'Cold reason', status: 'Status', plot_no: 'Plot', value: 'Value (₹)', booking_date: 'Booking date', cancel_reason: 'Cancellation reason', remarks: 'Remarks' };
const friendly = (s: unknown) => s == null ? '' : Array.isArray(s) ? s.join(' | ') : String(s);
function EditableRow({ row, tab, label }: {
    row: Row;
    tab: Tab;
    label: string;
}) {
    const { data, submit, notice } = useAssociate();
    const draftKey = storageKey(data.owner, `sheet-draft:${tab}:${row.id}`);
    const [draft] = useState(() => { try {
        return JSON.parse(localStorage.getItem(draftKey) ?? 'null') ?? {};
    }
    catch {
        return {};
    } });
    const [changes, setChanges] = useState<Payload>(draft.patch ?? {});
    const [request] = useState<string>(draft.request_id ?? crypto.randomUUID());
    function change(patch: Payload) { setChanges(patch); try {
        localStorage.setItem(draftKey, JSON.stringify({ patch, request_id: request, updated_at: draft.updated_at ?? row.updated_at }));
    }
    catch {
        notice('Could not save this draft to phone storage. Keep this row open and save when connected.');
    } }
    const [result, action, pending] = useActionState<EntryResult, FormData>(async (): Promise<EntryResult> => {
        const patch = Object.fromEntries(Object.entries(changes).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(row[k])));
        if (!Object.keys(patch).length)
            return { message: 'No changes to save.' };
        const result = await submit({ owner: data.owner, request_id: request, kind: ({ leads: 'edit_lead', interactions: 'edit_interaction', cp: 'edit_cp_interaction', bookings: 'edit_booking' } as Record<Tab, EntryKind>)[tab], payload: { id: row.id, expected_updated_at: draft.updated_at ?? row.updated_at, patch }, created_at: new Date().toISOString() });
        if (result.id)
            localStorage.removeItem(draftKey);
        return result;
    }, {});
    const current = { ...row, ...changes };
    return <tr className="border-b align-top odd:bg-slate-50/50"><td className="sticky left-0 z-10 min-w-48 bg-background p-3"><Link className="flex min-h-12 items-center font-semibold underline" href={tab === 'cp' ? `/partners/${row.cp_id}` : `/leads/${tab === 'leads' ? row.id : row.lead_id}`}>{label}</Link>{row.is_historical === true && <small className="text-muted-foreground">Historical</small>}</td>{columns[tab].map(column => {
            const val = friendly(current[column]);
            const options = column === 'rating_after' ? (tab === 'cp' ? ['active', 'hot', 'warm', 'cold'] : ['hot', 'warm', 'cold']) : column === 'status' ? ['token', 'booking_done', 'agreement_signed', 'cancelled'] : column === 'mode' ? ['in_person', 'virtual', 'both'] : column === 'cold_reason' ? data.coldReasons : column === 'next_action' ? data.actions : null;
            const inputClass = `form-input min-w-40 ${column === 'rating_after' ? 'rating-' + val : ''}`;
            return <td key={column} className="min-w-44 p-2">{options?.length ? <select aria-label={`${labels[column]} for ${label}`} className={inputClass} value={val} onChange={e => change({ ...changes, [column]: e.target.value || null })}><option value="">Not recorded</option>{options.map(o => <option key={o} value={o}>{o.replaceAll('_', ' ')}</option>)}</select> : ['remark', 'remarks'].includes(column) ? <textarea aria-label={`${labels[column]} for ${label}`} className="form-input min-h-20 min-w-64" value={val} onChange={e => change({ ...changes, [column]: e.target.value || null })}/> : <input aria-label={`${labels[column]} for ${label}`} className={inputClass} type={column.endsWith('_date') || column === 'occurred_on' ? 'date' : column === 'value' ? 'number' : column === 'phone' ? 'tel' : 'text'} value={val} onChange={e => change({ ...changes, [column]: column === 'plot_names' ? e.target.value.split('|').map(v => v.trim()).filter(Boolean) : column === 'value' ? (e.target.value ? Number(e.target.value) : null) : e.target.value || null })}/>}</td>;
        })}<td className="min-w-44 p-2"><form action={action}><button className="touch-button bg-teal-700 text-white" disabled={(!!row.associate_id&&row.associate_id!==data.owner) || pending || !Object.keys(changes).length || !!result.id}>{pending ? 'Saving…' : result.id ? 'Saved' : 'Save row'}</button></form>{(result.error || result.message) && <p role={result.error ? 'alert' : 'status'} className="mt-2 text-xs">{result.error ?? result.message}</p>}</td></tr>;
}
export function MySheet({ initialTab = 'leads', initialRow = '' }: {
    initialTab?: string;
    initialRow?: string;
}) { const hydrated = useHydrated(); return hydrated ? <LoadedSheet initialTab={initialTab} initialRow={initialRow}/> : <p>Opening your sheet…</p>; }
function LoadedSheet({ initialTab, initialRow }: {
    initialTab: string;
    initialRow: string;
}) {
    const { data } = useAssociate();
    const [tab, setTab] = useState<Tab>(['leads', 'interactions', 'cp', 'bookings'].includes(initialTab) ? initialTab as Tab : 'leads');
    const [onlyRow, setOnlyRow] = useState(initialRow);
    const [q, setQ] = useState('');
    const [rating, setRating] = useState('');
    const [project, setProject] = useState('');
    const [from, setFrom] = useState('');
    const [to, setTo] = useState('');
    const [history, setHistory] = useState(true);
    const [paste, setPaste] = useState(false);
    const rows = ({ leads: data.leads, interactions: data.interactions, cp: data.cpInteractions, bookings: data.bookings } as Record<Tab, Row[]>)[tab];
    const name = (r: Row) => tab === 'cp' ? data.partners.find(c => c.id === r.cp_id)?.name ?? 'Channel partner' : tab === 'leads' ? String(r.name) : data.leads.find(l => l.id === r.lead_id)?.name ?? 'Customer';
    const filtered = rows.filter(r => {
        const lead = tab === 'leads' ? r : data.leads.find(l => l.id === r.lead_id);
        const day = String(r.occurred_on ?? r.booking_date ?? r.next_action_date ?? '');
        return (!onlyRow || r.id === onlyRow) && (!q || normalize(name(r) + ' ' + String(r.remark ?? r.remarks ?? '')).includes(normalize(q))) && (!rating || (r.rating_after ?? r.current_rating) === rating) && (!project || lead?.project_id === project || r.project_id === project) && (!from || day >= from) && (!to || day <= to) && (history || !r.is_historical);
    });
    return <div className="space-y-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-semibold">My Sheet</h1><p className="mt-1 text-sm text-muted-foreground">Your rows, your updates. Changes keep an audit trail.</p></div><button className="touch-button border" onClick={() => setPaste(!paste)}>{paste ? 'Close paste' : 'Paste from Excel'}</button></div>{paste && <PastePanel />}<nav aria-label="Sheet type" className="flex gap-2 overflow-x-auto">{([['leads', 'Customers'], ['interactions', 'Customer meetings'], ['cp', 'CP meetings'], ['bookings', 'Bookings']] as [
        Tab,
        string
    ][]).map(([v, label]) => <button className="chip whitespace-nowrap" aria-pressed={tab === v} key={v} onClick={() => { setTab(v); setOnlyRow(''); setRating(''); setProject(''); }}>{label}</button>)}</nav>
 <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><input aria-label="Search my sheet" placeholder="Search name or remark" className="form-input" value={q} onChange={e => setQ(e.target.value)}/><select aria-label="Filter rating" className="form-input" value={rating} onChange={e => setRating(e.target.value)}><option value="">All ratings</option>{(tab === 'cp' ? ['active', 'hot', 'warm', 'cold'] : ['hot', 'warm', 'cold']).map(r => <option key={r}>{r}</option>)}</select><select aria-label="Filter project" className="form-input" value={project} onChange={e => setProject(e.target.value)}><option value="">All projects</option>{data.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select><label className="flex min-h-12 items-center gap-3 text-sm"><input type="checkbox" className="size-5" checked={history} onChange={e => setHistory(e.target.checked)}/>Include historical rows</label><label className="field-label">From<input type="date" className="form-input mt-1" value={from} onChange={e => setFrom(e.target.value)}/></label><label className="field-label">To<input type="date" className="form-input mt-1" value={to} onChange={e => setTo(e.target.value)}/></label></div>
 {onlyRow && <button className="touch-button underline" onClick={() => setOnlyRow('')}>Show all rows</button>}<p className="text-xs text-muted-foreground">Swipe across to edit more columns. For a new conversation, use Log update; use this sheet to correct an existing row.</p>
 {filtered.length ? <div className="max-h-[70vh] overflow-auto rounded-xl border"><table className="w-full border-collapse text-left text-sm"><thead className="sticky top-0 z-20 bg-slate-100"><tr><th className="sticky left-0 bg-slate-100 p-3">{tab === 'cp' ? 'Channel partner' : 'Customer'}</th>{columns[tab].map(c => <th key={c} className="whitespace-nowrap p-3">{labels[c]}</th>)}<th className="p-3">Save</th></tr></thead><tbody>{filtered.map(row => <EditableRow key={row.id + row.updated_at} row={row} tab={tab} label={name(row)}/>)}</tbody></table></div> : <div className="associate-card"><p>No rows match these filters. Clear the filters, or log your first meeting.</p><Link href="/log/customer" className="touch-button mt-3 bg-teal-700 text-white">Log customer meeting</Link></div>}</div>;
}
function PastePanel() {
    const { data, submit, notice } = useAssociate();
    const key = storageKey(data.owner, 'paste-draft');
    const saved = useMemo(() => { try {
        return JSON.parse(localStorage.getItem(key) ?? 'null') ?? {};
    }
    catch {
        return {};
    } }, [key]);
    const [text, setText] = useState<string>(saved.text ?? '');
    const [kind, setKind] = useState<'customer' | 'cp' | 'booking'>(saved.kind ?? 'customer');
    const [batchId] = useState<string>(saved.batchId ?? crypto.randomUUID());
    const [outcomes, setOutcomes] = useState<Record<string, string>>({});
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const preview = useMemo(() => { try {
        return { rows: previewPaste(text, kind, data), error: '' };
    }
    catch (e) {
        return { rows: [], error: (e as Error).message };
    } }, [text, kind, data]);
    const fingerprints = new Map<string, number>();
    const rows = preview.rows.map(row => { const occurrence = fingerprints.get(row.fingerprint) ?? 0; fingerprints.set(row.fingerprint, occurrence + 1); const fingerprint = kind + row.fingerprint + ':' + occurrence; return { ...row, id: pasteRequestId(batchId, fingerprint) }; });
    function persist(value: string, type = kind) { setText(value); setKind(type); try {
        localStorage.setItem(key, JSON.stringify({ text: value, kind: type, batchId }));
    }
    catch {
        setError('Could not save this paste draft. Keep this page open.');
    } }
    async function importRows() { setBusy(true); setError(''); localStorage.setItem(key, JSON.stringify({ text, kind, batchId })); try {
        for (const row of rows) {
            if (outcomes[row.id] === 'Saved' || outcomes[row.id] === 'Pending sync')
                continue;
            const result = await submit({ owner: data.owner, kind, request_id: row.id, payload: row.payload, created_at: new Date().toISOString(), fromPaste: true });
            if (result.error || result.duplicate_lead_id) {
                setOutcomes(o => ({ ...o, [row.id]: result.error ?? 'Existing customer needs linking.' }));
                setError(`Stopped at row ${row.line}. Earlier rows are saved; fix this row before retrying.`);
                break;
            }
            setOutcomes(o => ({ ...o, [row.id]: result.id ? 'Saved' : 'Pending sync' }));
        }
        notice('Paste processed. Check each row’s result below.');
    }
    finally {
        setBusy(false);
    } }
    return <section className="associate-card space-y-4"><h2 className="text-lg font-semibold">Paste from Excel</h2><p className="text-sm text-muted-foreground">Copy the column headers and rows from your sheet, then paste here. Flat import headers and the original template headers both work. Dates may use DD/MM/YYYY. Preview every row before importing.</p><select aria-label="Paste type" className="form-input" value={kind} disabled={busy} onChange={e => persist(text, e.target.value as typeof kind)}><option value="customer">Customer meetings</option><option value="cp">CP meetings</option><option value="booking">Bookings</option></select><textarea aria-label="Paste Excel rows" className="form-input min-h-36 whitespace-pre font-mono text-sm" value={text} disabled={busy} onChange={e => persist(e.target.value)} placeholder={kind === 'customer' ? 'customer_name\tphone\toccurred_on\tmode\tproject\trating_after\tplot_numbers\tremark\tnext_action\tnext_action_date\tcold_reason' : 'Paste headers and rows here'}/><p className="text-xs text-muted-foreground">Without headers, rows use the original template’s column order, with or without the SN column. Nothing is saved until you import.</p>{(error || preview.error) && <p role="alert" className="rounded-xl bg-red-50 p-3 text-red-800">{error || preview.error}</p>}{rows.length > 0 && <><div className="max-h-80 overflow-auto rounded-xl border"><table className="w-full text-left text-sm"><thead><tr className="bg-slate-50"><th className="p-3">Row</th><th className="p-3">Name</th><th className="p-3">Date</th><th className="p-3">Rating / status</th><th className="p-3">Checks / result</th></tr></thead><tbody>{rows.map(row => <tr className="border-t" key={row.id}><td className="p-3">{row.line}</td><td className="p-3">{String(row.payload.name ?? '')}</td><td className="whitespace-nowrap p-3">{String(kind === 'booking' ? row.payload.booking_date : row.payload.occurred_on)}</td><td className="p-3">{kind === 'booking' ? String(row.payload.status) : <RatingBadge rating={row.payload.rating_after}/>}</td><td className="min-w-64 p-3">{outcomes[row.id] ?? (row.errors.length ? row.errors.join(' ') : row.warnings.length ? row.warnings.join(' ') : 'Ready')}</td></tr>)}</tbody></table></div><button className="touch-button bg-teal-700 text-white" disabled={busy || !!preview.error || rows.some(r => r.errors.length > 0)} onClick={() => void importRows()}>{busy ? 'Importing…' : `Import ${rows.length} rows`}</button><p className="text-xs text-muted-foreground">Existing customer names link to their lead. Each pasted row gets a retry-safe ID; reconnecting will not create duplicates.</p></>}</section>;
}
