/** Explicit live import with project and unrelated-row checks; never creates logins. */
import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { loadHistory } from './load-history';
import { verifyHistory } from './verify-history';
import { readWorkbook, sheet } from './history-workbook';
async function main() {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const host = new URL(url).host;
    if (host !== 'jxduyylphokqpignybpz.supabase.co')
        throw new Error(`Unexpected live project: ${host}`);
    const db = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
    const w = await readWorkbook();
    const sources: Record<string, Set<string>> = {};
    for (const [table, tab, key] of [['profiles', 'users', 'user_key'], ['projects', 'projects', 'project_name'], ['cp_firms', 'cp_firms', 'firm_key'], ['channel_partners', 'channel_partners', 'cp_key'], ['leads', 'leads', 'lead_key'], ['interactions', 'interactions', 'interaction_key'], ['cp_interactions', 'cp_interactions', 'cp_interaction_key'], ['bookings', 'bookings', 'booking_key'], ['data_quality_issues', 'issues', 'issue_id']]) {
        sources[table] = new Set(sheet(w, tab).map(r => String(r[key])));
    }
    async function snapshot() {
        const result: Record<string, string> = {};
        for (const [table, keys] of Object.entries(sources)) {
            const rows: Record<string, unknown>[] = [];
            for (let offset = 0;; offset += 1000) {
                const { data, error } = await db.from(table).select('*').order('id').range(offset, offset + 999);
                if (error)
                    throw new Error(`${table} preflight: ${error.message}`);
                rows.push(...data);
                if (data.length < 1000)
                    break;
            }
            const unrelated = rows.filter(r => !keys.has(String(r.legacy_key)) && !(table === 'projects' && keys.has(String(r.name))));
            result[table] = createHash('sha256').update(JSON.stringify(unrelated)).digest('hex');
        }
        return result;
    }
    console.log(`LIVE project confirmed: ${host}. No user seed or auth writes.`);
    const before = await snapshot();
    await loadHistory(db);
    const results = await verifyHistory(db); // Failure aborts here: no further work.
    const after = await snapshot();
    for (const table of Object.keys(before))
        if (before[table] !== after[table])
            throw new Error(`Unrelated rows changed in ${table}`);
    console.log('PASS: unrelated rows unchanged in all nine tables.');
    const lines = ['# Live historical reconciliation', '', `Project: \`${host}\`. Run: ${new Date().toISOString()}.`, '', 'All checks below were recomputed from the live database. No users were recreated; unrelated rows were checked before and after and remained unchanged.', '', '| Associate | Metric | Expected | Actual | Result |', '|---|---|---:|---:|---|', ...results.map(r => `| ${r.associate} | ${r.metric} | ${r.expected} | ${r.actual} | ${r.result} |`)];
    writeFileSync('docs/HISTORY_RECONCILIATION.md', lines.join('\n') + '\n');
}
main().catch(e => { console.error('STOPPED:', e.message); process.exitCode = 1; });
