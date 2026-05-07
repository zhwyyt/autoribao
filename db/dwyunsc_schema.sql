-- Database: dwyunsc
-- Schema: public (default)
--
-- Data model:
-- project (1) -> production_plan (N) -> component (N) -> component_status_event (N)
--
-- Notes:
-- - component_no is NOT unique.
-- - component_guid is unique within the same plan (plan_id, component_guid).
-- - component status can occur multiple times; we only track "is_completed" and "event_at".

\set ON_ERROR_STOP on
\encoding UTF8

-- 1) Create database (must run outside transaction).
SELECT format('CREATE DATABASE %I', 'dwyunsc')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'dwyunsc')
\gexec

-- 2) Connect to database.
\connect dwyunsc

-- Force client encoding to UTF8 before sending any non-ASCII SQL/comments.
SET client_encoding TO 'UTF8';

BEGIN;

-- 3) Enums
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'project_status') THEN
    CREATE TYPE project_status AS ENUM ('building', 'closed', 'pipeline'); -- 在建 / 已完结 / 流水线项目
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'plan_status') THEN
    CREATE TYPE plan_status AS ENUM ('producing', 'completed', 'archived'); -- 生产中 / 已完成 / 已归档
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'component_status_type') THEN
    CREATE TYPE component_status_type AS ENUM (
      'steel_production_start',  -- 钢构生产开始
      'fitup_weld_report',       -- 装焊报检
      'fitup_weld_ndi',          -- 装焊探伤
      'fitup_weld_qc',           -- 装焊质检
      'painting',                -- 涂装
      'shipping'                 -- 发货
    );
  END IF;
END
$$;

-- 4) Tables
CREATE TABLE IF NOT EXISTS project (
  project_id   BIGSERIAL PRIMARY KEY,
  project_name TEXT NOT NULL,
  project_status project_status NOT NULL DEFAULT 'building',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Project rename history (optional but useful for audit/debug)
CREATE TABLE IF NOT EXISTS project_name_history (
  history_id  BIGSERIAL PRIMARY KEY,
  project_id  BIGINT NOT NULL REFERENCES project(project_id) ON DELETE CASCADE,
  old_name    TEXT NOT NULL,
  new_name    TEXT NOT NULL,
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  source      TEXT
);

CREATE TABLE IF NOT EXISTS production_plan (
  plan_id     BIGSERIAL PRIMARY KEY,
  project_id  BIGINT NOT NULL REFERENCES project(project_id) ON DELETE RESTRICT,
  plan_name   TEXT NOT NULL,
  start_at    TIMESTAMPTZ,
  end_at      TIMESTAMPTZ,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  component_count INTEGER NOT NULL DEFAULT 0,
  plan_status plan_status NOT NULL DEFAULT 'producing',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
);

CREATE TABLE IF NOT EXISTS component (
  component_id BIGSERIAL PRIMARY KEY,
  plan_id      BIGINT NOT NULL REFERENCES production_plan(plan_id) ON DELETE RESTRICT,

  component_no   TEXT,          -- 构件编号（不唯一）
  component_guid UUID NOT NULL, -- 构件GUID（同计划内唯一）
  model_id       TEXT,          -- 模型ID（来源不确定，先用TEXT）
  spec           TEXT,          -- 规格/型号
  quantity       INTEGER NOT NULL DEFAULT 1,
  weight         NUMERIC(12,3), -- 重量
  length         NUMERIC(12,3), -- 长度
  production_feature TEXT,      -- 生产特征
  location       TEXT,          -- 区域部位/所在楼层

  -- Optional snapshot for fast filtering / list pages.
  current_status component_status_type,
  current_status_at TIMESTAMPTZ,

  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT component_quantity_chk CHECK (quantity > 0),
  CONSTRAINT component_guid_unique_per_plan UNIQUE (plan_id, component_guid)
);

CREATE TABLE IF NOT EXISTS component_status_event (
  event_id     BIGSERIAL PRIMARY KEY,
  component_id BIGINT NOT NULL REFERENCES component(component_id) ON DELETE CASCADE,
  status_type  component_status_type NOT NULL,
  is_completed BOOLEAN NOT NULL DEFAULT true,
  event_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4.1) Triggers
-- Track project_name changes automatically.
CREATE OR REPLACE FUNCTION trg_project_name_history()
RETURNS trigger AS $$
DECLARE
  src TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND (OLD.project_name IS DISTINCT FROM NEW.project_name) THEN
    src := current_setting('app.sync_source', true);
    IF src IS NULL OR src = '' THEN
      src := current_setting('application_name', true);
    END IF;

    INSERT INTO project_name_history(project_id, old_name, new_name, changed_at, source)
    VALUES (NEW.project_id, OLD.project_name, NEW.project_name, now(), NULLIF(src, ''));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS project_name_history_trg ON project;
CREATE TRIGGER project_name_history_trg
AFTER UPDATE OF project_name ON project
FOR EACH ROW
EXECUTE FUNCTION trg_project_name_history();

-- 5) Indexes
CREATE INDEX IF NOT EXISTS idx_production_plan_project_id ON production_plan(project_id);
CREATE INDEX IF NOT EXISTS idx_production_plan_project_time ON production_plan(project_id, start_at);

CREATE INDEX IF NOT EXISTS idx_project_name_history_project_time
  ON project_name_history(project_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_project_name_history_changed_at
  ON project_name_history(changed_at DESC);

CREATE INDEX IF NOT EXISTS idx_component_plan_id ON component(plan_id);
CREATE INDEX IF NOT EXISTS idx_component_guid ON component(component_guid);
CREATE INDEX IF NOT EXISTS idx_component_current_status ON component(current_status);

CREATE INDEX IF NOT EXISTS idx_component_status_event_component_time
  ON component_status_event(component_id, event_at DESC);
CREATE INDEX IF NOT EXISTS idx_component_status_event_type_time
  ON component_status_event(status_type, event_at DESC);

COMMIT;
