import {analysisData} from '@/lib/analysis/server';
import {CommandView} from '@/components/analysis/command';
import {DrillDrawer,SetupPending} from '@/components/analysis/common';
import type {Params} from '@/lib/analysis/shared';
export default async function CommandPage({searchParams}:{searchParams:Promise<Params>}){const r=await analysisData('dashboard',await searchParams);return r.data?<><CommandView data={r.data} params={r.params}/><DrillDrawer data={r.drill} params={r.params}/></>:<SetupPending/>;}
