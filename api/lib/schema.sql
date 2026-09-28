-- Health Tracker — Neon Postgres schema
-- Run this once after creating your Neon project.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ------------------------------------------------------------------
-- Sync envelope columns (shared by every synced table)
-- ------------------------------------------------------------------

CREATE TABLE persons (
  id            TEXT PRIMARY KEY,
  name_ar       TEXT NOT NULL,
  name_en       TEXT,
  dob           DATE,
  gender        TEXT CHECK (gender IN ('male','female')),
  blood_type    TEXT,
  allergies     TEXT[] DEFAULT '{}',
  notes         TEXT,
  emergency_contact JSONB,
  color_tag     TEXT,
  is_minor      BOOLEAN DEFAULT FALSE,
  timezone      TEXT NOT NULL DEFAULT 'Africa/Cairo',
  large_text_default BOOLEAN DEFAULT FALSE,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by    TEXT NOT NULL,
  rev           INTEGER NOT NULL DEFAULT 1,
  deleted       BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE devices (
  id            TEXT PRIMARY KEY,
  label         TEXT NOT NULL,
  platform      TEXT NOT NULL CHECK (platform IN ('android','web','desktop')),
  bound_person_id TEXT REFERENCES persons(id) ON DELETE SET NULL,
  fcm_token     TEXT,
  last_seen_at  TIMESTAMPTZ,
  alarm_health  JSONB,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by    TEXT NOT NULL,
  rev           INTEGER NOT NULL DEFAULT 1,
  deleted       BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE notif_prefs (
  id            TEXT PRIMARY KEY,
  device_id     TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  person_id     TEXT NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  mode          TEXT NOT NULL DEFAULT 'mirrorAll' CHECK (mode IN ('off','escalationOnly','mirrorAll','digest')),
  escalation_delay_min INTEGER NOT NULL DEFAULT 15,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by    TEXT NOT NULL,
  rev           INTEGER NOT NULL DEFAULT 1,
  deleted       BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (device_id, person_id)
);

CREATE TABLE medications (
  id            TEXT PRIMARY KEY,
  person_id     TEXT NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  name_ar       TEXT NOT NULL,
  name_en       TEXT,
  active_ingredients TEXT[] DEFAULT '{}',
  strength      JSONB NOT NULL,
  form          TEXT NOT NULL CHECK (form IN ('tablet','capsule','syrup','injection','drops','inhaler','patch','other')),
  package       JSONB NOT NULL,
  manufacturer  TEXT,
  notes         TEXT,
  rx            JSONB NOT NULL,
  pack_expiry   DATE,
  start_date    DATE NOT NULL,
  end_date      DATE,
  food_rule     JSONB NOT NULL,
  cost          JSONB NOT NULL,
  doctor        TEXT,
  condition     TEXT,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','finished','discontinued')),
  discontinued_reason TEXT,
  balance_cache NUMERIC,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by    TEXT NOT NULL,
  rev           INTEGER NOT NULL DEFAULT 1,
  deleted       BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE schedules (
  id            TEXT PRIMARY KEY,
  med_id        TEXT NOT NULL REFERENCES medications(id) ON DELETE CASCADE,
  person_id     TEXT NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('daily','everyNDays','weekdays','prn','taper')),
  times         TEXT[] NOT NULL DEFAULT '{}',
  quantity_per_dose NUMERIC NOT NULL,
  doses_per_day INTEGER NOT NULL,
  anchor_date   DATE NOT NULL,
  end_date      DATE,
  weekdays      INTEGER[] DEFAULT '{}',
  interval_n    INTEGER,
  prn_max_per_day INTEGER,
  taper_steps   JSONB,
  active_from   DATE NOT NULL,
  active_to     DATE,
  superseded_by TEXT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by    TEXT NOT NULL,
  rev           INTEGER NOT NULL DEFAULT 1,
  deleted       BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE dose_events (
  id            TEXT PRIMARY KEY,
  person_id     TEXT NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  med_id        TEXT NOT NULL REFERENCES medications(id) ON DELETE CASCADE,
  schedule_id   TEXT NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  scheduled_at_utc TIMESTAMPTZ NOT NULL,
  local_day     DATE NOT NULL,
  status        TEXT NOT NULL DEFAULT 'upcoming' CHECK (status IN ('upcoming','due','taken','missed','skipped','snoozed','cancelled')),
  acted_at_utc  TIMESTAMPTZ,
  acted_by_device_id TEXT,
  quantity      NUMERIC,
  source        TEXT CHECK (source IN ('mother','caregiver','auto-missed')),
  snoozed_until TIMESTAMPTZ,
  idempotency_key TEXT NOT NULL UNIQUE,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by    TEXT NOT NULL,
  rev           INTEGER NOT NULL DEFAULT 1,
  deleted       BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE inventory_events (
  id            TEXT PRIMARY KEY,
  person_id     TEXT NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  med_id        TEXT NOT NULL REFERENCES medications(id) ON DELETE CASCADE,
  type          TEXT NOT NULL CHECK (type IN ('initial','doseTaken','manualAdd','manualRemove','purchase','correction','discontinued')),
  qty           NUMERIC NOT NULL,
  reason        TEXT,
  prev_balance  NUMERIC NOT NULL,
  new_balance   NUMERIC NOT NULL,
  at_utc        TIMESTAMPTZ NOT NULL,
  device_id     TEXT NOT NULL,
  dose_id       TEXT REFERENCES dose_events(id) ON DELETE SET NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by    TEXT NOT NULL,
  rev           INTEGER NOT NULL DEFAULT 1,
  deleted       BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE lab_results (
  id            TEXT PRIMARY KEY,
  person_id     TEXT NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  type          TEXT NOT NULL,
  date          DATE NOT NULL,
  file_ref      TEXT,
  ai_summary    JSONB,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','summarised','failed')),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by    TEXT NOT NULL,
  rev           INTEGER NOT NULL DEFAULT 1,
  deleted       BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE documents (
  id            TEXT PRIMARY KEY,
  person_id     TEXT NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL,
  title         TEXT NOT NULL,
  storage_path  TEXT NOT NULL,
  size_bytes    INTEGER NOT NULL,
  mime_type     TEXT NOT NULL,
  uploaded_at   TIMESTAMPTZ NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by    TEXT NOT NULL,
  rev           INTEGER NOT NULL DEFAULT 1,
  deleted       BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE symptoms (
  id            TEXT PRIMARY KEY,
  person_id     TEXT NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  at_utc        TIMESTAMPTZ NOT NULL,
  severity      INTEGER NOT NULL CHECK (severity BETWEEN 1 AND 5),
  note          TEXT NOT NULL,
  related_med_id TEXT REFERENCES medications(id) ON DELETE SET NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by    TEXT NOT NULL,
  rev           INTEGER NOT NULL DEFAULT 1,
  deleted       BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE food_logs (
  id            TEXT PRIMARY KEY,
  person_id     TEXT NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  at_utc        TIMESTAMPTZ NOT NULL,
  text          TEXT NOT NULL,
  related_med_id TEXT REFERENCES medications(id) ON DELETE SET NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by    TEXT NOT NULL,
  rev           INTEGER NOT NULL DEFAULT 1,
  deleted       BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE recurring_tests (
  id            TEXT PRIMARY KEY,
  person_id     TEXT NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  interval      TEXT NOT NULL CHECK (interval IN ('monthly','3m','6m','yearly','custom')),
  custom_interval_days INTEGER,
  next_due      DATE NOT NULL,
  last_done     DATE,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by    TEXT NOT NULL,
  rev           INTEGER NOT NULL DEFAULT 1,
  deleted       BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE audit_logs (
  id            TEXT PRIMARY KEY,
  actor_device_id TEXT NOT NULL,
  at_utc        TIMESTAMPTZ NOT NULL,
  entity        TEXT NOT NULL,
  entity_id     TEXT NOT NULL,
  action        TEXT NOT NULL,
  before        JSONB,
  after         JSONB,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by    TEXT NOT NULL,
  rev           INTEGER NOT NULL DEFAULT 1,
  deleted       BOOLEAN NOT NULL DEFAULT FALSE
);

-- ------------------------------------------------------------------
-- Indexes for hot queries
-- ------------------------------------------------------------------

CREATE INDEX idx_medications_person ON medications(person_id) WHERE deleted = FALSE;
CREATE INDEX idx_schedules_med ON schedules(med_id) WHERE deleted = FALSE;
CREATE INDEX idx_schedules_active ON schedules(med_id, active_to) WHERE deleted = FALSE;
CREATE INDEX idx_dose_events_person_day ON dose_events(person_id, local_day) WHERE deleted = FALSE;
CREATE INDEX idx_dose_events_med_time ON dose_events(med_id, scheduled_at_utc) WHERE deleted = FALSE;
CREATE INDEX idx_dose_events_idempotency ON dose_events(idempotency_key);
CREATE INDEX idx_inventory_med ON inventory_events(med_id) WHERE deleted = FALSE;
CREATE INDEX idx_lab_person ON lab_results(person_id) WHERE deleted = FALSE;
CREATE INDEX idx_audit_entity ON audit_logs(entity, entity_id);

-- ------------------------------------------------------------------
-- Sync helpers
-- ------------------------------------------------------------------

CREATE TABLE sync_tokens (
  device_id     TEXT PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
  person_id     TEXT NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT '1970-01-01T00:00:00Z',
  token         TEXT NOT NULL DEFAULT ''
);
