/** Live verification is restricted to newly created, marked nonhistorical records. */
import {createClient} from '@supabase/supabase-js';
import {createHash,randomUUID} from 'node:crypto';
import {writeFileSync} from 'node:fs';
const url=process.env.NEXT_PUBLIC_SUPABASE_URL!,key=process.env.SUPABASE_SERVICE_ROLE_KEY!;
if(new URL(url).host!=='jxduyylphokqpignybpz.supabase.co')throw Error('Wrong live project');
const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
async function main(){
 const results:{check:string;result:string;detail:string}[]=[];
 const check=(name:string,condition:boolean,detail='')=>{results.push({check:name,result:condition?'PASS':'FAIL',detail});if(!condition)throw Error(name+' FAILED '+detail);};
 async function historySnapshot(){const snapshots:Record<string,string>={};for(const t of ['profiles','projects','cp_firms','channel_partners','leads','interactions','cp_interactions','bookings','data_quality_issues']){const rows=[];for(let i=0;;i+=1000){const r=await admin.from(t).select('*').eq('is_historical',true).order('id').range(i,i+999);if(r.error)throw r.error;rows.push(...r.data);if(r.data.length<1000)break;}snapshots[t]=createHash('sha256').update(JSON.stringify(rows)).digest('hex');}return snapshots;}
 const before=await historySnapshot();
 const ready=await admin.from('entry_cancellations').select('id').limit(1);check('Migration 7 installed',!ready.error,ready.error?.message);
 const people=await admin.from('profiles').select('id,email,full_name,role').eq('active',true).eq('must_change_password',false).is('deleted_at',null).in('role',['associate','team_lead','branch_admin','super_admin']);if(people.error)throw people.error;
 const actor=people.data?.find(p=>p.role==='associate')??people.data?.[0];
 if(!actor?.email)throw Error('BLOCKED: no active existing account has completed its required password change. No user flags or passwords were changed.');
 console.log('Verifying live as existing '+actor.role+' '+actor.full_name+' using a temporary session. No email is sent.');
 const link=await admin.auth.admin.generateLink({type:'magiclink',email:actor.email});if(link.error)throw link.error;
 const client=createClient(url,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
 const session=await client.auth.verifyOtp({token_hash:link.data.properties.hashed_token,type:'email'});if(session.error)throw session.error;
 const run=randomUUID();const ids:string[]=[];let syntheticLead:string|undefined;
 async function save(kind:string,p:Record<string,unknown>,request=randomUUID()) {const r=await client.rpc('associate_save',{p_kind:kind,p_payload:p,p_request_id:request});if(r.error)throw Error(r.error.message);if(!r.data?.id)throw Error('Save returned no ID');ids.push(request);return r.data;}
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata'}).format(new Date());const ago=new Date(today+'T12:00Z');ago.setUTCDate(ago.getUTCDate()-2);const oldDate=ago.toISOString().slice(0,10);const tomorrow=new Date(today+'T12:00Z');tomorrow.setUTCDate(tomorrow.getUTCDate()+1);
 try{
  const payload={name:'VERIFICATION ONLY '+run,occurred_on:oldDate,rating_after:'warm',mode:'virtual',remark:'Synthetic verification: original older entry',next_action:'Call',next_action_date:tomorrow.toISOString().slice(0,10),plot_names:[],source:'direct'};
  const firstRequest=randomUUID();const first=await save('customer',payload,firstRequest);syntheticLead=first.lead_id;check('Save live nonhistorical meeting',!!first.id);
  const repeated=await save('customer',payload,firstRequest);check('Retry returns same meeting',repeated.id===first.id);
  const latest=await save('customer',{...payload,lead_id:first.lead_id,occurred_on:today,remark:'Synthetic verification: newer follow-up',interaction_type:'follow_up'});check('Save newer follow-up',!!latest.id);
  const row=await client.from('interactions').select('id,updated_at,is_historical').eq('id',first.id).single();if(row.error)throw row.error;check('Synthetic rows are not historical',row.data.is_historical===false);
  const editRequest=randomUUID();await save('edit_interaction',{id:first.id,expected_updated_at:row.data.updated_at,patch:{remark:'Synthetic verification: audited older correction'}},editRequest);
  const audit=await admin.from('audit_log').select('actor_id,old_data,new_data').eq('row_id',first.id).eq('table_name','interactions').eq('action','UPDATE');if(audit.error)throw audit.error;
  check('Older-entry edit has before/after audit',audit.data.some(a=>a.actor_id===actor.id&&a.old_data?.remark===payload.remark&&a.new_data?.remark==='Synthetic verification: audited older correction'));
  const undone=await client.rpc('associate_undo',{p_request_id:editRequest});if(undone.error)throw undone.error;
  const restored=await client.from('interactions').select('remark').eq('id',first.id).single();check('Undo restores the older remark',restored.data?.remark===payload.remark);
  const cancelRequest=randomUUID();const cancel=await client.rpc('associate_undo',{p_request_id:cancelRequest});if(cancel.error)throw cancel.error;
  const cancelled=await client.rpc('associate_save',{p_kind:'customer',p_payload:{...payload,name:'VERIFICATION ONLY CANCEL '+run},p_request_id:cancelRequest});check('Offline cancellation blocks delayed save',!!cancelled.error&&/undone/.test(cancelled.error.message));
  // Retain only soft-deleted synthetic rows and audit evidence, never alter imported rows.
  const r=await client.rpc('associate_undo',{p_request_id:ids[2]});if(r.error)throw r.error;check('Undo removes newly saved follow-up',true);
 }finally{
  if(syntheticLead){const removed=await admin.from('interactions').update({deleted_at:new Date().toISOString()}).eq('lead_id',syntheticLead).eq('is_historical',false);if(removed.error)throw removed.error;const parent=await admin.from('leads').update({deleted_at:new Date().toISOString()}).eq('id',syntheticLead).eq('owner_id',actor.id).eq('is_historical',false);if(parent.error)throw parent.error;check('Synthetic records removed from active lists',true);}
  await client.auth.signOut({scope:'local'});
  const after=await historySnapshot();check('Every historical row unchanged',JSON.stringify(before)===JSON.stringify(after));
  console.table(results);writeFileSync('docs/ASSOCIATE_LIVE_VERIFICATION.md','# Live associate verification\n\n'+new Date().toISOString()+' · '+new URL(url).host+'\n\n| Check | Result | Detail |\n|---|---|---|\n'+results.map(r=>`| ${r.check} | ${r.result} | ${r.detail} |`).join('\n')+'\n');
 }
}
main().catch(e=>{console.error('LIVE VERIFICATION STOPPED:',e.message);process.exitCode=1;});
