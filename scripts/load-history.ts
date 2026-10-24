/** Flat sheets only. Every RPC is a complete table transaction; service key only. */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { pathToFileURL } from 'node:url';
import { readWorkbook, sheet, type Row } from './history-workbook';
export type ImportDb = Pick<SupabaseClient, 'from' | 'rpc'>;
export async function loadHistory(db: ImportDb) {
    const w = await readWorkbook();
    const sheets = Object.fromEntries(['users', 'projects', 'cp_firms', 'channel_partners', 'leads', 'interactions', 'cp_interactions', 'bookings', 'issues'].map(n => [n, sheet(w, n)]));
    const maps: Record<string, Map<string, string>> = {};
    const profiles = await db.from('profiles').select('id,legacy_key,branch_id').is('deleted_at', null);
    if (profiles.error)
        throw profiles.error;
    maps.profiles = new Map((profiles.data ?? []).map(p => [p.legacy_key, p.id]));
    const branches = new Map((profiles.data ?? []).map(p => [p.legacy_key, p.branch_id]));
    const id = (table: string, key: Row[string], optional = false): string | null => {
        if (!key && optional)
            return null;
        const v = maps[table]?.get(String(key));
        if (!v)
            throw new Error(`Unmapped ${table} key ${key}. Run seed:users first for users.`);
        return v;
    };
    for (const r of sheets.users)
        id('profiles', r.user_key);
    const branchIds = new Set(sheets.users.map(r => branches.get(String(r.user_key))));
    if (branchIds.size !== 1)
        throw new Error('This workbook must belong to exactly one seeded branch');
    const branch_id = [...branchIds][0];
    const list = (v: Row[string]) => v ? String(v).split(/\s*\|\s*|\s*,\s*/).filter(Boolean) : [];
    const base = (r: Row, key: Row[string]) => ({ legacy_key: String(key), is_historical: true, branch_id, raw_json: r });
    async function load(table: string, rows: Record<string, unknown>[]) {
        const res = await db.rpc('load_history_table', { p_table: table, p_rows: rows });
        if (res.error)
            throw new Error(`${table}: ${res.error.message}`);
        const all = await db.from(table).select('id,legacy_key').not('legacy_key', 'is', null).range(0, 9999);
        if (all.error)
            throw all.error;
        maps[table] = new Map((all.data ?? []).map(r => [r.legacy_key, r.id]));
        console.log(`${table}: ${res.data} rows loaded`);
    }
    await load('profiles', sheets.users.map(r => ({ legacy_key: r.user_key, is_historical: true })));
    // Existing seeded projects have a name but no legacy key. Attach it first through
    // the RPC's project-name match, preserving the UUID used elsewhere.
    await load('projects', sheets.projects.map(r => ({ legacy_key: r.project_name, name: r.project_name, aliases_seen: r.aliases_seen, is_historical: true })));
    await load('cp_firms', sheets.cp_firms.map(r => ({ ...base(r, r.firm_key), name: r.firm_name, aliases_seen: r.aliases_seen, is_freelancer_bucket: r.is_freelancer_bucket, cp_people_count: r.cp_people_count, booking_rows_count: r.booking_rows_count })));
    await load('channel_partners', sheets.channel_partners.map(r => ({ ...base(r, r.cp_key), name: r.cp_name, firm: r.firm_name, firm_id: id('cp_firms', r.firm_key, true), normalized_key: `legacy:${r.cp_key}`, current_rating: r.current_rating, first_met_on: r.first_met_on, last_met_on: r.last_met_on, last_touch_at: r.last_met_on, meetings_count: r.meetings_count, associates_met: list(r.associates_met), created_from: r.created_from })));
    await load('leads', sheets.leads.map(r => ({ ...base(r, r.lead_key), name: r.customer_name, owner_id: id('profiles', r.associate_key), project_id: id('projects', r.project, true), phone: r.phone, name_variants: r.name_variants, created_from: r.created_from, created_on: r.created_on, last_touch_on: r.last_touch_on, last_touch_at: r.last_touch_on, meetings_count: r.meetings_count, current_rating: r.current_rating, plot_names: list(r.current_plot_numbers), next_action: r.next_action, next_action_date: r.next_action_date, status: r.status || 'open', source: r.source_type, cp_firm_name: r.cp_firm_name })));
    const provenance = (r: Row) => ({ date_estimated: r.date_estimated, next_action_date_original: r.next_action_date_original, source_tab: r.source_tab, source_row: r.source_row });
    const interaction = (r: Row) => ({ associate_id: id('profiles', r.associate_key), occurred_on: r.occurred_on, rating_before: r.rating_before, rating_after: r.rating_after, remark: r.remark, next_action: r.next_action, next_action_date: r.next_action_date, ...provenance(r) });
    await load('interactions', sheets.interactions.map(r => ({ ...base(r, r.interaction_key), ...interaction(r), lead_id: id('leads', r.lead_key), interaction_type: 'meeting', mode: r.mode, project_id: id('projects', r.project, true), plot_names: list(r.plot_numbers), cold_reason: r.cold_reason, customer_name_as_written: r.customer_name_as_written, phone_as_written: r.phone_as_written })));
    await load('cp_interactions', sheets.cp_interactions.map(r => ({ ...base(r, r.cp_interaction_key), ...interaction(r), cp_id: id('channel_partners', r.cp_key), cp_name_as_written: r.cp_name_as_written, firm_as_written: r.firm_as_written })));
    await load('bookings', sheets.bookings.map(r => ({ ...base(r, r.booking_key), lead_id: id('leads', r.lead_key), associate_id: id('profiles', r.associate_key), project_id: id('projects', r.project, true), plot_no: r.plot_number, value: r.booking_value, booking_date: r.booking_date, status: r.status, source: r.source_type, cp_firm_key: r.cp_firm_key, cp_firm_name: r.cp_firm_name, cp_sub_partner: r.cp_sub_partner, cp_text_as_written: r.cp_text_as_written, link_confidence: r.link_confidence, remarks: r.remark, source_tab: r.source_tab, source_row: r.source_row })));
    await load('data_quality_issues', sheets.issues.map(r => ({ ...base(r, r.issue_id), severity: r.severity, issue_type: r.issue_type, table_name: r.table_name, record_key: r.record_key, record_ids: list(r.record_key).map(k => id(String(r.table_name), k)), associate_id: id('profiles', r.associate_key, true), source_tab: r.source_tab, source_row: r.source_row, detail: r.detail, action_taken: r.action_taken })));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key)
        throw new Error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
    loadHistory(createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })).catch(e => { console.error(e.message); process.exitCode = 1; });
}
