import {CPDetail} from '@/components/associate/details';
export default async function CPPage({params}:{params:Promise<{id:string}>}){return <CPDetail id={(await params).id}/>;}
