import { notFound } from 'next/navigation';
import Link from 'next/link';
import { requireProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { recordTable, displayValue } from '@/lib/quality';
export default async function RecordPage({ params }: {
    params: Promise<{
        table: string;
        id: string;
    }>;
}) {
    await requireProfile();
    const { table, id } = await params;
    if (!recordTable(table) || !/^[0-9a-f-]{36}$/i.test(id))
        notFound();
    const db = await createClient();
    const { data, error } = await db.from(table).select('*').eq('id', id).maybeSingle();
    if (error)
        throw error;
    if (!data)
        notFound();
    return <div className="space-y-5"><Link href="/explorer" className="underline">Explorer</Link><h1 className="text-2xl font-semibold">{table.replaceAll('_', ' ')} · {data.legacy_key ?? data.name ?? data.id}</h1><p>{data.is_historical ? 'Historical record' : 'Current record'}{data.deleted_at ? ' · Removed from active totals' : ''}</p><dl className="divide-y rounded border px-4">{Object.entries(data).filter(([k]) => !['raw_json', 'remark_tsv', 'remarks_tsv'].includes(k)).map(([k, v]) => <div key={k} className="grid gap-1 py-3 sm:grid-cols-3"><dt className="font-medium">{k.replaceAll('_', ' ')}</dt><dd className="break-words sm:col-span-2">{displayValue(v) || '—'}</dd></div>)}</dl><details><summary>Original imported row</summary><pre className="overflow-auto whitespace-pre-wrap text-sm">{JSON.stringify(data.raw_json, null, 2)}</pre></details></div>;
}
