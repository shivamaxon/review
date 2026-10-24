import {Suspense} from 'react';
import {analysisOptions} from '@/lib/analysis/server';
import {AnalysisControls} from '@/components/analysis/controls';
export default async function AnalysisLayout({children}:{children:React.ReactNode}){const {profile,options}=await analysisOptions();return <div className="mx-auto w-full max-w-7xl">{options&&<Suspense fallback={<p>Loading filters…</p>}><AnalysisControls options={options} superAdmin={profile.role==='super_admin'}/></Suspense>}{children}</div>;}
