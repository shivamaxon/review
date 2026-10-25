import { test } from 'node:test';
import assert from 'node:assert/strict';
// The shared harness runs the actual migrations in PostgreSQL.
import { createDb } from '../supabase/tests/harness.mjs';
import { loadHistory, type ImportDb } from './load-history';
import { verifyHistory } from './verify-history';
import { readWorkbook, sheet } from './history-workbook';
test('real flat workbook: load twice, preserve sheet state, verify SQL metrics and rollback', async () => {
    const { db, admin, as, anon } = await createDb();
    try {
        const [branch] = await admin("insert into branches(name) values('Delhi NCR') returning id");
        for (const r of sheet(await readWorkbook(), 'users')) {
            const [user] = await admin('insert into auth.users(id,email) values(gen_random_uuid(),$1) returning id', [r.email]);
            await admin('insert into profiles(id,branch_id,full_name,role,legacy_key,must_change_password) values($1,$2,$3,$4,$5,false)', [user.id, branch.id, r.full_name, r.role, r.user_key]);
        }
        // Model the seed-created project before import.
        await admin("insert into projects(name) values('Kudal')");
        const adapter = { rpc: async (name: string, p: Record<string, unknown> = {}) => { try {
                return { data: name === 'load_history_table' ? (await admin('select load_history_table($1,$2) n', [p.p_table, JSON.stringify(p.p_rows)]))[0].n : await admin('select * from history_metrics()'), error: null };
            }
            catch (e) {
                return { data: null, error: { message: (e as Error).message } };
            } },
            from: (table: string) => ({ select: () => { const query = { is: async () => ({ data: await admin(`select * from ${table} where deleted_at is null`), error: null }), not: () => ({ range: async () => ({ data: await admin(`select id,legacy_key from ${table} where legacy_key is not null`), error: null }) }) }; return query; } }) } as unknown as ImportDb;
        await loadHistory(adapter);
        await verifyHistory(adapter);
        const [metricOwner] = await admin("select id from profiles where legacy_key='parul'");
        assert.equal((await as(metricOwner.id, "select customer_meetings from team_metrics('2026-01-01','2026-12-31',false)"))[0].customer_meetings, 0);
        assert.equal((await as(metricOwner.id, "select customer_meetings from team_metrics('2026-01-01','2026-12-31',true)"))[0].customer_meetings, 162);
        for (const row of sheet(await readWorkbook(), 'leads')) {
            const [stored] = await admin('select current_rating,next_action,next_action_date::text,last_touch_on::text,status from leads where legacy_key=$1', [row.lead_key]);
            assert.equal(stored.current_rating, row.current_rating);
            assert.equal(stored.next_action, row.next_action);
            assert.equal(stored.next_action_date, row.next_action_date);
            assert.equal(stored.last_touch_on, row.last_touch_on);
            assert.equal(stored.status, row.status);
        }
        const state = await admin('select legacy_key,current_rating,next_action,next_action_date,last_touch_at from leads order by legacy_key');
        await loadHistory(adapter);
        assert.deepEqual(await admin('select legacy_key,current_rating,next_action,next_action_date,last_touch_at from leads order by legacy_key'), state);
        await verifyHistory(adapter);
        assert.equal((await admin('select count(*)::int n from data_quality_issues'))[0].n, 250);
        assert.equal((await admin("select count(*)::int n from data_quality_issues where issue_type='plot_double_booked' and cardinality(record_ids)=2"))[0].n, 3);
        assert.equal((await admin("select count(*)::int n from leads where not is_historical and next_action_date<=current_date"))[0].n, 0);
        assert.equal((await admin("select count(*)::int n from pg_trigger where not tgisinternal and tgenabled='D'"))[0].n, 0);
        await assert.rejects(admin('select load_history_table($1,$2)', ['interactions', JSON.stringify([{ legacy_key: 'BAD', is_historical: true }])]), /null value/);
        assert.equal((await admin("select count(*)::int n from pg_trigger where not tgisinternal and tgenabled='D'"))[0].n, 0);
        const [owner] = await admin("select id from profiles where role in ('branch_admin','super_admin') limit 1");
        const [associate] = await admin("select id from profiles where legacy_key='parul'");
        const [issue] = await admin("select * from data_quality_issues where issue_type='plot_double_booked' order by legacy_key limit 1");
        assert.equal((await as(associate.id, 'select count(*)::int n from data_quality_issues'))[0].n, 0);
        await assert.rejects(as(associate.id, 'select resolve_quality_issue($1,$2)', [issue.id, 'both_valid']), /Administrator required/);
        await assert.rejects(as(associate.id, 'select load_history_table($1,$2)', ['leads', '[]']), /permission denied/);
        await assert.rejects(anon('select * from data_quality_issues'), /permission denied/);
        await as(owner.id, 'select resolve_quality_issue($1,$2,null,$3,$4)', [issue.id, 'assign', '{}', associate.id]);
        assert.equal((await as(associate.id, 'select count(*)::int n from data_quality_issues'))[0].n, 1);
        await as(owner.id, 'select resolve_quality_issue($1,$2)', [issue.id, 'keep_a']);
        const [loser] = await admin('select * from bookings where id=$1', [issue.record_ids[1]]);
        assert.ok(loser.deleted_at);
        const [correctable] = await admin("select q.* from data_quality_issues q join interactions i on i.id=q.record_ids[1] where table_name='interactions' and cardinality(record_ids)=1 and q.status='open' and i.associate_id=$1 limit 1", [associate.id]);
        await assert.rejects(as(owner.id, 'select resolve_quality_issue($1,$2,$3,$4)', [correctable.id, 'fix', correctable.record_ids[0], JSON.stringify({ owner_id: associate.id })]), /Field cannot be edited/);
        await assert.rejects(as(owner.id, 'select resolve_quality_issue($1,$2,$3,$4)', [correctable.id, 'fix', correctable.record_ids[0], JSON.stringify({ rating_after: 'invalid' })]), /invalid input/);
        assert.equal((await admin("select count(*)::int n from pg_trigger where not tgisinternal and tgenabled='D'"))[0].n, 0);
        await as(owner.id, 'select resolve_quality_issue($1,$2,$3,$4)', [correctable.id, 'fix', correctable.record_ids[0], JSON.stringify({ remark: 'Corrected by admin' })]);
        assert.equal((await admin('select remark from interactions where id=$1', [correctable.record_ids[0]]))[0].remark, 'Corrected by admin');
        await assert.rejects(as(associate.id, "update interactions set remark='attempt' where id=$1", [correctable.record_ids[0]]), /append-only/);
        const [other] = await admin("insert into branches(name) values('Other branch') returning id");
        const [otherUser] = await admin('insert into auth.users(id) values(gen_random_uuid()) returning id');
        await admin("insert into profiles(id,branch_id,full_name,role,must_change_password) values($1,$2,'Other admin','branch_admin',false)", [otherUser.id, other.id]);
        await assert.rejects(as(otherUser.id, 'select resolve_quality_issue($1,$2)', [issue.id, 'ok']), /not accessible/);
        const [second] = await admin("select * from data_quality_issues where issue_type='plot_double_booked' and status='open' order by legacy_key limit 1");
        await as(owner.id, 'select resolve_quality_issue($1,$2)', [second.id, 'keep_b']);
        assert.ok((await admin('select deleted_at from bookings where id=$1', [second.record_ids[0]]))[0].deleted_at);
        const [third] = await admin("select * from data_quality_issues where issue_type='plot_double_booked' and status='open' limit 1");
        await as(owner.id, 'select resolve_quality_issue($1,$2)', [third.id, 'both_valid']);
        assert.equal((await admin('select count(*)::int n from bookings where id=any($1::uuid[]) and deleted_at is null', [third.record_ids]))[0].n, 2);
        const [sourceIssue] = await admin("select * from data_quality_issues where cardinality(record_ids)=0 and status='open' limit 1");
        await as(owner.id, 'select resolve_quality_issue($1,$2)', [sourceIssue.id, 'ok']);
        assert.equal((await admin('select status from data_quality_issues where id=$1', [sourceIssue.id]))[0].status, 'accepted');
        await loadHistory(adapter);
        assert.ok((await admin('select deleted_at from bookings where id=$1', [loser.id]))[0].deleted_at);
        assert.equal((await admin('select remark from interactions where id=$1', [correctable.record_ids[0]]))[0].remark, 'Corrected by admin');
        assert.equal((await admin('select count(*)::int n from booking_status_history'))[0].n, 46);
        assert.ok((await admin("select count(*)::int n from audit_log where table_name='data_quality_issues' and action='UPDATE'"))[0].n >= 5);
    }
    finally {
        await db.close();
    }
});
