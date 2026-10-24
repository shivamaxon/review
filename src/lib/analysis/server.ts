import 'server-only';
import {redirect} from 'next/navigation';
import {queryString} from './shared';
import {cache} from 'react';
import {requireRole} from '@/lib/auth';
import {createClient} from '@/lib/supabase/server';
import {readFilters,type Params,type Json} from './shared';
export const analysisOptions=cache(async(dimensions=false)=>{const profile=await requireRole(['team_lead','branch_admin','super_admin']);const db=await createClient();const r=await db.rpc('analysis_options',{p_dimensions:dimensions});if(r.error&&r.error.code!=='PGRST202')throw new Error(r.error.message);return {profile,options:r.data as Json|null};});
export async function analysisData(kind:string,params:Params){const profile=await requireRole(['team_lead','branch_admin','super_admin']);const db=await createClient();let merged=params;
 if(params.view&&typeof params.view==='string'){const saved=await db.from('saved_analysis_views').select('state').eq('id',params.view).is('deleted_at',null).maybeSingle();if(saved.error)throw new Error(saved.error.message);if(saved.data){merged={...saved.data.state,...params};if(Object.keys(saved.data.state).some(k=>params[k]===undefined))redirect('/explorer?'+queryString(merged));}}
 const filters=readFilters(merged);if(profile.role!=='super_admin')filters.branch=profile.branch_id;
 if(kind==='associate'){filters.associates=[String(params.id)];}
 const name=kind==='associate'?'analysis_dashboard':`analysis_${kind}`;
 const args:Json={p_filters:filters};
 if(kind==='explore'){const groups=[params.group1,params.group2].filter((x):x is string=>typeof x==='string'&&!!x);const measures=params.measure?(Array.isArray(params.measure)?params.measure:[params.measure]):['count','unique_leads','booking_units','value'];Object.assign(args,{p_dataset:params.dataset??'meetings',p_groups:groups,p_measures:measures,p_offset:Math.max(0,Number(params.page)||0)*50,p_limit:50,p_sort:params.sort??measures[0]});}
 const r=await db.rpc(name,args);if(r.error&&r.error.code!=='PGRST202')throw new Error(r.error.message);
 let drill:Json|null=null;if(params.drill){const d=await db.rpc('analysis_drill',{p_metric:params.drill,p_filters:filters,p_offset:Math.max(0,Number(params.drillpage)||0)*50,p_limit:50,p_basis:params.basis??'numerator'});if(d.error&&d.error.code!=='PGRST202')throw new Error(d.error.message);drill=d.data;}
 return {data:r.data as Json|null,drill,params:merged,filters,profile};
}
