import {MySheet} from '@/components/associate/my-sheet';
export default async function SheetPage({searchParams}:{searchParams:Promise<{tab?:string;row?:string}>}){const p=await searchParams;return <MySheet initialTab={p.tab} initialRow={p.row}/>;}
