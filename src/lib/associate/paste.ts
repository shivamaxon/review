import type { Bundle, EntryKind, Payload } from './types';
import { normalize, isDate, todayIndia, validateEntry, warnings } from './common';
export type PreviewRow = {
    line: number;
    payload: Payload;
    errors: string[];
    warnings: string[];
    fingerprint: string;
};
// Clipboard TSV, including quoted remarks containing tabs, line breaks and Hindi.
export function parseTSV(text: string): string[][] { const rows: string[][] = []; let row: string[] = [], cell = '', quoted = false; for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"' && (quoted || cell === '')) {
        if (quoted && text[i + 1] === '"') {
            cell += '"';
            i++;
        }
        else
            quoted = !quoted;
    }
    else if (!quoted && (c === '\t' || c === '\n' || c === '\r')) {
        row.push(cell.trim());
        cell = '';
        if (c !== '\t') {
            if (c === '\r' && text[i + 1] === '\n')
                i++;
            if (row.some(Boolean))
                rows.push(row);
            row = [];
        }
    }
    else
        cell += c;
} row.push(cell.trim()); if (row.some(Boolean))
    rows.push(row); if (quoted)
    throw new Error('A quoted cell is unfinished. Copy the complete rows from Excel again.'); return rows; }
const aliases: Record<string, string> = { customername: 'name', customer: 'name', name: 'name', cpname: 'name', channelpartnername: 'name', phone: 'phone', phoneaswritten: 'phone', customernameaswritten: 'name', cpnameaswritten: 'name', mobile: 'phone', mtgdate: 'occurred_on', meetingdate: 'occurred_on', occurredon: 'occurred_on', mtgtype: 'mode', meetingtype: 'mode', mode: 'mode', project: 'project', projectname: 'project', hwc: 'rating_after', rating: 'rating_after', ratingafter: 'rating_after', plotnames: 'plot_names', plotnumbers: 'plot_names', currentplotnumbers: 'plot_names', remarks: 'remark', remark: 'remark', nextaction: 'next_action', nextactiondate: 'next_action_date', reasonnurturingplanifcold: 'cold_reason', coldreason: 'cold_reason', nurturenote: 'nurture_note', firm: 'firm', firmname: 'firm', plotnumber: 'plot_no', unitplot: 'plot_no', plotno: 'plot_no', bookingvalue: 'value', value: 'value', bookingdate: 'booking_date', status: 'status', source: 'source', sourcetype: 'source', leadkey: 'lead_key', cpkey: 'cp_key', associatekey: 'associate_key', cancelreason: 'cancel_reason', sitevisitstatus: 'site_visit_status', interactiontype: 'interaction_type' };
export function pasteDate(value: string): string { if (!value)
    return ''; if (isDate(value))
    return value; if (/^\d{4}-\d{2}-\d{2}T/.test(value) && isDate(value.slice(0, 10)))
    return value.slice(0, 10); if (/^\d{5}(\.\d+)?$/.test(value))
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(value)) * 86400000).toISOString().slice(0, 10); const m = value.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/); if (m) {
    const date = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    if (isDate(date))
        return date;
} return value; }
export function previewPaste(text: string, kind: 'customer' | 'cp' | 'booking', data: Bundle): PreviewRow[] {
    const rows = parseTSV(text);
    if (!rows.length)
        return [];
    if (rows.length > 201)
        throw new Error('Paste up to 200 rows at a time. Your text is still here.');
    const first = rows[0].map(normalize);
    const hasHeader = first.filter(k => aliases[k]).length >= 2;
    const old: Record<string, string[]> = { customer: ['name', 'phone', 'occurred_on', 'mode', 'project', 'rating_after', 'plot_names', 'remark', 'next_action', 'next_action_date', 'cold_reason'], cp: ['name', 'firm', 'occurred_on', 'rating_after', 'remark', 'next_action', 'next_action_date'], booking: ['name', 'project', 'plot_no', 'value', 'booking_date', 'status', 'source', 'cp_name', 'remark'] };
    const numbered = !hasHeader && /^\d+$/.test(rows[0][0]) && rows[0].length > 3;
    const headers = hasHeader ? first.map(k => kind === 'booking' && k === 'cpname' ? 'cp_name' : aliases[k] ?? '_ignore') : [...(numbered ? ['_ignore'] : []), ...old[kind]];
    return rows.slice(hasHeader ? 1 : 0).map((cells, index) => {
        const raw = Object.fromEntries(headers.map((key, i) => [key, cells[i] ?? '']));
        const p: Payload = { ...raw };
        const warn: string[] = [];
        const errors: string[] = [];
        if (raw.associate_key && raw.associate_key !== data.ownerKey)
            errors.push('This row belongs to another associate. Only your own data can be imported.');
        if (raw.project) {
            const project = data.projects.find(x => normalize(x.name) === normalize(raw.project) || (normalize(raw.project) === 'clr' && normalize(x.name) === 'clublakereserve'));
            if (project)
                p.project_id = project.id;
            else
                errors.push(`Unknown project: ${raw.project}`);
        }
        else
            p.project_id = data.projects[0]?.id ?? '';
        if (kind !== 'cp') {
            const existing = raw.lead_key ? data.leads.find(l => l.legacy_key === raw.lead_key) : data.leads.find(l => normalize(l.name) === normalize(raw.name));
            if (raw.lead_key && !existing)
                errors.push('This lead key is not one of your customers.');
            if (existing) {
                p.lead_id = existing.id;
                p.name = existing.name;
                warn.push('Linked to your existing customer.');
            }
        }
        else {
            const existing = raw.cp_key ? data.partners.find(c => c.legacy_key === raw.cp_key) : data.partners.find(c => normalize(c.name) === normalize(raw.name) && normalize(c.firm) === normalize(raw.firm));
            if (raw.cp_key && !existing)
                errors.push('CP key is not in this branch.');
            if (existing)
                p.cp_id = existing.id;
        }
        p.rating_after = String(raw.rating_after ?? '').toLowerCase();
        p.mode = ({ inperson: 'in_person', virtual: 'virtual', both: 'both' } as Record<string, string>)[normalize(raw.mode)] ?? (raw.mode || 'in_person');
        p.occurred_on = pasteDate(raw.occurred_on || todayIndia());
        if (!raw.occurred_on && kind !== 'booking')
            warn.push('No meeting date supplied: preview uses today.');
        p.next_action_date = raw.next_action_date ? pasteDate(raw.next_action_date) : null;
        p.plot_names = String(raw.plot_names ?? '').split(/[,|]/).map(x => x.trim()).filter(Boolean);
        p.interaction_type = raw.interaction_type || 'meeting';
        if (kind === 'booking') {
            p.status = ({ token: 'token', bookingdone: 'booking_done', agreementsigned: 'agreement_signed', cancelled: 'cancelled', canceled: 'cancelled' } as Record<string, string>)[normalize(raw.status)] ?? raw.status;
            p.source = ({ cp: 'cp', channelpartner: 'cp', direct: 'direct', referral: 'referral', walkin: 'walk_in' } as Record<string, string>)[normalize(raw.source)] ?? raw.source;
            p.booking_date = pasteDate(raw.booking_date || todayIndia());
            p.value = String(raw.value ?? '').replace(/[₹,\s]/g, '');
            p.remarks = raw.remark ?? '';
            if (raw.cp_key) {
                const c = data.partners.find(c => c.legacy_key === raw.cp_key);
                if (c)
                    p.cp_id = c.id;
                else
                    errors.push('CP key is not in this branch.');
            }
            else if (raw.cp_name) {
                const candidates = data.partners.filter(c => normalize(c.name) === normalize(raw.cp_name));
                if (candidates.length === 1)
                    p.cp_id = candidates[0].id;
                else if (p.source === 'cp')
                    errors.push('CP name is missing or ambiguous. Use cp_key in a header column.');
            }
        }
        errors.push(...validateEntry(kind as EntryKind, p));
        warn.push(...warnings(p));
        if (kind !== 'booking' && p.next_action_date && !isDate(p.next_action_date))
            errors.push('Next-action date must be a date, not a note.');
        return { line: index + (hasHeader ? 2 : 1), payload: p, errors, warnings: warn, fingerprint: JSON.stringify(cells) };
    });
}
/** Stable within a saved paste batch, including after editing/retrying other rows. */
export function pasteRequestId(batch: string, row: string): string {
    const input = batch + '|' + row;
    const words = [2166136261, 2246822519, 3266489917, 668265263];
    for (let j = 0; j < words.length; j++)
        for (let i = 0; i < input.length; i++)
            words[j] = Math.imul(words[j] ^ input.charCodeAt(i), 16777619);
    const h = words.map(n => (n >>> 0).toString(16).padStart(8, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
