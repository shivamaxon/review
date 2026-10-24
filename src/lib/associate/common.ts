import type { EntryKind, Payload } from './types';
export const normalize = (v: unknown) => String(v ?? '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
export const todayIndia = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
export const addDays = (day: string, n: number) => { const d = new Date(day + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const money = (n: unknown) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(n ?? 0));
export const CUSTOMER_DEFINITIONS = { hot: 'Budget & location OK; visit done/planned, price shared, plot selection; close in 10 days.', warm: 'In-person + virtual done, budget OK; no urgency or plot selected.', cold: 'Not interested — capture the reason and nurturing plan.' };
// The supplied template has customer definitions only. CP wording is explicit and configurable here.
export const CP_DEFINITIONS = { active: 'Actively sourcing customers and working with us.', hot: 'Likely business within 10 days.', warm: 'Interested, with no immediate business.', cold: 'Inactive or not interested; agree a nurturing plan.' };
export function validateEntry(kind: EntryKind, p: Payload): string[] {
    const errors: string[] = [];
    if (kind === 'customer' || kind === 'booking') {
        if (!p.lead_id && !String(p.name ?? '').trim())
            errors.push('Enter a customer name.');
    }
    if (kind === 'customer') {
        if (!['hot', 'warm', 'cold'].includes(String(p.rating_after)))
            errors.push('Choose Hot, Warm or Cold.');
        if (!isDate(p.occurred_on))
            errors.push('Choose a valid meeting date.');
        if (p.rating_after === 'hot') {
            if (!Array.isArray(p.plot_names) || !p.plot_names.some(x => String(x).trim()))
                errors.push('Choose at least one plot for a Hot lead.');
            if (!isDate(p.next_action_date) || String(p.next_action_date) < String(p.occurred_on) || String(p.next_action_date) > addDays(String(p.occurred_on), 7))
                errors.push('Hot needs a next-action date within 7 days of the meeting.');
        }
        if (p.rating_after === 'cold' && !String(p.cold_reason ?? '').trim())
            errors.push('Choose a Cold reason.');
    }
    if (kind === 'cp') {
        if (!p.cp_id && !String(p.name ?? '').trim())
            errors.push('Enter a CP name.');
        if (!['active', 'hot', 'warm', 'cold'].includes(String(p.rating_after)))
            errors.push('Choose a CP rating.');
        if (!isDate(p.occurred_on))
            errors.push('Choose a valid meeting date.');
    }
    if (kind === 'booking' || kind === 'edit_booking') {
        const b = kind === 'edit_booking' ? p.patch as Payload : p;
        if (b.status === 'cancelled' && !String(b.cancel_reason ?? '').trim())
            errors.push('Add a cancellation reason.');
        if (kind === 'booking') {
            if (!String(b.plot_no ?? '').trim())
                errors.push('Choose a plot.');
            if (!isDate(b.booking_date))
                errors.push('Choose a booking date.');
            if (!['token', 'booking_done', 'agreement_signed', 'cancelled'].includes(String(b.status)))
                errors.push('Choose a booking status.');
            if (!['cp', 'direct', 'referral', 'walk_in'].includes(String(b.source)))
                errors.push('Choose a source.');
            if (b.source === 'cp' && !b.cp_id)
                errors.push('Choose a channel partner.');
            if (b.value !== '' && b.value != null && (!Number.isFinite(Number(b.value)) || Number(b.value) < 0))
                errors.push('Enter a valid booking value.');
        }
    }
    return errors;
}
export function isDate(v: unknown): boolean { return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) && new Date(v + 'T12:00:00Z').toISOString().slice(0, 10) === v; }
export function warnings(p: Payload): string[] { const out = []; if (p.rating_after === 'cold' && /clos(?:e|ed|ure|ing)|book(?:ing|ed)?|token/i.test(String(p.remark ?? '')))
    out.push('Your remark mentions a closure, booking or token. Check whether Cold is the right rating.'); if (p.next_action_date && String(p.next_action_date) < todayIndia())
    out.push('This next-action date is in the past. Save it if that is intentional.'); return out; }
