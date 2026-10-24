import { createClient } from '@supabase/supabase-js';
import { pathToFileURL } from 'node:url';
import { readWorkbook, reconciliation } from './history-workbook';
import type { ImportDb } from './load-history';
export async function verifyHistory(db: ImportDb) {
    const expected = reconciliation(await readWorkbook());
    const { data, error } = await db.rpc('history_metrics');
    if (error)
        throw error;
    const keys = ['meetings', 'hot', 'warm', 'cold', 'unrated', 'cp_meetings', 'bookings', 'booking_value'];
    const actual = new Map((data as Record<string, unknown>[]).map(r => [String(r.associate_key), r]));
    const results: Record<string, unknown>[] = [];
    for (const row of expected)
        for (const k of keys) {
            const got = Number(actual.get(String(row.associate_key))?.[k] ?? NaN);
            results.push({ associate: row.associate_key, metric: k, expected: row[k], actual: got, result: got === row[k] ? 'PASS' : 'FAIL' });
        }
    const totals = [291, 43, 153, 91, 4, 292, 20, 50222126];
    keys.forEach((k, i) => { const got = (data as Record<string, unknown>[]).reduce((sum, r) => sum + Number(r[k]), 0); results.push({ associate: 'TOTAL', metric: k, expected: totals[i], actual: got, result: got === totals[i] ? 'PASS' : 'FAIL' }); });
    console.table(results);
    if (results.some(r => r.result === 'FAIL'))
        throw new Error('HISTORY VERIFICATION FAILED: database differs from reconciliation.');
    console.log('All 80 historical verification checks PASS.');
    return results;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key)
        throw new Error('Missing service role configuration');
    verifyHistory(createClient(url, key, { auth: { persistSession: false } })).catch(e => { console.error(e.message); process.exitCode = 1; });
}
