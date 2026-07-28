-- Bridge fields: production plan / scheduling ↔ order artifact (from getPlanArtifacts)
\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE order_component
    ADD COLUMN IF NOT EXISTS plan_id BIGINT,
    ADD COLUMN IF NOT EXISTS scheduling_id BIGINT,
    ADD COLUMN IF NOT EXISTS production_artifact_id BIGINT,
    ADD COLUMN IF NOT EXISTS bridge_synced_at TIMESTAMPTZ;

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
