-- Order sync tables (sales_order + order_component)
-- Run against database dwyunsc after backup.

\set ON_ERROR_STOP on
\encoding UTF8

BEGIN;

CREATE TABLE IF NOT EXISTS sales_order (
    order_id              BIGINT PRIMARY KEY,
    project_id            BIGINT,
    project_name          TEXT NOT NULL DEFAULT '',
    order_name            TEXT NOT NULL DEFAULT '',
    order_code            TEXT,
    order_status          INTEGER,
    order_status_name     TEXT,
    artifacts_count       INTEGER NOT NULL DEFAULT 0,
    cloud_project_id      BIGINT,
    start_time            TIMESTAMPTZ,
    end_time              TIMESTAMPTZ,
    create_time           TIMESTAMPTZ,
    update_time           TIMESTAMPTZ,
    synced_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    sync_note             TEXT
);

CREATE TABLE IF NOT EXISTS order_component (
    order_component_id    BIGSERIAL PRIMARY KEY,
    order_id              BIGINT NOT NULL REFERENCES sales_order(order_id) ON DELETE CASCADE,
    dwyun_artifact_id     BIGINT NOT NULL,
    component_guid        TEXT NOT NULL,
    component_no          TEXT,
    spec                  TEXT,
    location              TEXT,
    component_id          BIGINT REFERENCES component(component_id) ON DELETE SET NULL,
    project_name          TEXT NOT NULL DEFAULT '',
    plan_id               BIGINT,
    scheduling_id         BIGINT,
    production_artifact_id BIGINT,
    match_method          TEXT NOT NULL DEFAULT 'project_guid',
    synced_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    bridge_synced_at      TIMESTAMPTZ,
    CONSTRAINT order_component_order_artifact_unique UNIQUE (order_id, dwyun_artifact_id)
);

CREATE INDEX IF NOT EXISTS idx_sales_order_project_name
    ON sales_order(project_name);
CREATE INDEX IF NOT EXISTS idx_sales_order_synced_at
    ON sales_order(synced_at DESC);

CREATE INDEX IF NOT EXISTS idx_order_component_component_guid
    ON order_component(component_guid);
CREATE INDEX IF NOT EXISTS idx_order_component_component_id
    ON order_component(component_id)
    WHERE component_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_order_component_project_guid
    ON order_component(project_name, component_guid);
CREATE INDEX IF NOT EXISTS idx_order_component_plan_id
    ON order_component(plan_id)
    WHERE plan_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_order_component_scheduling_id
    ON order_component(scheduling_id)
    WHERE scheduling_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_order_component_production_artifact_id
    ON order_component(production_artifact_id)
    WHERE production_artifact_id IS NOT NULL;

COMMIT;
