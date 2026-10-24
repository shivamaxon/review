import {LeadDetail} from '@/components/associate/details';
export default async function LeadPage({params}:{params:Promise<{id:string}>}){return <LeadDetail id={(await params).id}/>;}
