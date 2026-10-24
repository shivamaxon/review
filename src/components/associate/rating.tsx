import { CUSTOMER_DEFINITIONS, CP_DEFINITIONS } from '@/lib/associate/common';
export function RatingBadge({ rating }: {
    rating: unknown;
}) { const r = String(rating ?? 'unrated').toLowerCase(); return <span className={`rating-badge rating-${r}`}>{r === 'active' ? 'CP Active' : r.charAt(0).toUpperCase() + r.slice(1)}</span>; }
export function RatingPicker({ value, onChange, cp = false }: {
    value: string;
    onChange: (r: string) => void;
    cp?: boolean;
}) {
    const definitions = cp ? CP_DEFINITIONS : CUSTOMER_DEFINITIONS;
    return <fieldset className="space-y-2"><legend className="field-label mb-2">Rating</legend>{Object.entries(definitions).map(([r, definition]) => <button type="button" aria-pressed={value === r} key={r} className={`rating-choice rating-${r} ${value === r ? 'rating-selected' : ''}`} onClick={() => onChange(r)}><strong className="min-w-16 capitalize">{r}</strong><span className="text-left text-xs leading-relaxed">{definition}</span>{value === r && <span aria-hidden="true">✓</span>}</button>)}</fieldset>;
}
