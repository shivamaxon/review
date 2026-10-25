/** Local-only Supabase protocol fixture backed by the real migrations and RLS.
 * Production code has no test authentication path. No request goes to live Supabase.
 */
import { createServer } from 'node:http';
import { createDb } from '../../supabase/tests/harness.mjs';
import {loadHistory,type ImportDb} from '../../scripts/load-history';
import {readWorkbook,sheet} from '../../scripts/history-workbook';
import {randomUUID} from 'node:crypto';
import { createHmac } from 'node:crypto';
const PORT = 54329;
const ME = '91000000-0000-0000-0000-000000000001', OTHER = '91000000-0000-0000-0000-000000000002';
const BRANCH = '92000000-0000-0000-0000-000000000001', PROJECT = '93000000-0000-0000-0000-000000000001';
const ADMIN='91000000-0000-0000-0000-000000000010',TEAM='91000000-0000-0000-0000-000000000011',SUPER='91000000-0000-0000-0000-000000000012',FOREIGN='91000000-0000-0000-0000-000000000013',FOREIGN_BRANCH='92000000-0000-0000-0000-000000000002';
const OWN_LEAD = '94000000-0000-0000-0000-000000000001', OTHER_LEAD = '94000000-0000-0000-0000-000000000002';
let db = await createDb();
let serial = Promise.resolve();
function user(id = ME) { return { id, aud: 'authenticated', role: 'authenticated', email: id === ME ? 'phone@test.local' : 'other@test.local', email_confirmed_at: new Date().toISOString(), created_at: new Date().toISOString(), app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {} }; }
function token(id = ME) { const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url'); const payload = enc({ sub: id, role: 'authenticated', aud: 'authenticated', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 7200 }); const prefix = enc({ alg: 'HS256', typ: 'JWT' }) + '.' + payload; return prefix + '.' + createHmac('sha256', 'local-test-secret').update(prefix).digest('base64url'); }
async function reset() {
    await db.db.close();
    db = await createDb();
    await db.admin('insert into branches(id,name) values($1,$2)', [BRANCH, 'Phone test branch']);
    for (const id of [ME, OTHER]) {
        await db.admin('insert into auth.users(id,email) values($1,$2)', [id, user(id).email]);
        await db.admin("insert into profiles(id,branch_id,full_name,email,legacy_key,must_change_password) values($1,$2,$3,$4,$5,false)", [id, BRANCH, id === ME ? 'Test Associate' : 'Other Associate', user(id).email, id === ME ? 'test_associate' : 'other_associate']);
    }
    await db.admin("insert into branches(id,name) values($1,'Foreign test branch')",[FOREIGN_BRANCH]);
    for(const [id,role,name,branch] of [[ADMIN,'branch_admin','Test Branch Admin',BRANCH],[TEAM,'team_lead','Test Team Lead',BRANCH],[SUPER,'super_admin','Test Super Admin',BRANCH],[FOREIGN,'associate','Foreign Associate',FOREIGN_BRANCH]]){await db.admin('insert into auth.users(id,email) values($1,$2)',[id,id+'@test.local']);await db.admin('insert into profiles(id,branch_id,full_name,role,must_change_password) values($1,$2,$3,$4,false)',[id,branch,name,role]);}
    await db.admin('update profiles set reports_to=$1 where id=$2',[TEAM,ME]);await db.admin('update profiles set reports_to=$1 where id=$2',[ADMIN,OTHER]);
    await db.admin("insert into projects(id,name) values($1,'Kudal')", [PROJECT]);
    for (const [id, owner, name] of [[OWN_LEAD, ME, 'Existing Customer'], [OTHER_LEAD, OTHER, 'Private Other Customer']])
        await db.admin("insert into leads(id,branch_id,name,owner_id,phone,project_id,current_rating,plot_names) values($1,$2,$3,$4,'9876543210',$5,'warm',array['35'])", [id, BRANCH, name, owner, PROJECT]);
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    await db.admin("insert into interactions(lead_id,associate_id,occurred_on,rating_after,remark,next_action,next_action_date,plot_names) values($1,$2,$3,'warm','Earlier conversation','Call',$3,array['35'])", [OWN_LEAD, ME, day]);
    await db.admin("insert into interactions(lead_id,associate_id,occurred_on,rating_after,remark) values($1,$2,$3,'hot','Private note')", [OTHER_LEAD, OTHER, day]);
    await db.admin("insert into next_action_types(label,sort_order) values('Call',1),('Site visit',2),('Send price sheet',3) on conflict do nothing");
    await db.admin("insert into cold_reasons(label) values('Budget'),('Timing'),('Not interested') on conflict do nothing");
    await db.admin("insert into channel_partners(branch_id,name,firm,phone,normalized_key,created_by) values($1,'Test CP','Test Firm','9876501234','', $2)", [BRANCH, ME]);
    const [testCP]=await db.admin("select id from channel_partners where name='Test CP'");
    const [firm]=await db.admin("insert into cp_firms(branch_id,name,legacy_key) values($1,'Test Firm','test_firm') returning id",[BRANCH]);await db.admin('update channel_partners set firm_id=$1 where id=$2',[firm.id,testCP.id]);
    const [zeroFirm]=await db.admin("insert into cp_firms(branch_id,name,legacy_key) values($1,'Unconverted Firm','zero_firm') returning id",[BRANCH]);const [zeroCP]=await db.admin("insert into channel_partners(branch_id,name,firm,firm_id,normalized_key) values($1,'Zero Conversion CP','Unconverted Firm',$2,'') returning id",[BRANCH,zeroFirm.id]);
    const old=new Date(day+'T12:00Z');old.setUTCDate(old.getUTCDate()-8);const oldDate=old.toISOString().slice(0,10);
    for(const [name,partner,rating,plot,owner,branch,when] of [['Zero conversion lead',zeroCP.id,'warm','38',ME,BRANCH,day],['Stale Hot Owner',null,'hot','36',ME,BRANCH,oldDate],['Confirmed CP customer',testCP.id,'hot','37',ME,BRANCH,day],['Foreign branch private',null,'hot','39',FOREIGN,FOREIGN_BRANCH,day]]){
     const [lead]=await db.admin("insert into leads(branch_id,name,owner_id,project_id,cp_id,source,created_on) values($1,$2,$3,$4,$5,$6,$7) returning id",[branch,name,owner,PROJECT,partner,partner?'cp':'direct',when]);await db.admin("insert into interactions(lead_id,associate_id,occurred_on,rating_after,plot_names,remark,next_action,next_action_date) values($1,$2,$3,$4,array[$5],$6,'Call',$3)",[lead.id,owner,when,rating,plot,'Budget family loan conversation']);
     if(name==='Confirmed CP customer'||name==='Foreign branch private')await db.admin("insert into bookings(lead_id,associate_id,project_id,plot_no,booking_date,status,value,source,cp_id) values($1,$2,$3,$4,$5,'booking_done',$6,$7,$8)",[lead.id,owner,PROJECT,plot,day,name==='Confirmed CP customer'?100000:999,partner?'cp':'direct',partner]);
    }
    await db.admin("insert into cp_interactions(cp_id,associate_id,occurred_on,rating_after) values($1,$2,$3,'active'),($4,$2,$3,'warm')",[testCP.id,ME,day,zeroCP.id]);
    await db.admin("insert into bookings(lead_id,associate_id,project_id,plot_no,booking_date,status,value,source,cancel_reason,remarks) values($1,$2,$3,'35',$4,'cancelled',50000,'direct','Budget','Family declined the loan')",[OTHER_LEAD,OTHER,PROJECT,day]);
    await db.admin("insert into review_cycle(branch_id,label,start_day,end_day) values($1,'This month',1,null)", [BRANCH]);
    await db.admin("insert into targets(branch_id,associate_id,month,customer_meetings,hot_leads,cp_meetings,bookings) values($1,$2,date_trunc('month',current_date),10,5,8,2)", [BRANCH, ME]);
}
await reset();
const tables = new Set(['profiles', 'branches', 'leads', 'projects', 'interactions', 'channel_partners', 'cp_interactions', 'bookings', 'next_action_types', 'cold_reasons', 'review_actions', 'data_quality_issues', 'login_attempts','saved_analysis_views','review_sessions','review_rules','targets','review_cycle','audit_log','cp_firms']);
const identifier = (s: string) => { if (!/^[a-z_][a-z0-9_]*$/.test(s))
    throw new Error('Invalid identifier'); return '"' + s + '"'; };
const server = createServer((req, res) => {
    const handle = async () => {
        res.setHeader('Access-Control-Allow-Origin', req.headers.origin ?? '*');
        res.setHeader('Access-Control-Allow-Headers', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,HEAD,OPTIONS');
        res.setHeader('Access-Control-Expose-Headers', 'Content-Range');
        if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }
        const url = new URL(req.url!, 'http://127.0.0.1:' + PORT);
        const chunks: Buffer[] = [];
        for await (const chunk of req)
            chunks.push(Buffer.from(chunk));
        const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
        const bearer = String(req.headers.authorization ?? '').replace(/^Bearer /, '');
        let owner = ME;
        try {
            owner = JSON.parse(Buffer.from(bearer.split('.')[1], 'base64url').toString()).sub;
        }
        catch { /* Service fixture operations have a separate key. */ }
        const query = (sql: string, params: unknown[] = []) => bearer === 'local-service-only' ? db.admin(sql, params) : db.as(owner, sql, params);
        function json(data: unknown, status = 200) { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); }
        try {
            if (url.pathname === '/__test/reset') {
                await reset();
                json({ ok: true });
                return;
            }
            if(url.pathname==='/__test/full-workbook'){
             await db.db.close();db=await createDb();await db.admin("insert into branches(id,name) values($1,'Full workbook branch')",[BRANCH]);
             for(const r of sheet(await readWorkbook(),'users')){const id=r.role==='super_admin'?SUPER:randomUUID();await db.admin('insert into auth.users(id,email) values($1,$2)',[id,r.email]);await db.admin('insert into profiles(id,branch_id,full_name,email,role,legacy_key,must_change_password) values($1,$2,$3,$4,$5,$6,false)',[id,BRANCH,r.full_name,r.email,r.role,r.user_key]);}
             const adapter={rpc:async(name:string,p:Record<string,unknown>)=>{try{return {data:(await db.admin('select load_history_table($1,$2) n',[p.p_table,JSON.stringify(p.p_rows)]))[0].n,error:null};}catch(e){return {error:{message:(e as Error).message}};}},from:(table:string)=>({select:()=>({is:async()=>({data:await db.admin(`select * from ${table} where deleted_at is null`),error:null}),not:()=>({range:async()=>({data:await db.admin(`select id,legacy_key from ${table} where legacy_key is not null`),error:null})})})})} as unknown as ImportDb;
             await loadHistory(adapter);json({ok:true});return;
            }
            if (url.pathname === '/__test/session') {
                const role=url.searchParams.get('role');const actor=role==='branch_admin'?ADMIN:role==='team_lead'?TEAM:role==='super_admin'?SUPER:ME;
                json({ access_token: token(actor), refresh_token: 'test-refresh', expires_in: 7200, expires_at: Math.floor(Date.now() / 1000) + 7200, token_type: 'bearer', user: user(actor), owner: actor, otherLead: OTHER_LEAD, ownLead: OWN_LEAD });
                return;
            }
            if (url.pathname === '/__test/state') {
                json({ loginAttempts:await db.admin('select id from login_attempts'),interactions: await db.admin('select * from interactions where deleted_at is null'), leads: await db.admin('select * from leads where deleted_at is null'), receipts: await db.admin('select * from entry_receipts'), audit: await db.admin("select table_name,action from audit_log where action='UPDATE'") });
                return;
            }
            if (url.pathname === '/auth/v1/user') {
                json(user(owner));
                return;
            }
            if (url.pathname === '/auth/v1/logout') {
                json({});
                return;
            }
            if (url.pathname === '/auth/v1/.well-known/jwks.json') {
                json({ keys: [] });
                return;
            }
            if (url.pathname.startsWith('/rest/v1/rpc/')) {
                const name = url.pathname.split('/').pop()!;
                const definitions: Record<string, {
                    args: string[];
                    scalar?: boolean;
                }> = { current_review_period: { args: ['p_on'] }, associate_scorecard: { args: ['p_from', 'p_to'], scalar: true }, associate_save: { args: ['p_kind', 'p_payload', 'p_request_id'], scalar: true }, associate_undo: { args: ['p_request_id'], scalar: true }, plot_conflicts: { args: ['p_project', 'p_plot', 'p_lead'] },analysis_options:{args:['p_dimensions'],scalar:true},analysis_context:{args:['p_filters'],scalar:true},record_read:{args:['p_table','p_ids','p_owner','p_offset','p_limit','p_include_deleted'],scalar:true},review_begin:{args:['p_associate','p_from','p_to'],scalar:true},review_pack:{args:['p_associate','p_filters'],scalar:true},review_edit:{args:['p_session','p_summary','p_action','p_owner','p_due','p_carry','p_remove'],scalar:true},review_finalize:{args:['p_session','p_lock'],scalar:true},commitment_complete:{args:['p_id','p_comment'],scalar:true},review_master:{args:['p_filters','p_session'],scalar:true},admin_settings:{args:['p_kind','p_data'],scalar:true},admin_record:{args:['p_table','p_id','p_patch','p_deleted'],scalar:true},branch_rollup:{args:['p_filters'],scalar:true},admin_reassign:{args:['p_from','p_to'],scalar:true},analysis_dashboard:{args:['p_filters'],scalar:true},analysis_movement:{args:['p_filters'],scalar:true},analysis_cps:{args:['p_filters'],scalar:true},analysis_plots:{args:['p_filters'],scalar:true},analysis_drill:{args:['p_metric','p_filters','p_offset','p_limit','p_basis'],scalar:true},analysis_explore:{args:['p_dataset','p_filters','p_groups','p_measures','p_offset','p_limit','p_sort'],scalar:true} };
                const spec = definitions[name];
                if (!spec) {
                    json({ code: 'PGRST202', message: 'Unknown fixture function' }, 404);
                    return;
                }
                const args = spec.args.filter(a => a in body);
                const params = args.map(a => typeof body[a] === 'object' && body[a] !== null && !Array.isArray(body[a]) ? JSON.stringify(body[a]) : body[a]);
                const call = `public.${identifier(name)}(${args.map((a, i) => `${identifier(a)}=>$${i + 1}`).join(',')})`;
                const result = await query(spec.scalar ? `select ${call} result` : `select * from ${call}`, params);
                if (name === 'current_review_period')
                    for (const r of result) {
                        r.period_start = (r.period_start instanceof Date ? r.period_start.toISOString() : String(r.period_start)).slice(0, 10);
                        r.period_end = (r.period_end instanceof Date ? r.period_end.toISOString() : String(r.period_end)).slice(0, 10);
                    }
                json(spec.scalar ? result[0]?.result : req.headers.accept?.includes('vnd.pgrst.object') ? (result[0] ?? null) : result);
                return;
            }
            const table = url.pathname.split('/').pop()!;
            if (!tables.has(table)) {
                json({ message: 'Not found' }, 404);
                return;
            }
            const conditions: string[] = [];
            const params: unknown[] = [];
            for (const [field, filter] of url.searchParams) {
                if (['select', 'order', 'limit', 'offset'].includes(field))
                    continue;
                const col = identifier(field);
                const [op, ...rest] = filter.split('.');
                const value = rest.join('.');
                if (op === 'is' && value === 'null')
                    conditions.push(col + ' is null');
                else if (op === 'not' && value === 'is.null')
                    conditions.push(col + ' is not null');
                else if (op === 'in') {
                    const values = value.replace(/^\(|\)$/g, '').split(',');
                    conditions.push(`${col} in (${values.map(v => { params.push(v); return '$' + params.length; }).join(',')})`);
                }
                else {
                    const operator = ({ eq: '=', gte: '>=', lte: '<=', gt: '>', lt: '<' } as Record<string, string>)[op];
                    if (!operator)
                        throw new Error('Unsupported fixture filter ' + filter);
                    params.push(value);
                    conditions.push(`${col}${operator}$${params.length}`);
                }
            }
            const where = conditions.length ? ' where ' + conditions.join(' and ') : '';
            if (req.method === 'POST' || req.method === 'PATCH') {
                const values = Array.isArray(body) ? body : [body];
                const result = [];
                for (const value of values) {
                    const keys = Object.keys(value);
                    const cols = keys.map(identifier).join(',');
                    if (req.method === 'POST')
                        result.push(...await query(`insert into public.${identifier(table)}(${cols}) select ${cols} from jsonb_populate_record(null::public.${identifier(table)},$1) returning *`, [JSON.stringify(value)]));
                    else {
                        const set = keys.map(k => `${identifier(k)}=x.${identifier(k)}`).join(',');
                        result.push(...await query(`update public.${identifier(table)} t set ${set} from jsonb_populate_record(null::public.${identifier(table)},$${params.length + 1}) x${where} returning t.*`, [...params, JSON.stringify(value)]));
                    }
                }
                json(req.headers.accept?.includes('vnd.pgrst.object') ? (result[0] ?? null) : result, 201);
                return;
            }
            if (req.method === 'DELETE') {
                await query(`delete from public.${identifier(table)}${where}`, params);
                res.writeHead(204);
                res.end();
                return;
            }
            const order = url.searchParams.get('order');
            const ordering = order ? ' order by ' + order.split(',').map(x => { const [c, dir] = x.split('.'); return identifier(c) + (dir === 'desc' ? ' desc' : ' asc'); }).join(',') : '';
            const offset = Number(url.searchParams.get('offset') ?? 0), limit = Math.min(Number(url.searchParams.get('limit') ?? 1000), 10000);
            const selection=(url.searchParams.get('select')??'*').replace(/branches\([^)]*\)/g,'');const projection=selection.includes('*')?'*':selection.split(',').map(s=>s.trim()).filter(Boolean).map(identifier).join(',')||'id';
            const result = await query(`select ${projection} from public.${identifier(table)}${where}${ordering} limit ${limit} offset ${offset}`, params);
            for (const row of result)
                for (const key of Object.keys(row))
                    if ((key.endsWith('_date') || key.endsWith('_on') || ['period_start','period_end','month'].includes(key)) && row[key] instanceof Date)
                        row[key] = row[key].toISOString().slice(0, 10);
            if (table === 'profiles' && url.searchParams.get('select')?.includes('branches('))
                for (const row of result)
                    row.branches = (await query('select name,is_demo from branches where id=$1', [row.branch_id]))[0];
            res.setHeader('Content-Range', `0-${Math.max(result.length - 1, 0)}/${result.length}`);
            json(req.headers.accept?.includes('vnd.pgrst.object') ? (result[0] ?? null) : result);
        }
        catch (e) {
            const error = e as Error & {
                code?: string;
            };
            json({ message: error.message, code: error.code ?? 'TEST_ERROR' }, 400);
        }
    };
    serial = serial.then(handle).catch(e => { res.writeHead(500); res.end(JSON.stringify({ message: String(e) })); });
});
server.listen(PORT, '127.0.0.1', () => console.log('Local Supabase fixture ready on ' + PORT));
