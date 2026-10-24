import 'server-only';
import { cache } from 'react';
import { requireProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { todayIndia } from './common';
import type { Bundle } from './types';
export const loadAssociateData = cache(async (): Promise<Bundle> => {
    const profile = await requireProfile();
    const db = await createClient();
    async function all(table: string, columns: string, ownerField?: string): Promise<Record<string, unknown>[]> {
        const rows = [];
        for (let offset = 0;; offset += 1000) {
            let q = db.from(table).select(columns).is('deleted_at', null).order('id').range(offset, offset + 999);
            if (ownerField)
                q = q.eq(ownerField, profile.id);
            if (table === 'channel_partners')
                q = q.eq('branch_id', profile.branch_id);
            const r = await q;
            if (r.error && ['42703', 'PGRST204'].includes(r.error.code) && (columns.includes('site_visit_status') || columns.includes('contact_phone')))
                return all(table, columns.replace(',site_visit_status,nurture_note', '').replace(',contact_phone', ''), ownerField);
            if (r.error)
                throw new Error(`${table}: ${r.error.message}`);
            rows.push(...r.data as unknown as Record<string, unknown>[]);
            if (r.data.length < 1000)
                break;
        }
        return rows;
    }
    // Pick columns explicitly: original workbook rows are not needed on an associate's phone.
    const results = await Promise.all([
        all('leads', 'id,legacy_key,name,phone,project_id,current_rating,plot_names,next_action,next_action_date,last_touch_at,is_historical,status,updated_at,source,cp_id', 'owner_id'),
        all('channel_partners', 'id,legacy_key,name,firm,phone,current_rating,next_action,next_action_date,last_touch_at,is_historical,updated_at'),
        all('interactions', 'id,lead_id,associate_id,occurred_on,mode,interaction_type,rating_before,rating_after,remark,next_action,next_action_date,plot_names,cold_reason,site_visit_status,nurture_note,is_historical,created_at,updated_at', 'associate_id'),
        all('cp_interactions', 'id,cp_id,associate_id,occurred_on,rating_before,rating_after,remark,next_action,next_action_date,contact_phone,is_historical,created_at,updated_at', 'associate_id'),
        all('bookings', 'id,lead_id,associate_id,project_id,plot_no,value,booking_date,status,source,cp_id,cancel_reason,remarks,is_historical,updated_at', 'associate_id'),
        db.from('projects').select('id,name').eq('active', true).is('deleted_at', null).order('name'),
        db.from('next_action_types').select('label').eq('active', true).is('deleted_at', null).order('sort_order'),
        db.from('cold_reasons').select('label').eq('active', true).is('deleted_at', null).order('sort_order'),
        all('review_actions', 'id,action,due_date,status,lead_id,cp_id', 'associate_id'),
        db.rpc('current_review_period', { p_on: todayIndia() }).maybeSingle(),
        db.from('profiles').select('legacy_key').eq('id', profile.id).single(),
        db.from('data_quality_issues').select('id,detail,table_name,record_ids').eq('assigned_to', profile.id).eq('status', 'open').is('deleted_at', null),
    ]);
    for (const r of results)
        if (!Array.isArray(r) && r.error)
            throw new Error(r.error.message);
    const periodResult = results[9] as {
        data: {
            label: string;
            period_start: string;
            period_end: string;
        } | null;
    };
    const current = periodResult.data;
    const day = todayIndia();
    const from = current?.period_start ?? day.slice(0, 8) + '01';
    const to = current?.period_end ?? new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)), 0, 12)).toISOString().slice(0, 10);
    const score = await db.rpc('associate_scorecard', { p_from: from, p_to: to });
    const schemaReady = !score.error;
    if (score.error && score.error.code !== 'PGRST202')
        throw new Error(score.error.message);
    const data = (i: number) => (results[i] as {
        data: Record<string, unknown>[];
    }).data;
    return { owner: profile.id, ownerKey: String((results[10] as {
            data: {
                legacy_key: string | null;
            };
        }).data.legacy_key ?? '') || null, name: profile.full_name, branch: profile.branch_name,
        leads: results[0], partners: results[1], interactions: results[2], cpInteractions: results[3], bookings: results[4], projects: data(5), actions: data(6).map(r => r.label), coldReasons: data(7).map(r => r.label), commitments: results[8], assigned: data(11),
        period: { from, to, label: current?.label ?? 'This month' }, score: score.data ?? { meetings: 0, hot: 0, cp_meetings: 0, bookings: 0, targets: {} }, schemaReady } as unknown as Bundle;
});
