# Data Model

## Overview

Health Tracker stores everything locally first (IndexedDB via Dexie), then syncs to Neon Postgres when online. The schema is identical in both places so round-trips are lossless.

## Tables

### persons
The patient profile. In this app there is typically one person (the mother), but the schema supports multiple people per family.

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | Client-generated (`per_…`) |
| name_ar | TEXT | Arabic display name |
| timezone | TEXT | IANA, e.g. `Africa/Cairo` |
| allergies | TEXT[] | Array of allergy strings |
| updated_at | TIMESTAMPTZ | Server-authoritative |
| rev | INTEGER | Monotonic, drives conflict resolution |
| deleted | BOOLEAN | Soft-delete |

### medications
One row per medication. `balance_cache` is a fast-read snapshot; the ground truth is `inventory_events`.

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | `med_…` |
| person_id | FK → persons | |
| name_ar | TEXT | |
| strength | JSONB | `{ value, unit }` |
| form | TEXT | tablet, capsule, syrup, … |
| package | JSONB | `{ kind, pillCount, strips?, pillsPerStrip? }` |
| rx | JSONB | `{ isPrescription, isControlled, renewalDate? }` |
| food_rule | JSONB | `{ mode, text? }` |
| cost | JSONB | `{ packagePrice, currency, packageSize }` |
| status | TEXT | active / paused / finished / discontinued |
| balance_cache | NUMERIC | Cached; always recomputable |

### schedules
History is append-only. Editing a schedule closes the old one (`active_to`) and inserts a new row. Past `dose_events` keep pointing at the old schedule id.

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | `sch_…` |
| med_id | FK → medications | |
| kind | TEXT | daily / everyNDays / weekdays / prn / taper |
| times | TEXT[] | Local `HH:mm` values |
| quantity_per_dose | NUMERIC | |
| doses_per_day | INTEGER | Derived, stored for convenience |
| active_from | DATE | |
| active_to | DATE | null = current schedule |

### dose_events
Materialised from schedules. One row per scheduled dose instance.

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | Deterministic: `dose_${hash(personId+medId+scheduledAtUtc)}` |
| scheduled_at_utc | TIMESTAMPTZ | Exact instant |
| local_day | DATE | The calendar day in the person's timezone |
| status | TEXT | upcoming → due → taken / missed / skipped / snoozed |
| idempotency_key | TEXT UNIQUE | `personId::medId::scheduledAtUtc` |
| source | TEXT | mother / caregiver / auto-missed |

### inventory_events
**Append-only event log.** Never update or delete a row. The current balance is `foldBalance(events)`.

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | `inv_…` |
| med_id | FK → medications | |
| type | TEXT | initial / doseTaken / manualAdd / manualRemove / purchase / correction / discontinued |
| qty | NUMERIC | Negative = consumption, positive = addition |
| prev_balance | NUMERIC | Balance before this event |
| new_balance | NUMERIC | Balance after this event |
| at_utc | TIMESTAMPTZ | When the event happened |
| dose_id | FK → dose_events | Set when type = doseTaken |

### sync_tokens
Per-device watermark for incremental sync.

| Column | Type | Notes |
|--------|------|-------|
| device_id | TEXT PK | |
| person_id | FK → persons | |
| last_synced_at | TIMESTAMPTZ | |
| token | TEXT | Opaque cursor |

## Idempotency

- **Dose taken twice** → `markDoseTaken` checks `inventory_events` for an existing `doseTaken` row with the same `dose_id`. If found, it's a no-op.
- **Re-materialising doses** → `dose_event.id` is deterministic (hash of `personId + medId + scheduledAtUtc`). Re-running `materialiseDoses` with the same range produces the same ids, so `putDoseEvents` is naturally idempotent.

## Conflict Resolution

Server and client share the same `resolveConflict` logic:
- Non-clinical fields → last-writer-wins by `rev`.
- Clinical fields (dose, schedule, strength, status) → `askCaregiver` instead of guessing.

## Indexes

See `api/lib/schema.sql` for the full index list. Hot paths:
- `dose_events(person_id, local_day)` — Today screen.
- `dose_events(med_id, scheduled_at_utc)` — Medication detail timeline.
- `inventory_events(med_id)` — Balance calculation.
- `schedules(med_id, active_to)` — Active schedule lookup for consumption math.
