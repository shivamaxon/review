export type Row = {
    id: string;
    updated_at: string;
    [key: string]: unknown;
};
export type Lead = Row & {
    name: string;
    phone: string | null;
    project_id: string | null;
    current_rating: string | null;
    plot_names: string[];
    next_action: string | null;
    next_action_date: string | null;
    last_touch_at: string | null;
    is_historical: boolean;
    status: string;
};
export type Partner = Row & {
    name: string;
    firm: string | null;
    phone: string | null;
    current_rating: string | null;
    next_action: string | null;
    next_action_date: string | null;
    is_historical: boolean;
};
export type Interaction = Row & {
    lead_id: string;
    cp_id?: string;
    occurred_on: string;
    rating_before: string | null;
    rating_after: string | null;
    remark: string | null;
    plot_names?: string[];
    is_historical: boolean;
    next_action: string | null;
    next_action_date: string | null;
};
export type Booking = Row & {
    lead_id: string;
    cp_id: string | null;
    project_id: string | null;
    plot_no: string | null;
    status: string;
    value: number | null;
    booking_date: string | null;
};
export type Bundle = {
    owner: string;
    ownerKey: string | null;
    name: string;
    branch: string | null;
    leads: Lead[];
    partners: Partner[];
    interactions: Interaction[];
    cpInteractions: Interaction[];
    bookings: Booking[];
    projects: {
        id: string;
        name: string;
    }[];
    actions: string[];
    coldReasons: string[];
    commitments: Row[];
    assigned: Row[];
    period: {
        from: string;
        to: string;
        label: string;
    };
    score: {
        meetings: number;
        hot: number;
        cp_meetings: number;
        bookings: number;
        targets: Record<string, number | null>;
    };
    schemaReady: boolean;
};
export type EntryKind = 'customer' | 'cp' | 'booking' | 'edit_lead' | 'edit_interaction' | 'edit_cp_interaction' | 'edit_booking';
export type Payload = Record<string, unknown>;
export type EntryResult = {
    id?: string;
    lead_id?: string;
    cp_id?: string;
    request_id?: string;
    duplicate_lead_id?: string;
    message?: string;
    error?: string;
    undone?: boolean;
};
export type QueuedEntry = {
    owner: string;
    request_id: string;
    kind: EntryKind;
    payload: Payload;
    created_at: string;
    error?: string;
    fromPaste?: boolean;
    undo?: boolean;
};
