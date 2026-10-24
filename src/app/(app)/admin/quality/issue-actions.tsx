'use client';
import { useActionState, useState } from 'react';
import { qualityAction } from './actions';
import { EDIT_FIELDS, type RecordTable, displayValue } from '@/lib/quality';
export function IssueActions({ issue, table, records, people, conflict, open }: {
    issue: string;
    table: RecordTable;
    records: Record<string, unknown>[];
    people: {
        id: string;
        full_name: string;
    }[];
    conflict: boolean;
    open: boolean;
}) {
    const [state, action, pending] = useActionState(qualityAction, {});
    const [record, setRecord] = useState(String(records[0]?.id ?? ''));
    const [field, setField] = useState(EDIT_FIELDS[table][0]);
    const current = records.find(r => r.id === record);
    const button = 'min-h-11 rounded border px-3 text-sm hover:bg-muted disabled:opacity-50';
    return <div className="space-y-3">
 {state.error && <p role="alert" className="text-destructive">{state.error}</p>}{state.success && <p role="status">{state.success}</p>}
 {open && <form action={action} className="flex flex-wrap gap-2"><input type="hidden" name="issue" value={issue}/>
 {conflict && <>{[['keep_a', 'Keep A'], ['keep_b', 'Keep B'], ['both_valid', 'Both valid']].map(([value, label]) => <button className={button} disabled={pending} key={value} name="action" value={value}>{label}</button>)}</>}
 <button className={button} name="action" value="ok" disabled={pending}>Mark OK</button></form>}
 {open && records.length > 0 && <details><summary className="min-h-11 cursor-pointer py-3">Fix · edit a field</summary>
 <form action={action} className="flex flex-wrap items-end gap-2"><input type="hidden" name="issue" value={issue}/><input type="hidden" name="table" value={table}/><input type="hidden" name="action" value="fix"/>
 <label>Record<select className="block h-11 rounded border px-2" name="record" value={record} onChange={e => setRecord(e.target.value)}>{records.map(r => <option key={String(r.id)} value={String(r.id)}>{String(r.legacy_key)}</option>)}</select></label>
 <label>Field<select className="block h-11 rounded border px-2" name="field" value={field} onChange={e => setField(e.target.value)}>{EDIT_FIELDS[table].map(f => <option key={f}>{f}</option>)}</select></label>
 <label>Correct value<input key={record + field} className="block h-11 rounded border px-2 text-base" name="value" defaultValue={displayValue(current?.[field])} placeholder="Blank = unknown"/></label>
 <button className={button} disabled={pending}>Save fix</button><p className="w-full text-xs text-muted-foreground">Dates: YYYY-MM-DD. Plots: separate with |. Saving resolves this issue and records the correction.</p></form></details>}
 <form action={action} className="flex flex-wrap gap-2"><input type="hidden" name="issue" value={issue}/><input type="hidden" name="action" value="assign"/>
 <select required aria-label="Assign to associate" className="h-11 max-w-full rounded border px-2" name="assignee"><option value="">Choose associate</option>{people.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select>
 <button className={button} disabled={pending}>Assign to associate</button></form></div>;
}
