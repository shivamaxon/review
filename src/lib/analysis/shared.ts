export type Json=Record<string,unknown>;
export type Params=Record<string,string|string[]|undefined>;
export const DIMENSIONS=['associate','team','project','source','cp','firm','rating','week','month','cold_reason','mode','status','branch','cancel_reason'];
export const MEASURES=['count','unique_leads','hot_pct','conversion_pct','booking_units','value','average_ticket','cancellation_pct','average_days_to_close'];
export const LABELS:Record<string,string>={customer_meetings:'Customer meetings',hot_leads:'Hot leads',warm_leads:'Warm leads',cold_leads:'Cold leads',hot_pct:'Hot %',cp_meetings:'CP meetings',active_cps:'Active CPs',bookings:'Booking units',booking_value:'Booking value',tokens:'Tokens',cancellations:'Cancellations',cancellation_pct:'Cancellation %',hot_conversion:'Hot → booked',count:'Count',unique_leads:'Unique leads',conversion_pct:'Conversion %',booking_units:'Booking units',value:'Value',average_ticket:'Average ticket',average_days_to_close:'Average days to close',dated_actions_pct:'Next steps dated %',on_time_pct:'Followed up on time %',hot_stale7:'Hot untouched ≥7 days',meetings:'Meetings',hot:'Hot',cps_met:'CPs met',associate:'Associate',team:'Team',project:'Project',source:'Source',cp:'Channel partner',firm:'Firm',rating:'Rating',week:'Week',month:'Month',cold_reason:'Cold reason',mode:'Meeting type',status:'Status',branch:'Branch'};
export const object=(v:unknown):Json=>v&&typeof v==='object'&&!Array.isArray(v)?v as Json:{};
export const list=(v:unknown):Json[]=>Array.isArray(v)?v as Json[]:[];
export const valueText=(v:unknown)=>v==null?'—':Array.isArray(v)?v.join(', '):String(v);
export function format(v:unknown,key=''){if(v==null)return '—';const n=Number(v);if(!Number.isFinite(n))return String(v);if(['value','booking_value','average_ticket'].includes(key)){const abs=Math.abs(n);return abs>=1e7?'Rs '+(n/1e7).toLocaleString('en-IN',{maximumFractionDigits:2})+' Cr':abs>=1e5?'Rs '+(n/1e5).toLocaleString('en-IN',{maximumFractionDigits:2})+' Lakh':'Rs '+n.toLocaleString('en-IN',{maximumFractionDigits:0});}return n.toLocaleString('en-IN',{maximumFractionDigits:2})+(key.endsWith('_pct')||key==='hot_conversion'?'%':'');}
export function queryString(params:Params,patch:Record<string,string|string[]|undefined|null>={}){const q=new URLSearchParams();for(const [k,v] of Object.entries({...params,...patch})){if(v==null||v==='')continue;for(const x of Array.isArray(v)?v:[v])q.append(k,x);}return q.toString();}
export function readFilters(params:Params):Json{
 const one=(k:string)=>Array.isArray(params[k])?params[k]![0]:params[k];
 const filters:Json={window:one('window')??'cycle',compare:one('compare')==='true'?'true':'false',history:one('history')??'all'};
 for(const k of ['from','to','branch','project','source','cp','firm','q'])if(one(k))filters[k]=one(k);
 filters.associates=params.associate?(Array.isArray(params.associate)?params.associate:[params.associate]):[];
 const dims:Json={};for(const dim of DIMENSIONS)if(params['f_'+dim])dims[dim]=Array.isArray(params['f_'+dim])?params['f_'+dim]:[params['f_'+dim]];filters.dimensions=dims;return filters;
}
export function drillHref(params:Params,metric:string,patch:Record<string,string|string[]|undefined|null>={}){return '?'+queryString(params,{...patch,drill:metric,page:undefined});}
