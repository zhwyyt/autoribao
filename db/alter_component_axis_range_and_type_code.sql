-- getPlanArtifacts fields: 轴线范围 / 构件类型编码
-- Safe to rerun. This migration only adds nullable columns and does not rewrite data.
\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE public.component
    ADD COLUMN IF NOT EXISTS axis_range TEXT,
    ADD COLUMN IF NOT EXISTS component_type_code TEXT;

COMMIT;
