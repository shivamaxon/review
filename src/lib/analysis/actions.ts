'use server';
import {requireRole} from '@/lib/auth';
import {createClient} from '@/lib/supabase/server';
import {revalidatePath} from 'next/cache';
export async function saveAnalysisView(_state:{error?:string;url?:string},form:FormData):Promise<{error?:string;url?:string}>{const profile=await requireRole(['team_lead','branch_admin','super_admin']);const name=String(form.get('name')??'').trim();if(!name||name.length>100)return {error:'Give this view a name of 1–100 characters.'};let state;try{state=JSON.parse(String(form.get('state')));}catch{return {error:'Could not save these filters. Reload and try again.'};}const db=await createClient();const r=await db.from('saved_analysis_views').insert({name,state,shared:form.get('shared')==='on',owner_id:profile.id,branch_id:profile.branch_id}).select('id').single();if(r.error)return {error:r.error.message};revalidatePath('/explorer');return {url:'/explorer?view='+r.data.id};}
