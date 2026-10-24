import {analysisData,analysisOptions} from '@/lib/analysis/server';
import {ExplorerView} from '@/components/analysis/explorer';
import {SetupPending,DrillDrawer} from '@/components/analysis/common';
import type {Params} from '@/lib/analysis/shared';
export default async function ExplorerPage({searchParams}:{searchParams:Promise<Params>}){const r=await analysisData('explore',await searchParams);const {options}=await analysisOptions(true);return r.data?<><ExplorerView data={r.data} params={r.params} options={options??{}}/><DrillDrawer data={r.drill} params={r.params}/></>:<SetupPending/>;}
