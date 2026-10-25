# What the Excel template looks like (read for Prompt 2: importing the data)

Source read: `~/Downloads/NCR_Channel_10Day_Review_Template.xlsx` (the newest of several copies; older copies are in
`~/Downloads/Sales Performance Reviews/`). Branch: DELHI NCR, Branch Head: Ajay Kushwaha.

## Sheets

| Sheet | State | Notes |
|---|---|---|
| Master | visible | Dashboard. Aggregates each associate tab with `INDIRECT` (breaks if a tab is renamed). Helper columns L:T find each tab's "SN", "SECTION 2", "SECTION 3" and "TOTAL" rows. Lists 9 associates; all 9 tabs exist. |
| Udit Nigam, Parul Khatreja, Anoop Soni, Manisha Singh, Amandeep Singh, Chetna Ragya | visible | Associate tabs |
| Anoop Sharma, Diksha, Divya | **hidden** | Associate tabs (Master names them "Divya Bajpai", "Diksha Bajpai": tab name ≠ full name) |
| Sheet2 | hidden | A small per-person CP-count table (P1/p2/p3). Ignore. |

## Associate tab layout (not identical across tabs!)

- Header: Associate Name (B3), Designation (F3), Reporting Manager (J3). **Parul's tab has these blank.**
- **Section 1: Customer meetings** — SN, Customer Name, Phone, Mtg Date, Mtg Type (In-person/Virtual/Both), Project, HWC (Hot/Warm/Cold), Plot Name(s), Remarks, Next Action, Next Action Date, Reason/Nurturing Plan (if Cold).
- **Section 2: Channel partner meetings** — SN, CP Name, Firm, Mtg Date, Rating (Active/Hot/Warm/Cold), Remarks (col F), Next Action (col I), Next Action Date (col K).
- **Section 3: Bookings** — SN, Customer, Project, Unit/Plot #, Booking Value, Booking Date, Status, Source, CP Name, Remarks.
- The rows move between tabs: Udit's Section 2 starts at row ~52 and Section 3 at ~95; Parul's start at ~184 and ~275. **Locate sections by the "SECTION n" text in column A, never by fixed row numbers.**

## Data quality problems to handle on import

- **Missing meeting dates** (many customer and CP rows). Needs a rule (e.g. use the sheet's period, or a visible "unknown date" flag).
- **Plot column holds junk** in places (e.g. numbers like 267268 or 24220 that look like amounts, not plot numbers).
- **Next Action Date column used as free text** ("Closed", "Site Visit Done", "NOt intereted as per family discussion").
- **Next Action stored as dates** in some rows (Udit's col J has dates, col K has notes): columns are swapped inconsistently.
- **CP follow-up dates in 2025** while meetings are in 2026 (typing the wrong year).
- **Rating contradicts remarks**: e.g. "Client booked two units" marked Hot, "Booked unit but cancelled" marked Cold; "Closed" with a Warm rating.
- **Duplicate people**: repeated customers across rows/tabs, variant CP spellings, names used both as CP and customer, and group names. Use stable keys and ownership to deduplicate; do not publish source customer names in documentation.
- **Bookings**: blank value/date/plot on some rows; the same customer with several plots (several booking rows for one lead is correct); `Status` Token vs Booking Done inconsistent with remarks; a booking row with no matching meeting row.
- **CP Name column on bookings is free text**, sometimes with two firms ("Darpan Investment / Diksha Estate") or a note ("Darpan Investment Digital Lead Source" while Source says Direct).
- Free-form project spelling: `Kudal`, `kudal`, `Kudal ` (trailing space). Projects in use: Kudal, Tilari, Club Lake Reserve ("CLR").
- Parul's tab has "Column 1…Column 14" filler headers beside the Section 1 header.
- Hindi/Devanagari may appear in remarks. Keep UTF-8 end to end.

## Mapping to the database

| Excel | Database |
|---|---|
| Customer row (Name + Phone) | one `leads` row (dedupe by phone, else normalised name + owner); original row kept in `leads.raw_json` |
| Each Section 1 row | one `interactions` row (type `meeting`), `rating_after` = HWC, `rating_before` filled by trigger |
| Section 2 row | `channel_partners` (deduped by `normalized_key`) + one `cp_interactions` row |
| Section 3 row | one `bookings` row (+ history row by trigger); needs a lead (create one if none matches) |
| Tab name / Associate Name | `profiles` (match by name; create inactive profiles for ex-associates if needed) |

Import in **chronological order per lead** so `rating_before` comes out right (the trigger also handles out-of-order inserts).
