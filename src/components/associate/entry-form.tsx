'use client';
import { useState, useActionState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useAssociate, useHydrated } from './runtime';
import { RatingPicker } from './rating';
import { VoiceRemark } from './voice-remark';
import { todayIndia, addDays, normalize, validateEntry, warnings } from '@/lib/associate/common';
import { storageKey } from '@/lib/associate/storage';
import { createClient } from '@/lib/supabase/client';
import type { Payload, EntryResult, Lead, Partner } from '@/lib/associate/types';
const modes = [['in_person', 'In person'], ['virtual', 'Virtual'], ['both', 'Both']];
function Chips({ label, options, value, onChange }: {
    label: string;
    options: string[];
    value: string;
    onChange: (v: string) => void;
}) { return <fieldset><legend className="field-label mb-2">{label}</legend><div className="flex flex-wrap gap-2">{options.map(v => <button type="button" className="chip" aria-pressed={value === v} onClick={() => onChange(v)} key={v}>{v}</button>)}</div></fieldset>; }
export function EntryForm(props: {
    kind: 'customer' | 'cp' | 'booking';
    leadId?: string;
    cpId?: string;
}) { const hydrated = useHydrated(); return hydrated ? <LoadedEntryForm key={props.kind + (props.leadId ?? props.cpId ?? 'new')} {...props}/> : <p role="status" className="py-8">Opening your saved draft…</p>; }
function LoadedEntryForm({ kind, leadId, cpId }: {
    kind: 'customer' | 'cp' | 'booking';
    leadId?: string;
    cpId?: string;
}) {
    const { data, submit } = useAssociate();
    const today = todayIndia();
    const key = storageKey(data.owner, `draft:${kind}:${leadId ?? cpId ?? 'new'}`);
    const lead = data.leads.find(l => l.id === leadId);
    const cp = data.partners.find(c => c.id === cpId);
    function defaults(l?: Lead, c?: Partner): Payload {
        const last = data.interactions.filter(i => i.lead_id === l?.id).sort((a, b) => b.occurred_on.localeCompare(a.occurred_on) || String(b.created_at).localeCompare(String(a.created_at)))[0];
        const cpLast = data.cpInteractions.filter(i => i.cp_id === c?.id).sort((a, b) => b.occurred_on.localeCompare(a.occurred_on) || String(b.created_at).localeCompare(String(a.created_at)))[0];
        return { _request_id: crypto.randomUUID(), name: l?.name ?? c?.name ?? '', lead_id: l?.id ?? '', cp_id: c?.id ?? '', phone: l?.phone ?? cpLast?.contact_phone ?? c?.phone ?? '', firm: c?.firm ?? '', occurred_on: today, booking_date: today,
            project_id: l?.project_id ?? localStorage.getItem(storageKey(data.owner, 'last-project')) ?? data.projects[0]?.id ?? '', interaction_type: l ? 'follow_up' : 'meeting', mode: last?.mode ?? 'in_person', rating_after: l?.current_rating ?? c?.current_rating ?? '', remark: last?.remark ?? cpLast?.remark ?? '',
            next_action: l?.next_action ?? c?.next_action ?? data.actions[0] ?? '', next_action_date: addDays(today, 1), plot_names: l?.plot_names ?? [], site_visit_status: last?.site_visit_status ?? 'not_planned', cold_reason: last?.cold_reason ?? '', nurture_note: last?.nurture_note ?? '', status: 'token', source: l?.source ?? 'direct', value: '', plot_no: '', remarks: '', cancel_reason: '' };
    }
    const [p, setP] = useState<Payload>(() => { try {
        return JSON.parse(localStorage.getItem(key) ?? 'null') ?? defaults(lead, cp);
    }
    catch {
        return defaults(lead, cp);
    } });
    const draftRef = useRef(p);
    useEffect(() => { draftRef.current = p; }, [p]);
    useEffect(() => { const reset = (event: Event) => { if (draftRef.current._request_id === (event as CustomEvent).detail) {
        const next = { ...draftRef.current, _request_id: crypto.randomUUID() };
        draftRef.current = next;
        setP(next);
        localStorage.setItem(key, JSON.stringify(next));
    } }; window.addEventListener('bro-undo', reset); return () => window.removeEventListener('bro-undo', reset); }, [key]);
    const [synced, setSynced] = useState<EntryResult | null>(null);
    useEffect(() => { const saved = (event: Event) => { const result = (event as CustomEvent<EntryResult>).detail; if (result.request_id === draftRef.current._request_id) {
        localStorage.removeItem(key);
        setSynced(result);
    } }; window.addEventListener('bro-saved', saved); return () => window.removeEventListener('bro-saved', saved); }, [key]);
    const [storageError, setStorageError] = useState('');
    const [plotText, setPlotText] = useState('');
    const [conflict, setConflict] = useState('');
    const value = (k: string) => String(p[k] ?? '');
    function update(patch: Payload) { const next = { ...draftRef.current, ...patch }; draftRef.current = next; setP(next); try {
        localStorage.setItem(key, JSON.stringify(next));
        setStorageError('');
    }
    catch {
        setStorageError('Phone storage is full. Keep this form open until you can reconnect and save.');
    } }
    function selectLead(l: Lead) { const next = defaults(l); draftRef.current = next; setP(next); localStorage.setItem(key, JSON.stringify(next)); }
    function selectCP(c: Partner) { const next = defaults(undefined, c); draftRef.current = next; setP(next); localStorage.setItem(key, JSON.stringify(next)); }
    const matches = kind === 'cp' ? data.partners.filter(c => normalize(c.name + ' ' + (c.firm ?? '')).includes(normalize(p.name))) : data.leads.filter(l => normalize(l.name).includes(normalize(p.name)) || (String(p.name).replace(/\D/g, '').length >= 4 && l.phone?.includes(String(p.name))));
    const exact = !p.lead_id && kind !== 'cp' && data.leads.find(l => normalize(l.name) === normalize(p.name) && normalize(p.name));
    const [state, action, pending] = useActionState<EntryResult, FormData>(async (): Promise<EntryResult> => {
        const errors = validateEntry(kind, p);
        if (errors.length)
            return { error: errors.join(' ') };
        if (exact)
            return { error: 'This customer already exists. Choose Log follow-up below.', duplicate_lead_id: exact.id };
        const result = await submit({ owner: data.owner, kind, request_id: value('_request_id'), payload: p, created_at: new Date().toISOString() });
        if (result.id) {
            localStorage.removeItem(key);
            if (p.project_id)
                localStorage.setItem(storageKey(data.owner, 'last-project'), value('project_id'));
        }
        return result;
    }, {});
    useEffect(() => {
        if (kind !== 'booking' || !p.project_id || !p.plot_no) {
            return;
        }
        let cancelled = false;
        const timer = setTimeout(async () => {
            const ownHot = data.leads.some(l => l.id !== p.lead_id && l.project_id === p.project_id && l.current_rating === 'hot' && l.plot_names.some(n => normalize(n) === normalize(p.plot_no)));
            const ownBooked = data.bookings.some(b => b.lead_id !== p.lead_id && b.project_id === p.project_id && normalize(b.plot_no) === normalize(p.plot_no) && ['token', 'booking_done', 'agreement_signed'].includes(b.status));
            let message = ownHot || ownBooked ? 'This plot is already Hot or reserved for another customer. Check before saving.' : '';
            if (navigator.onLine) {
                const r = await createClient().rpc('plot_conflicts', { p_project: p.project_id, p_plot: p.plot_no, p_lead: p.lead_id || null });
                if (r.data?.[0] && (Number(r.data[0].hot_leads) > 0 || Number(r.data[0].live_bookings) > 0))
                    message = 'This plot is already Hot or reserved for another customer in your branch. Check before saving.';
                else if (r.error)
                    message = message || 'Could not check the branch plot register. Please confirm availability.';
            }
            else
                message = message || 'Offline: branch plot availability will need checking when connected.';
            if (!cancelled)
                setConflict(message);
        }, 300);
        return () => { cancelled = true; clearTimeout(timer); };
    }, [kind, p.project_id, p.plot_no, p.lead_id, data.leads, data.bookings]);
    if ((leadId && !lead) || (cpId && !cp))
        return <div className="associate-card"><h1 className="text-xl font-semibold">Record not available</h1><p>You can log updates only for your own customers or a CP in your branch.</p><Link className="touch-button underline" href="/home">Back to Today</Link></div>;
    const feedback = synced && synced.request_id === p._request_id ? synced : state;
    const plots = [...new Set([...data.leads.filter(l => l.project_id === p.project_id).flatMap(l => l.plot_names), ...data.bookings.filter(b => b.project_id === p.project_id).map(b => b.plot_no).filter((v): v is string => !!v), ...((p.plot_names as string[]) ?? [])])].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const selected = (p.plot_names as string[]) ?? [];
    const warn = warnings(p);
    if (feedback.id && feedback.request_id === p._request_id)
        return <div className="associate-card space-y-4"><span className="text-3xl text-emerald-700">✓</span><h1 className="text-2xl font-semibold">Saved. You’re all set.</h1><p>The update is on your sheet and timeline.</p><Link className="touch-button bg-teal-700 text-white" href={kind === 'cp' ? `/partners/${feedback.cp_id}` : `/leads/${feedback.lead_id}`}>Open {kind === 'cp' ? 'CP' : 'customer'} timeline</Link><div><Link className="touch-button underline" href="/home">Back to Today</Link></div></div>;
    const title = kind === 'cp' ? 'CP meeting' : kind === 'booking' ? 'Booking' : p.lead_id ? 'Log customer follow-up' : 'Customer meeting';
    return <div className="mx-auto max-w-xl space-y-6"><div><Link href="/home" className="touch-button -ml-4 text-muted-foreground">← Today</Link><h1 className="text-2xl font-semibold">{title}</h1><p className="mt-1 text-sm text-muted-foreground">{p.lead_id ? 'Linked to your existing customer.' : 'A few taps now. A clear next step for tomorrow.'}</p></div>
 <form action={action} className="space-y-6">
 {feedback.error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-800">{feedback.error}</p>}
 {storageError && <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-800">{storageError}</p>}
 {feedback.message && feedback.request_id === p._request_id && !feedback.duplicate_lead_id && <p role="status" className="rounded-xl bg-orange-50 p-4 text-orange-900">{feedback.message}</p>}
 {feedback.duplicate_lead_id && <Link className="touch-button w-full bg-orange-50 text-orange-900" href={`/log/${kind}?lead=${feedback.duplicate_lead_id}`}>Log follow-up on this existing customer →</Link>}
 <div className="relative space-y-2"><label className="field-label" htmlFor="person-name">{kind === 'cp' ? 'Channel partner name' : 'Customer name'}</label><input id="person-name" className="form-input" autoComplete="off" value={value('name')} placeholder={kind === 'cp' ? 'Search CP name or firm' : 'Start typing a name or phone'} onChange={e => update({ name: e.target.value, lead_id: '', cp_id: kind === 'cp' ? '' : p.cp_id, interaction_type: 'meeting' })}/>
 {!!normalize(p.name) && !(kind === 'cp' ? p.cp_id : p.lead_id) && matches.length > 0 && <div className="overflow-hidden rounded-xl border border-teal-200 bg-teal-50">{matches.slice(0, 6).map(person => <button type="button" className="flex min-h-14 w-full items-center justify-between gap-3 border-b p-3 text-left last:border-0" key={person.id} onClick={() => kind === 'cp' ? selectCP(person as Partner) : selectLead(person as Lead)}><span><strong>{person.name}</strong>{'firm' in person && <small className="block">{String(person.firm ?? 'Independent')}</small>}</span><span className="text-sm font-semibold text-teal-800">{kind === 'cp' ? 'Log CP update' : 'Log follow-up'} →</span></button>)}</div>}
 {!!p.lead_id && <p className="text-sm text-teal-800">✓ Existing customer · linked follow-up</p>}</div>
 {kind === 'cp' && <label className="field-label">Firm<input className="form-input mt-2" value={value('firm')} onChange={e => update({ firm: e.target.value })} placeholder="Firm name, or Independent"/></label>}
 {kind === 'customer' && <fieldset><legend className="field-label mb-2">Meeting type</legend><div className="grid grid-cols-3 gap-2">{modes.map(([v, label]) => <button type="button" className="chip" aria-pressed={p.mode === v} key={v} onClick={() => update({ mode: v })}>{label}</button>)}</div>{!!p.lead_id && <label className="mt-3 flex min-h-12 items-center gap-3 text-sm"><input type="checkbox" className="size-5" checked={p.interaction_type === 'follow_up'} onChange={e => update({ interaction_type: e.target.checked ? 'follow_up' : 'meeting' })}/>This is a follow-up, rather than a new meeting</label>}</fieldset>}
 {kind !== 'booking' && <><RatingPicker cp={kind === 'cp'} value={value('rating_after')} onChange={r => update({ rating_after: r, next_action_date: value('next_action_date') || addDays(today, 1) })}/><VoiceRemark value={value('remark')} onChange={s => update({ remark: s })}/>
 {data.actions.length > 0 ? <Chips label="Next action" options={data.actions} value={value('next_action')} onChange={s => update({ next_action: s })}/> : <label className="field-label">Next action<input className="form-input mt-2" value={value('next_action')} onChange={e => update({ next_action: e.target.value })} placeholder="What will you do next?"/></label>}
 <div><span className="field-label mb-2">Next-action date</span><div className="mb-2 flex flex-wrap gap-2">{[[1, 'Tomorrow'], [3, '3 days'], [7, '1 week'], [14, '2 weeks']].map(([n, label]) => <button type="button" className="chip" key={n} aria-pressed={p.next_action_date === addDays(today, Number(n))} onClick={() => update({ next_action_date: addDays(today, Number(n)) })}>{label}</button>)}<button type="button" className="chip" onClick={() => { const el = document.getElementById('next-action-date') as HTMLInputElement; try {
            el.showPicker();
        }
        catch {
            el.focus();
        } }}>Pick date</button></div><input id="next-action-date" aria-label="Next-action date" className="form-input" type="date" value={value('next_action_date')} onChange={e => update({ next_action_date: e.target.value })}/></div></>}
 {kind === 'customer' && p.rating_after === 'hot' && <div className="space-y-4 rounded-2xl border border-red-200 bg-red-50/40 p-4"><fieldset><legend className="field-label mb-2">Plot names · choose one or more</legend><div className="flex max-h-44 flex-wrap gap-2 overflow-auto">{plots.map(plot => <button type="button" className="chip bg-white" key={plot} aria-pressed={selected.includes(plot)} onClick={() => update({ plot_names: selected.includes(plot) ? selected.filter(x => x !== plot) : [...selected, plot] })}>{plot}</button>)}</div></fieldset><div className="flex gap-2"><input aria-label="Add plot name" className="form-input" value={plotText} onChange={e => setPlotText(e.target.value)} placeholder="Type another plot name"/><button type="button" className="touch-button bg-white" onClick={() => { if (plotText.trim()) {
        update({ plot_names: [...new Set([...selected, ...plotText.split(/[,|]/).map(x => x.trim()).filter(Boolean)])] });
        setPlotText('');
    } }}>Add</button></div><label className="field-label">Site visit<select className="form-input mt-2" value={value('site_visit_status')} onChange={e => update({ site_visit_status: e.target.value })}><option value="not_planned">Not planned yet</option><option value="planned">Planned</option><option value="done">Done</option></select></label><p className="text-xs text-red-800">Hot needs a plot and a next step within 7 days.</p></div>}
 {kind === 'customer' && p.rating_after === 'cold' && <div className="space-y-4 rounded-2xl border border-blue-200 p-4"><label className="field-label">Cold reason<select className="form-input mt-2" value={value('cold_reason')} onChange={e => update({ cold_reason: e.target.value })}><option value="">Choose a reason</option>{data.coldReasons.map(r => <option key={r}>{r}</option>)}</select></label><label className="field-label">Nurturing plan<textarea className="form-input mt-2" value={value('nurture_note')} onChange={e => update({ nurture_note: e.target.value })} placeholder="How will you keep in touch?"/></label></div>}
 {kind === 'booking' && <><label className="field-label">Status<select className="form-input mt-2" value={value('status')} onChange={e => update({ status: e.target.value })}><option value="token">Token</option><option value="booking_done">Booking Done</option><option value="agreement_signed">Agreement Signed</option><option value="cancelled">Cancelled</option></select></label><label className="field-label">Project<select className="form-input mt-2" value={value('project_id')} onChange={e => update({ project_id: e.target.value })}><option value="">Choose project</option>{data.projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label><label className="field-label">Plot<input list="booking-plots" className="form-input mt-2" value={value('plot_no')} onChange={e => update({ plot_no: e.target.value })} placeholder="Choose or enter plot"/><datalist id="booking-plots">{plots.map(plot => <option key={plot} value={plot}/>)}</datalist></label>{conflict && <p role="status" className="rounded-xl bg-orange-50 p-4 text-orange-900">{conflict}</p>}<div className="grid grid-cols-2 gap-3"><label className="field-label">Value (₹)<input type="number" min="0" step="0.01" inputMode="decimal" className="form-input mt-2" value={value('value')} onChange={e => update({ value: e.target.value })}/></label><label className="field-label">Booking date<input type="date" className="form-input mt-2" value={value('booking_date')} onChange={e => update({ booking_date: e.target.value })}/></label></div><label className="field-label">Source<select className="form-input mt-2" value={value('source')} onChange={e => update({ source: e.target.value })}>{[['direct', 'Direct'], ['cp', 'Channel partner'], ['referral', 'Referral'], ['walk_in', 'Walk-in']].map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select></label>{p.source === 'cp' && <label className="field-label">Channel partner<select className="form-input mt-2" value={value('cp_id')} onChange={e => update({ cp_id: e.target.value })}><option value="">Choose CP</option>{data.partners.map(c => <option key={c.id} value={c.id}>{c.name} · {c.firm ?? 'Independent'}</option>)}</select></label>}{p.status === 'cancelled' && <label className="field-label">Cancellation reason<textarea className="form-input mt-2" value={value('cancel_reason')} onChange={e => update({ cancel_reason: e.target.value })}/></label>}<VoiceRemark label="Booking remark" value={value('remarks')} onChange={s => update({ remarks: s })}/></>}
 <label className="field-label">Phone <span className="font-normal text-muted-foreground">(optional)</span><input aria-label="Phone (optional)" type="tel" autoComplete="tel" className="form-input mt-2" value={value('phone')} onChange={e => update({ phone: e.target.value })} placeholder="Mobile number"/>{!p.phone && <span className="mt-2 block text-xs font-normal text-muted-foreground">Add a number to make the next call one tap.</span>}</label>
 {kind !== 'booking' && <details><summary className="touch-button -ml-4 text-muted-foreground">Date & project</summary><div className="mt-3 grid gap-4 sm:grid-cols-2"><label className="field-label">Meeting date<input type="date" className="form-input mt-2" value={value('occurred_on')} onChange={e => update({ occurred_on: e.target.value })}/></label>{kind === 'customer' && <label className="field-label">Project<select className="form-input mt-2" value={value('project_id')} onChange={e => update({ project_id: e.target.value })}><option value="">Choose project</option>{data.projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>}</div></details>}
 {warn.map(message => <p key={message} role="status" className="rounded-xl bg-orange-50 p-4 text-sm text-orange-900">{message}</p>)}
 <div className="sticky bottom-20 z-10 rounded-2xl bg-background/95 py-3 backdrop-blur"><button className="touch-button min-h-14 w-full bg-teal-700 text-base text-white shadow-sm" disabled={pending || !!exact} type="submit">{pending ? 'Saving…' : feedback.message ? 'Retry saved entry' : `Save ${kind === 'booking' ? 'booking' : 'update'}`}</button><p className="mt-2 text-center text-xs text-muted-foreground">Draft saved on this phone as you type.</p></div>
 </form></div>;
}
