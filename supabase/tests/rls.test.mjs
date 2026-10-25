// Run with:  npm run test:db
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import { createDb } from './harness.mjs';

// ---- fixed ids so failures are readable
const B1 = '10000000-0000-0000-0000-000000000001'; // Delhi NCR
const B2 = '10000000-0000-0000-0000-000000000002'; // another branch
const U = {
  SA:  '20000000-0000-0000-0000-000000000001', // super_admin  (B1)
  BA1: '20000000-0000-0000-0000-000000000002', // branch_admin (B1)
  BA2: '20000000-0000-0000-0000-000000000003', // branch_admin (B2)
  TL:  '20000000-0000-0000-0000-000000000004', // team_lead    (B1)  -> A1, TL_SUB
  TLS: '20000000-0000-0000-0000-000000000005', // team_lead    (B1)  -> A3   (reports to TL)
  A1:  '20000000-0000-0000-0000-000000000006', // associate    (B1)  reports to TL
  A2:  '20000000-0000-0000-0000-000000000007', // associate    (B1)  reports to BA1 (NOT under TL)
  A3:  '20000000-0000-0000-0000-000000000008', // associate    (B1)  reports to TLS (grand-report of TL)
  A4:  '20000000-0000-0000-0000-000000000009', // associate    (B2)
};
const PROJECT = '30000000-0000-0000-0000-000000000001';
const LEAD = { A1: '40000000-0000-0000-0000-000000000001', A2: '40000000-0000-0000-0000-000000000002',
               A3: '40000000-0000-0000-0000-000000000003', A4: '40000000-0000-0000-0000-000000000004' };

let t; // { admin, as, anon }

before(async () => {
  t = await createDb();
  const { admin } = t;
  await admin(`insert into branches (id, name) values ($1,'Delhi NCR'), ($2,'Mumbai')`, [B1, B2]);
  const people = [
    ['SA', B1, 'super_admin', null], ['BA1', B1, 'branch_admin', null], ['BA2', B2, 'branch_admin', null],
    ['TL', B1, 'team_lead', null], ['TLS', B1, 'team_lead', 'TL'],
    ['A1', B1, 'associate', 'TL'], ['A2', B1, 'associate', 'BA1'], ['A3', B1, 'associate', 'TLS'], ['A4', B2, 'associate', null],
  ];
  for (const [k] of people) await admin(`insert into auth.users (id, email) values ($1,$2)`, [U[k], `${k}@test.local`]);
  for (const [k, b, role] of people)
    await admin(`insert into profiles (id, branch_id, full_name, email, role, must_change_password) values ($1,$2,$3,$4,$5,false)`,
      [U[k], b, `User ${k}`, `${k}@test.local`, role]);
  for (const [k, , , boss] of people) if (boss) await admin(`update profiles set reports_to=$1 where id=$2`, [U[boss], U[k]]);

  await admin(`insert into projects (id, name) values ($1,'Kudal')`, [PROJECT]);
  for (const k of ['A1', 'A2', 'A3', 'A4'])
    await admin(`insert into leads (id, name, phone, owner_id, project_id, current_rating) values ($1,$2,$3,$4,$5,'cold')`,
      [LEAD[k], `Lead of ${k}`, `98000000${k.slice(1)}0`, U[k], PROJECT]);
  await admin(`insert into review_cycle (branch_id, label, start_day, end_day, sort_order) values
      ($1,'1-10',1,10,1), ($1,'11-20',11,20,2), ($1,'21-end',21,null,3)`, [B1]);
  for (const k of ['A1', 'A2', 'A3', 'A4']) {
    await admin(`insert into interactions (lead_id, associate_id, occurred_on, rating_after, remark) values ($1,$2,'2026-05-01','warm',$3)`,
      [LEAD[k], U[k], `first meeting of ${k}`]);
    await admin(`insert into bookings (lead_id, associate_id, plot_no, value, status) values ($1,$2,'P-1',1000,'booking_done')`, [LEAD[k], U[k]]);
  }
});

const ids = (rows) => rows.map((r) => r.id).sort();
const rejects = (p, re) => assert.rejects(p, re);

// =============================================================== the headline requirement
test('associate cannot read another associate\'s leads', async () => {
  const mine = await t.as(U.A1, `select id from leads`);
  assert.deepEqual(ids(mine), [LEAD.A1]);
  const theirs = await t.as(U.A1, `select id from leads where id = $1`, [LEAD.A2]);
  assert.equal(theirs.length, 0);
});

test('associate cannot read another associate\'s interactions, bookings, history', async () => {
  for (const table of ['interactions', 'bookings', 'booking_status_history']) {
    const rows = await t.as(U.A1, `select associate_id from ${table}`);
    assert.ok(rows.length >= 1, `${table}: should see own rows`);
    assert.ok(rows.every((r) => r.associate_id === U.A1), `${table}: only own rows`);
  }
});

test('associate cannot write into someone else\'s data', async () => {
  // create a lead owned by someone else
  await rejects(t.as(U.A1, `insert into leads (name, owner_id) values ('x',$1)`, [U.A2]), /row-level security/);
  // log an interaction on someone else's lead
  await rejects(t.as(U.A1, `insert into interactions (lead_id, rating_after) values ($1,'hot')`, [LEAD.A2]), /row-level security/);
  // book someone else's lead
  await rejects(t.as(U.A1, `insert into bookings (lead_id, status) values ($1,'token')`, [LEAD.A2]), /row-level security/);
  // update someone else's lead: silently affects 0 rows
  const upd = await t.as(U.A1, `update leads set name='hacked' where id=$1 returning id`, [LEAD.A2]);
  assert.equal(upd.length, 0);
  const still = await t.admin(`select name from leads where id=$1`, [LEAD.A2]);
  assert.equal(still[0].name, 'Lead of A2');
});

test('associate cannot read profiles of others, the audit log, or other branches', async () => {
  assert.deepEqual(ids(await t.as(U.A1, `select id from profiles`)), [U.A1]);
  assert.equal((await t.as(U.A1, `select id from audit_log`)).length, 0);
  assert.equal((await t.as(U.A1, `select id from branches`)).length, 1);
});

// =============================================================== hierarchy
test('team lead sees self + direct + indirect reports, nobody else', async () => {
  const leads = await t.as(U.TL, `select id from leads`);
  assert.deepEqual(ids(leads), [LEAD.A1, LEAD.A3].sort()); // A3 is a grand-report via TLS
  assert.ok(!ids(leads).includes(LEAD.A2));
  const prof = await t.as(U.TL, `select id from profiles`);
  assert.deepEqual(ids(prof), [U.TL, U.TLS, U.A1, U.A3].sort());
});

test('junior team lead only sees own reports (not their boss\'s other people)', async () => {
  assert.deepEqual(ids(await t.as(U.TLS, `select id from leads`)), [LEAD.A3]);
});

test('branch admin sees the whole branch but not other branches', async () => {
  const leads = await t.as(U.BA1, `select id from leads`);
  assert.deepEqual(ids(leads), [LEAD.A1, LEAD.A2, LEAD.A3].sort());
  assert.ok(!ids(leads).includes(LEAD.A4));
});

test('super admin sees every branch', async () => {
  assert.deepEqual(ids(await t.as(U.SA, `select id from leads`)), Object.values(LEAD).sort());
  assert.equal((await t.as(U.SA, `select id from branches`)).length, 2);
});

test('reporting loops cannot hang the visibility query', async () => {
  await t.admin(`update profiles set reports_to=$1 where id=$2`, [U.TLS, U.TL]); // TL <-> TLS loop
  const rows = await t.as(U.TL, `select id from leads`);
  assert.ok(rows.length >= 1);
  await t.admin(`update profiles set reports_to=null where id=$1`, [U.TL]);
});

test('logged-out visitors get nothing but ping()', async () => {
  await rejects(t.anon(`select * from leads`), /permission denied/);
  await rejects(t.anon(`select * from profiles`), /permission denied/);
  const [r] = await t.anon(`select ping() as now`);
  assert.ok(r.now);
});

// =============================================================== privilege escalation
test('a user cannot promote themselves or move branch', async () => {
  await rejects(t.as(U.A1, `update profiles set role='super_admin' where id=$1`, [U.A1]), /cannot change role/);
  await rejects(t.as(U.A1, `update profiles set branch_id=$1 where id=$2`, [B2, U.A1]), /cannot change role/);
  await rejects(t.as(U.A1, `update profiles set active=true, reports_to=null where id=$1`, [U.A1]), /cannot change role/);
  // ...but can clear their own must_change_password flag and edit their name
  await t.as(U.A1, `update profiles set full_name='Renamed A1', must_change_password=false where id=$1`, [U.A1]);
});

test('associates cannot edit config or targets', async () => {
  await rejects(t.as(U.A1, `insert into cold_reasons (label) values ('x')`), /row-level security/);
  await rejects(t.as(U.A1, `insert into targets (branch_id, associate_id, month, bookings) values ($1,$2,'2026-05-01',5)`, [B1, U.A1]),
    /row-level security/);
  await t.as(U.TL, `insert into targets (branch_id, associate_id, month, bookings) values ($1,$2,'2026-05-01',5)`, [B1, U.A1]);
  await rejects(t.as(U.TL, `insert into targets (branch_id, associate_id, month, bookings) values ($1,$2,'2026-05-01',5)`, [B1, U.A2]),
    /row-level security/); // A2 is not under TL
});

test('branch admin cannot edit another branch\'s review cycle', async () => {
  await rejects(t.as(U.BA2, `insert into review_cycle (branch_id,label,start_day) values ($1,'hack',1)`, [B1]), /row-level security/);
});

// =============================================================== triggers: rating history
test('interactions update the lead and record rating_before', async () => {
  const L = '40000000-0000-0000-0000-0000000000a1';
  await t.as(U.A1, `insert into leads (id, name, project_id) values ($1,'Movement Lead',$2)`, [L, PROJECT]);
  const add = (date, after, extra = '') =>
    t.as(U.A1, `insert into interactions (lead_id, occurred_on, rating_after, remark, next_action, next_action_date, mode) values ($1,$2,$3,$4,$5,$6,'in_person') returning id, rating_before`,
      [L, date, after, `remark ${extra}`, `act ${extra}`, '2026-12-01']);

  const [i1] = await add('2026-05-01', 'cold', '1');
  const [i2] = await add('2026-05-05', 'warm', '2');
  const [i3] = await add('2026-05-10', 'hot', '3');
  assert.equal(i1.rating_before, null, 'first contact has no previous rating');
  assert.equal(i2.rating_before, 'cold');
  assert.equal(i3.rating_before, 'warm');

  let [lead] = await t.admin(`select * from leads where id=$1`, [L]);
  assert.equal(lead.current_rating, 'hot');
  assert.equal(lead.next_action, 'act 3');
  assert.equal(String(lead.next_action_date.toISOString?.().slice(0, 10) ?? lead.next_action_date), '2026-12-01');
  assert.ok(lead.last_touch_at, 'last_touch_at set');
  assert.equal(lead.branch_id, B1, 'branch filled from owner');

  // back-dated entry must not overwrite newer state, and gets the right rating_before
  const [back] = await add('2026-05-03', 'cold', 'backdated');
  assert.equal(back.rating_before, 'cold');
  [lead] = await t.admin(`select current_rating, next_action from leads where id=$1`, [L]);
  assert.equal(lead.current_rating, 'hot');
  assert.equal(lead.next_action, 'act 3');

  // soft-deleting the newest rolls the lead back to the previous interaction
  await t.as(U.A1, `update interactions set deleted_at = now() where id=$1`, [i3.id]);
  [lead] = await t.admin(`select current_rating from leads where id=$1`, [L]);
  assert.equal(lead.current_rating, 'warm');
});

test('cold reason is kept only while the lead is cold', async () => {
  const L = '40000000-0000-0000-0000-0000000000a2';
  await t.as(U.A1, `insert into leads (id, name) values ($1,'Cold Lead')`, [L]);
  await t.as(U.A1, `insert into interactions (lead_id, occurred_on, rating_after, cold_reason) values ($1,'2026-06-01','cold','Budget')`, [L]);
  assert.equal((await t.admin(`select cold_reason from leads where id=$1`, [L]))[0].cold_reason, 'Budget');
  await t.as(U.A1, `insert into interactions (lead_id, occurred_on, rating_after) values ($1,'2026-06-05','warm')`, [L]);
  assert.equal((await t.admin(`select cold_reason from leads where id=$1`, [L]))[0].cold_reason, null);
});

test('history is append-only', async () => {
  const [row] = await t.as(U.A1, `select id from interactions limit 1`);
  await rejects(t.as(U.A1, `update interactions set rating_after='hot' where id=$1`, [row.id]), /append-only/);
  await rejects(t.admin(`update interactions set remark='edited' where id=$1`, [row.id]), /append-only/);
  await rejects(t.admin(`delete from interactions where id=$1`, [row.id]), /append-only/);
  await rejects(t.admin(`delete from audit_log`), /immutable/);
});

// =============================================================== triggers: CPs
test('CP interactions update the CP; duplicate CPs are blocked per branch', async () => {
  const [cp] = await t.as(U.A1, `insert into channel_partners (name, firm, phone) values ('Aashima Verma','Aarambh Luxe','+91 98100-12345') returning id, normalized_key, branch_id`);
  assert.equal(cp.normalized_key, 'p:9810012345');
  assert.equal(cp.branch_id, B1);

  const a = await t.as(U.A1, `insert into cp_interactions (cp_id, occurred_on, rating_after) values ($1,'2026-05-01','cold') returning rating_before`, [cp.id]);
  const b = await t.as(U.A1, `insert into cp_interactions (cp_id, occurred_on, rating_after, next_action) values ($1,'2026-05-09','active','Follow up') returning rating_before`, [cp.id]);
  assert.equal(a[0].rating_before, null);
  assert.equal(b[0].rating_before, 'cold');
  const [cur] = await t.admin(`select current_rating, next_action from channel_partners where id=$1`, [cp.id]);
  assert.equal(cur.current_rating, 'active');
  assert.equal(cur.next_action, 'Follow up');

  // same phone in same branch, even typed differently by a colleague => rejected
  await rejects(t.as(U.A2, `insert into channel_partners (name, phone) values ('A. Verma','09810012345')`), /duplicate key/);
  // same CP in another branch is fine
  await t.as(U.A4, `insert into channel_partners (name, phone) values ('Aashima','9810012345')`);
  // CP *meetings* stay private even though the directory is shared
  assert.equal((await t.as(U.A2, `select id from cp_interactions where cp_id=$1`, [cp.id])).length, 0);
  assert.equal((await t.as(U.A2, `select id from channel_partners where id=$1`, [cp.id])).length, 1);
  // other branch cannot see this CP
  assert.equal((await t.as(U.A4, `select id from channel_partners where id=$1`, [cp.id])).length, 0);
});

test('CP without a phone dedupes on name + firm', async () => {
  await t.as(U.A1, `insert into channel_partners (name, firm) values ('Raj Kumar','360 Realtor')`);
  await rejects(t.as(U.A2, `insert into channel_partners (name, firm) values ('raj  kumar','360 REALTOR')`), /duplicate key/);
});

// =============================================================== triggers: bookings
test('booking status changes are logged and drive lead status', async () => {
  const L = '40000000-0000-0000-0000-0000000000a3';
  await t.as(U.A1, `insert into leads (id, name, project_id, source) values ($1,'Booker',$2,'direct')`, [L, PROJECT]);
  const [b] = await t.as(U.A1, `insert into bookings (lead_id, plot_no, value, status) values ($1,'12',500000,'token') returning id, source, project_id, associate_id`, [L]);
  assert.equal(b.source, 'direct', 'source defaults from lead');
  assert.equal(b.project_id, PROJECT);
  assert.equal((await t.admin(`select status from leads where id=$1`, [L]))[0].status, 'open');

  await t.as(U.A1, `update bookings set status='booking_done' where id=$1`, [b.id]);
  assert.equal((await t.admin(`select status from leads where id=$1`, [L]))[0].status, 'booked');
  await t.as(U.A1, `update bookings set status='cancelled', cancel_reason='Family' where id=$1`, [b.id]);
  assert.equal((await t.admin(`select status from leads where id=$1`, [L]))[0].status, 'open');

  const hist = await t.as(U.A1, `select status_before, status_after from booking_status_history where booking_id=$1 order by changed_at`, [b.id]);
  assert.deepEqual(hist.map((h) => `${h.status_before ?? '-'}>${h.status_after}`), ['->token', 'token>booking_done', 'booking_done>cancelled']);
  // associates cannot forge history
  await rejects(t.as(U.A1, `insert into booking_status_history (booking_id, branch_id, associate_id, status_after) values ($1,$2,$3,'token')`, [b.id, B1, U.A1]),
    /row-level security/);
});

// =============================================================== audit
test('changes are written to the audit log (admins can read it)', async () => {
  const rows = await t.as(U.BA1, `select table_name, action from audit_log where table_name='bookings'`);
  assert.ok(rows.length > 0);
  assert.equal((await t.as(U.BA2, `select id from audit_log where branch_id=$1`, [B1])).length, 0, 'other branch admin sees nothing');
});

// =============================================================== metrics dictionary
test('metric dictionary: meetings, hot %, bookings, tokens, cancelled', async () => {
  // fresh associate with a controlled data set
  const M = '20000000-0000-0000-0000-0000000000f1';
  await t.admin(`insert into auth.users (id, email) values ($1,'m@test.local')`, [M]);
  await t.admin(`insert into profiles (id, branch_id, full_name, role, reports_to, must_change_password) values ($1,$2,'Metric Mia','associate',$3,false)`, [M, B1, U.TL]);
  const L1 = '40000000-0000-0000-0000-0000000000b1', L2 = '40000000-0000-0000-0000-0000000000b2', L3 = '40000000-0000-0000-0000-0000000000b3';
  for (const [l, n] of [[L1, 'm1'], [L2, 'm2'], [L3, 'm3']]) await t.admin(`insert into leads (id,name,owner_id) values ($1,$2,$3)`, [l, n, M]);
  const mtg = (l, d, r, type = 'meeting') => t.admin(`insert into interactions (lead_id, associate_id, occurred_on, rating_after, interaction_type) values ($1,$2,$3,$4,$5)`, [l, M, d, r, type]);
  await mtg(L1, '2026-05-02', 'warm'); await mtg(L1, '2026-05-08', 'hot');   // 2 meetings, ends hot
  await mtg(L2, '2026-05-03', 'warm');                                       // 1 meeting, ends warm
  await mtg(L2, '2026-05-04', 'hot', 'follow_up');                           // follow-up: NOT a meeting, not a rating for the period
  await mtg(L3, '2026-04-30', 'cold');                                       // outside period
  const bk = (l, status, v, d = '2026-05-09') => t.admin(`insert into bookings (lead_id, associate_id, value, status, booking_date) values ($1,$2,$3,$4,$5)`, [l, M, v, status, d]);
  await bk(L1, 'booking_done', 100); await bk(L1, 'agreement_signed', 50);
  await bk(L2, 'token', 10); await bk(L2, 'cancelled', 20); await bk(L3, 'booking_done', 999, '2026-06-01'); // last one outside period
  const cp = (await t.admin(`insert into channel_partners (branch_id,name,phone) values ($1,'MetricCP','9000000001') returning id`, [B1]))[0].id;
  await t.admin(`insert into cp_interactions (cp_id, associate_id, occurred_on, rating_after) values ($1,$2,'2026-05-02','warm')`, [cp, M]);
  await t.admin(`insert into cp_interactions (cp_id, associate_id, occurred_on, rating_after) values ($1,$2,'2026-05-06','active')`, [cp, M]);

  const [r] = await t.as(M, `select * from associate_metrics('2026-05-01','2026-05-10')`);
  assert.equal(r.customer_meetings, 3);
  assert.equal(r.leads_met, 2);
  assert.equal(r.hot_leads, 1);
  assert.equal(r.warm_leads, 1);
  assert.equal(r.cold_leads, 0);
  assert.equal(Number(r.hot_pct), 0.5);
  assert.equal(r.cps_met, 1);
  assert.equal(r.cp_active, 1);
  assert.equal(r.bookings, 2, 'booking_done + agreement_signed only');
  assert.equal(Number(r.booking_value), 150, 'tokens and cancelled excluded from value');
  assert.equal(r.tokens, 1);
  assert.equal(Number(r.token_value), 10);
  assert.equal(r.cancelled, 1);
  assert.equal(Number(r.cancelled_value), 20);

  // team lead sees Mia + their own people; totals add up
  const rows = await t.as(U.TL, `select associate_id from associate_metrics('2026-05-01','2026-05-10')`);
  assert.ok(rows.some((x) => x.associate_id === M));
  assert.ok(!rows.some((x) => x.associate_id === U.A2), 'A2 is outside TL\'s tree');
  const [tot] = await t.as(M, `select * from team_metrics('2026-05-01','2026-05-10')`);
  assert.equal(tot.bookings, 2);

  // an associate only ever gets their own row
  const own = await t.as(M, `select associate_id from associate_metrics('2026-05-01','2026-05-10')`);
  assert.deepEqual(own.map((x) => x.associate_id), [M]);
});

test('review period resolver (1-10 / 11-20 / 21-end)', async () => {
  const p = async (d) => (await t.as(U.TL, `select label, period_start::text s, period_end::text e from current_review_period($1::date)`, [d]))[0];
  assert.deepEqual(await p('2026-10-23'), { label: '21-end', s: '2026-10-21', e: '2026-10-31' });
  assert.deepEqual(await p('2026-02-15'), { label: '11-20', s: '2026-02-11', e: '2026-02-20' });
  assert.deepEqual(await p('2026-02-25'), { label: '21-end', s: '2026-02-21', e: '2026-02-28' });
  assert.deepEqual(await p('2026-05-01'), { label: '1-10', s: '2026-05-01', e: '2026-05-10' });
});

test('full-text search works on remarks', async () => {
  const rows = await t.as(U.A1, `select id from interactions where remark_tsv @@ plainto_tsquery('simple','first')`);
  assert.ok(rows.length >= 1);
  // Hindi (Devanagari) remarks are stored and searchable
  const L = '40000000-0000-0000-0000-0000000000c1';
  await t.as(U.A1, `insert into leads (id, name) values ($1,'हिंदी ग्राहक')`, [L]);
  await t.as(U.A1, `insert into interactions (lead_id, rating_after, remark) values ($1,'warm','ग्राहक परिवार से बात करेंगे')`, [L]);
  const hi = await t.as(U.A1, `select id from interactions where remark_tsv @@ plainto_tsquery('simple','परिवार')`);
  assert.equal(hi.length, 1);
});

// =============================================================== migration 5
test('legacy_key is unique and cannot be edited from the app', async () => {
  await t.admin(`update profiles set legacy_key='udit' where id=$1`, [U.A1]);
  await rejects(t.admin(`update profiles set legacy_key='udit' where id=$1`, [U.A2]), /duplicate key/);
  await rejects(t.as(U.A1, `update profiles set legacy_key='hacked' where id=$1`, [U.A1]), /cannot change role/);
  await t.admin(`update profiles set legacy_key=null where id=$1`, [U.A1]);
});

test('login_attempts is invisible to every browser role', async () => {
  await t.admin(`insert into login_attempts (email, ip, succeeded) values ('x@y.z','1.2.3.4',false)`);
  await rejects(t.as(U.SA, `select * from login_attempts`), /permission denied/);
  await rejects(t.anon(`select * from login_attempts`), /permission denied/);
  await rejects(t.as(U.A1, `insert into login_attempts (email, ip, succeeded) values ('a','b',true)`), /permission denied/);
});

// =============================================================== migration 6 dictionary
// Runs in CI without the private customer workbook.
test('historical dictionary counts rows, unknown ratings/dates and booking_done; dashboard history toggle respects RLS', async () => {
  const M = '20000000-0000-0000-0000-00000000d001';
  await t.admin('insert into auth.users(id) values($1)',[M]);
  await t.admin("insert into profiles(id,branch_id,full_name,role,legacy_key,must_change_password) values($1,$2,'History test','associate','history_test',false)",[M,B1]);
  const [lead] = await t.admin("insert into leads(name,owner_id,is_historical) values('History metric lead',$1,true) returning id", [M]);
  for (const rating of ['hot', 'warm', null]) {
    await t.admin("insert into interactions(lead_id,associate_id,occurred_on,rating_after,is_historical) values($1,$2,'2026-06-01',$3,true)", [lead.id, M, rating]);
  }
  const [cp] = await t.admin("insert into channel_partners(branch_id,name,is_historical) values($1,'History metric CP',true) returning id", [B1]);
  for (let i = 0; i < 2; i++) {
    await t.admin("insert into cp_interactions(cp_id,associate_id,occurred_on,rating_after,is_historical) values($1,$2,'2026-06-01','warm',true)", [cp.id, M]);
  }
  for (const [status, value, date] of [['booking_done',100,'2026-06-01'], ['booking_done',50,null], ['agreement_signed',200,'2026-06-01'], ['token',300,'2026-06-01'], ['cancelled',400,'2026-06-01']]) {
    await t.admin('insert into bookings(lead_id,associate_id,status,value,booking_date,is_historical) values($1,$2,$3,$4,$5,true)', [lead.id, M, status, value, date]);
  }
  const [historical] = await t.as(M, 'select * from history_metrics()');
  assert.deepEqual(Object.fromEntries(Object.entries(historical).map(([k,v]) => [k,k === 'associate_key' ? v : Number(v)])), {
    associate_key:'history_test', meetings:3, hot:1, warm:1, cold:0, unrated:1, cp_meetings:2, bookings:2, booking_value:150,
  });
  assert.deepEqual(await t.as(U.A2, 'select * from history_metrics()'), [], 'other associate cannot see the historical totals');
  const [hidden] = await t.as(M, "select * from associate_metrics('2026-06-01','2026-06-01',false)");
  assert.equal(hidden.customer_meetings, 0);
  assert.equal(hidden.cps_met, 0);
  assert.equal(hidden.bookings, 0);
  const [shown] = await t.as(M, "select * from associate_metrics('2026-06-01','2026-06-01',true)");
  assert.equal(shown.customer_meetings, 3);
  assert.equal(shown.leads_met, 1, 'dashboard retains distinct lead definition');
  assert.equal(shown.cps_met, 1, 'dashboard retains distinct CP definition');
  assert.equal(shown.bookings, 2, 'dashboard includes dated booking_done + agreement_signed');
  assert.equal(Number(shown.booking_value), 300);
});


test('associate atomic entry, duplicate guard, audited old edits, retry-safe sync and undo', async () => {
  const d=await createDb();
  try {
    const [b]=await d.admin("insert into branches(name) values('Associate flow test') returning id");
    const me=randomUUID(), other=randomUUID();
    for(const id of [me,other]){
      await d.admin('insert into auth.users(id) values($1)',[id]);
      await d.admin("insert into profiles(id,branch_id,full_name,must_change_password) values($1,$2,'Test associate',false)",[id,b.id]);
    }
    const cancelledRequest=randomUUID();await d.as(me,'select associate_undo($1)',[cancelledRequest]);
    const payload={name:'New Hot Customer',phone:'9876543210',occurred_on:'2026-10-24',mode:'in_person',rating_after:'hot',plot_names:['35'],next_action:'Call',next_action_date:'2026-10-25',source:'direct',site_visit_status:'planned'};
    const save=async(user,kind,p,id=randomUUID())=>(await d.as(user,'select associate_save($1,$2,$3) result',[kind,JSON.stringify(p),id]))[0].result;
    await assert.rejects(save(me,'customer',payload,cancelledRequest),/undone/);
    const req=randomUUID();const first=await save(me,'customer',payload,req);
    assert.ok(first.id);assert.ok(first.lead_id);
    assert.equal((await save(me,'customer',payload,req)).id,first.id);
    assert.equal((await d.admin('select count(*)::int n from interactions'))[0].n,1);
    const duplicate=await save(me,'customer',{...payload,name:'  New HOT Customer  '});
    assert.equal(duplicate.duplicate_lead_id,first.lead_id);
    await assert.rejects(save(me,'customer',{...payload,name:'Invalid Hot',phone:'',plot_names:[]}),/Hot needs/);
    assert.equal((await d.admin("select count(*)::int n from leads where name='Invalid Hot'"))[0].n,0,'failed save rolls back parent too');
    await assert.rejects(save(me,'customer',{...payload,name:'Invalid Cold',phone:'',rating_after:'cold',cold_reason:''}),/Cold reason/);
    await assert.rejects(save(other,'customer',{...payload,lead_id:first.lead_id}),/own customers/);
    await assert.rejects(save(other,'customer',payload,req),/not yours/);
    const follow=await save(me,'customer',{...payload,lead_id:first.lead_id,occurred_on:'2026-10-25',interaction_type:'follow_up',rating_after:'cold',cold_reason:'Timing',nurture_note:'Call in a month',plot_names:[],next_action_date:'2026-11-01'});
    let [old]=await d.admin('select * from interactions where id=$1',[first.id]);
    const editReq=randomUUID();await save(me,'edit_interaction',{id:first.id,expected_updated_at:old.updated_at,patch:{rating_after:'warm',remark:'Corrected older entry'}},editReq);
    assert.equal((await d.admin('select rating_before from interactions where id=$1',[follow.id]))[0].rating_before,'warm');
    assert.equal((await d.admin('select current_rating from leads where id=$1',[first.lead_id]))[0].current_rating,'cold','editing old row preserves latest state');
    await d.as(me,'select associate_undo($1)',[editReq]);
    assert.equal((await d.admin('select rating_after from interactions where id=$1',[first.id]))[0].rating_after,'hot');
    assert.equal((await d.admin('select rating_before from interactions where id=$1',[follow.id]))[0].rating_before,'hot');
    await assert.rejects(d.as(me,'select associate_undo($1)',[req]),/newer update|Entry changed/);
    [old]=await d.admin('select * from interactions where id=$1',[first.id]);
    await assert.rejects(save(other,'edit_interaction',{id:first.id,expected_updated_at:old.updated_at,patch:{remark:'intrusion'}}),/own records/);
    await assert.rejects(save(me,'edit_interaction',{id:first.id,expected_updated_at:old.updated_at,patch:{associate_id:other}}),/cannot change/);
    await assert.rejects(save(me,'edit_interaction',{id:first.id,expected_updated_at:'2020-01-01',patch:{remark:'stale'}}),/changed/);
    assert.ok((await d.admin("select count(*)::int n from audit_log where table_name='interactions' and action='UPDATE'"))[0].n>=2);
    const cp1=await save(me,'cp',{name:'CP One',firm:'Firm',occurred_on:'2026-10-24',rating_after:'active',remark:'Working'});
    const cp2=await save(me,'cp',{name:'CP One',firm:'Firm',occurred_on:'2026-10-25',rating_after:'hot'});
    assert.equal(cp1.cp_id,cp2.cp_id);
    assert.equal((await d.admin('select count(*)::int n from channel_partners'))[0].n,1);
    const booking=await save(me,'booking',{lead_id:first.lead_id,plot_no:'35',value:1000,booking_date:'2026-10-25',status:'token',source:'cp',cp_id:cp1.cp_id});
    const [bk]=await d.admin('select * from bookings where id=$1',[booking.id]);
    await assert.rejects(save(me,'edit_booking',{id:bk.id,expected_updated_at:bk.updated_at,patch:{status:'cancelled'}}),/cancelled/);
    const bookingReq=randomUUID();await save(me,'edit_booking',{id:bk.id,expected_updated_at:bk.updated_at,patch:{status:'booking_done'}},bookingReq);
    assert.equal((await d.admin('select status from leads where id=$1',[first.lead_id]))[0].status,'booked');
    await d.as(me,'select associate_undo($1)',[bookingReq]);
    assert.equal((await d.admin('select status from bookings where id=$1',[bk.id]))[0].status,'token');
    const undoReq=randomUUID();const disposable=await save(me,'customer',{...payload,name:'Undo me',phone:'',rating_after:'warm',next_action_date:''},undoReq);
    await d.as(me,'select associate_undo($1)',[undoReq]);
    await d.as(me,'select associate_undo($1)',[undoReq]);
    assert.ok((await d.admin('select deleted_at from leads where id=$1',[disposable.lead_id]))[0].deleted_at);
    assert.equal((await d.as(other,'select id from entry_receipts')).length,0);
    assert.equal((await d.admin("select count(*)::int n from pg_trigger where not tgisinternal and tgenabled='D'"))[0].n,0);
    await d.admin('insert into targets(branch_id,associate_id,month,customer_meetings,hot_leads,cp_meetings,bookings) values($1,$2,$3,31,31,31,31)',[b.id,me,'2026-10-01']);
    const [score]=await d.as(me,"select associate_scorecard('2026-10-21','2026-10-31') value");
    assert.equal(score.value.meetings,1);
    assert.equal(score.value.cp_meetings,2,'CP meetings are rows, not distinct partners');
    assert.equal(score.value.targets.meetings,11);
  } finally {await d.db.close();}
});


test('analysis dictionary: filter consistency, exact drills, cohorts, explorer, movement, CPs, plots and role scopes',async()=>{
 const d=await createDb();
 try {
  const b=randomUUID(),foreign=randomUUID(),sa=randomUUID(),ba=randomUUID(),tl=randomUUID(),a1=randomUUID(),a2=randomUUID(),a3=randomUUID(),project=randomUUID();
  await d.admin("insert into branches(id,name) values($1,'Analysis A'),($2,'Analysis B')",[b,foreign]);
  for(const [id,branch,role,name] of [[sa,b,'super_admin','SA'],[ba,b,'branch_admin','BA'],[tl,b,'team_lead','TL'],[a1,b,'associate','A One'],[a2,b,'associate','A Two'],[a3,foreign,'associate','Foreign']]){await d.admin('insert into auth.users(id) values($1)',[id]);await d.admin('insert into profiles(id,branch_id,role,full_name,must_change_password) values($1,$2,$3,$4,false)',[id,branch,role,name]);}
  await d.admin('update profiles set reports_to=$1 where id=$2',[tl,a1]);await d.admin('update profiles set reports_to=$1 where id=$2',[ba,a2]);
  await d.admin("insert into projects(id,name) values($1,'Analysis Project')",[project]);
  const [firm]=await d.admin("insert into cp_firms(branch_id,name,legacy_key) values($1,'Analysis Firm','analysis_firm') returning id",[b]);
  const [cp]=await d.admin("insert into channel_partners(branch_id,name,firm,firm_id,normalized_key) values($1,'Analysis CP','Analysis Firm',$2,'') returning id",[b,firm.id]);
  const leads=[];for(const [owner,branch,name] of [[a1,b,'Hot booked'],[a1,b,'Hot stale'],[a2,b,'Budget cancelled'],[a3,foreign,'Foreign lead']]){const [l]=await d.admin("insert into leads(branch_id,name,owner_id,project_id,source,cp_id,created_on) values($1,$2,$3,$4,$5,$6,'2026-10-01') returning id",[branch,name,owner,project,owner===a1?'cp':'direct',owner===a1?cp.id:null]);leads.push(l.id);}
  for(const [lead,owner,day,rating] of [[leads[0],a1,'2026-10-01','cold'],[leads[0],a1,'2026-10-10','warm'],[leads[0],a1,'2026-10-20','hot'],[leads[1],a1,'2026-10-01','hot'],[leads[2],a2,'2026-10-15','cold'],[leads[3],a3,'2026-10-05','hot']])await d.admin("insert into interactions(lead_id,associate_id,occurred_on,rating_after,remark,plot_names,next_action,next_action_date) values($1,$2,$3,$4,'NRI family budget loan',array['35'],'Call','2026-10-25')",[lead,owner,day,rating]);
  await d.admin("insert into cp_interactions(cp_id,associate_id,occurred_on,rating_after) values($1,$2,'2026-10-03','warm'),($1,$2,'2026-10-24','active')",[cp.id,a1]);
  for(const [lead,owner,day,status,value,source,partner,reason] of [[leads[0],a1,'2026-10-22','booking_done',100,'cp',cp.id,null],[leads[1],a1,'2026-10-26','token',20,'cp',cp.id,null],[leads[2],a2,'2026-10-15','cancelled',50,'direct',null,'Budget'],[leads[3],a3,'2026-10-07','booking_done',999,'direct',null,null]])await d.admin("insert into bookings(lead_id,associate_id,project_id,plot_no,booking_date,status,value,source,cp_id,cancel_reason) values($1,$2,$3,'35',$4,$5,$6,$7,$8,$9)",[lead,owner,project,day,status,value,source,partner,reason]);
  const f={window:'custom',from:'2026-10-01',to:'2026-10-31',compare:'true'};
  const rpc=async(user,name,args)=>(await d.as(user,'select '+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') result',args.map(x=>typeof x==='object'&&!Array.isArray(x)?JSON.stringify(x):x)))[0].result;
  const started=performance.now();const dashboard=await rpc(ba,'analysis_dashboard',[f]);assert.ok(performance.now()-started<2000,'Command SQL must finish in under 2 seconds on fixture');
  assert.equal(dashboard.metrics.customer_meetings.value,5);assert.equal(dashboard.metrics.bookings.value,1);assert.equal(dashboard.metrics.booking_value.value,100);assert.equal(dashboard.metrics.cp_meetings.value,2);assert.equal(dashboard.metrics.active_cps.value,1);
  assert.equal(dashboard.metrics.hot_leads.value,2);assert.equal(dashboard.metrics.hot_conversion.value,50);assert.equal(dashboard.metrics.cancellation_pct.value,33.33);
  const team=await rpc(tl,'analysis_dashboard',[f]);assert.equal(team.metrics.customer_meetings.value,4);assert.equal(team.metrics.cancellations.value,0);assert.equal(team.league.some(p=>p.name==='A Two'),false);
  const all=await rpc(sa,'analysis_dashboard',[f]);assert.equal(all.metrics.booking_value.value,1099);
  const branch=await rpc(sa,'analysis_dashboard',[{...f,branch:b}]);assert.equal(branch.metrics.booking_value.value,100);
  await assert.rejects(rpc(a1,'analysis_dashboard',[f]),/Reviewer access/);
  const drill=await rpc(ba,'analysis_drill',['hot_leads',f,0,50,'numerator']);assert.equal(drill.total,2);assert.equal(new Set(drill.rows.map(r=>r.lead_id)).size,2);
  const conversionTop=await rpc(ba,'analysis_drill',['hot_conversion',f,0,50,'numerator']);const conversionBase=await rpc(ba,'analysis_drill',['hot_conversion',f,0,50,'denominator']);assert.equal(conversionTop.total,1);assert.equal(conversionBase.total,2);
  const funnelLost=await rpc(ba,'analysis_drill',['funnel:hot_leads:hot_booked',f,0,50,'dropoff']);assert.equal(funnelLost.total,1);assert.notEqual(funnelLost.rows[0].lead_id,conversionTop.rows[0].lead_id);
  for(const measure of ['count','unique_leads','booking_units','value','hot_pct','cancellation_pct']){const members=await rpc(ba,'analysis_drill',['explorer:meetings:'+measure,f,0,50,'numerator']);assert.ok(members.total>=0);assert.ok(members.rows.every(r=>r.branch_id===b));}
  const bookingDrill=await rpc(ba,'analysis_drill',['bookings',f,0,50,'numerator']);assert.equal(bookingDrill.rows.length,1);assert.equal(bookingDrill.rows[0].value,100);
  const explore=await rpc(ba,'analysis_explore',['meetings',f,['associate'],['count','unique_leads','hot_pct'],0,50,'count']);assert.equal(explore.groups.find(g=>g.group1==='A One').metrics.count,4);
  const searched=await rpc(ba,'analysis_explore',['all',{...f,q:'budget'},[],['count'],0,50,'count']);assert.ok(searched.rows.some(r=>r.snippet.includes('⟪')));
  const movement=await rpc(ba,'analysis_movement',[f]);assert.ok(movement.matrix.some(r=>r.from_stage==='cold'&&r.to_stage==='warm'&&r.count===1));
  const cps=await rpc(ba,'analysis_cps',[f]);assert.equal(cps.firms[0].meetings,2);assert.equal(cps.firms[0].bookings,1);
  const plots=await rpc(ba,'analysis_plots',[f]);assert.ok(plots.plots.length>0);assert.ok(plots.plots[0].history.length>0);const comparedPlots=await rpc(ba,'analysis_plots',[{...f,compare:'true'}]);assert.ok(comparedPlots.plots.every(p=>p.previous&&p.delta));
  await d.admin("insert into bookings(branch_id,associate_id,lead_id,project_id,plot_no,status,booking_date,created_by) select branch_id,associate_id,lead_id,project_id,'UNDATED-CONTENTION','token',null,created_by from bookings where branch_id=$1 limit 1",[b]);const undatedPlots=await rpc(ba,'analysis_plots',[f]);assert.ok(undatedPlots.plots.some(p=>p.plot==='UNDATED-CONTENTION'),'Undated bookings remain visible in the inventory register');
  const filtered=await rpc(ba,'analysis_dashboard',[{...f,associates:[a2]}]);assert.equal(filtered.metrics.customer_meetings.value,1);assert.equal(filtered.metrics.cancellations.value,1);
  const [saved]=await d.as(ba,"insert into saved_analysis_views(branch_id,name,state,shared) values($1,'Budget', $2,true) returning id",[b,JSON.stringify(f)]);assert.equal((await d.as(tl,'select id from saved_analysis_views where id=$1',[saved.id])).length,1);assert.equal((await d.as(a1,'select id from saved_analysis_views')).length,0);
 } finally {await d.db.close();}
});
