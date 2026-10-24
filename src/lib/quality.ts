export const RECORD_TABLES = ['leads', 'interactions', 'cp_interactions', 'bookings', 'channel_partners'] as const;
export type RecordTable = typeof RECORD_TABLES[number];
export const EDIT_FIELDS: Record<RecordTable, string[]> = {
    leads: ['name', 'phone', 'current_rating', 'next_action', 'next_action_date', 'cold_reason', 'plot_names'],
    interactions: ['rating_before', 'rating_after', 'occurred_on', 'mode', 'remark', 'next_action', 'next_action_date', 'cold_reason', 'plot_names'],
    cp_interactions: ['rating_before', 'rating_after', 'occurred_on', 'mode', 'remark', 'next_action', 'next_action_date'],
    bookings: ['plot_no', 'value', 'booking_date', 'status', 'remarks', 'cp_sub_partner', 'cp_text_as_written'],
    channel_partners: ['name', 'phone', 'firm', 'current_rating', 'next_action', 'next_action_date'],
};
export const recordTable = (s: string): s is RecordTable => RECORD_TABLES.includes(s as RecordTable);
export const displayValue = (v: unknown) => v == null ? '' : Array.isArray(v) ? v.join(' | ') : String(v);
