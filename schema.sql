-- Transitline backend schema (PostgreSQL)
-- Run this once against your Render Postgres database before starting the server.

CREATE TABLE IF NOT EXISTS accounts (
  staff_id       TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  password_hash  TEXT NOT NULL,
  role           TEXT NOT NULL,
  is_admin       BOOLEAN NOT NULL DEFAULT FALSE,
  bus_name       TEXT,                      -- which bus this driver reports GPS for (null for admins)
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS buses (
  bus_name    TEXT PRIMARY KEY,
  sub         TEXT,                         -- short description, e.g. "Karen route"
  lat         DOUBLE PRECISION,
  lng         DOUBLE PRECISION,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS alerts (
  id              SERIAL PRIMARY KEY,
  owner_staff_id  TEXT NOT NULL REFERENCES accounts(staff_id) ON DELETE CASCADE,
  tag             TEXT NOT NULL DEFAULT '',
  title           TEXT NOT NULL,
  sub             TEXT NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Single-row table holding the current school/campus location.
CREATE TABLE IF NOT EXISTS school (
  id    INT PRIMARY KEY DEFAULT 1,
  name  TEXT NOT NULL DEFAULT 'Ridgeview Academy',
  lat   DOUBLE PRECISION NOT NULL DEFAULT -1.2833,
  lng   DOUBLE PRECISION NOT NULL DEFAULT 36.7833,
  CONSTRAINT school_single_row CHECK (id = 1)
);
INSERT INTO school (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
