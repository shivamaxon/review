import {notFound} from 'next/navigation';
import {EntryForm} from '@/components/associate/entry-form';
export default async function LogPage({params,searchParams}:{params:Promise<{kind:string}>;searchParams:Promise<{lead?:string;cp?:string}>}){const {kind}=await params;const p=await searchParams;if(kind!=='customer'&&kind!=='cp'&&kind!=='booking')notFound();return <EntryForm kind={kind} leadId={p.lead} cpId={p.cp}/>;}
