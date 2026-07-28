-- 记录云上已删除/不可见的云项目 ID（订单历史可能仍引用）
\set ON_ERROR_STOP on
\encoding UTF8

BEGIN;

CREATE TABLE IF NOT EXISTS cloud_project_deleted (
    cloud_project_id    BIGINT PRIMARY KEY,
    project_name        TEXT,
    deleted_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    source              TEXT NOT NULL DEFAULT 'manual',
    note                TEXT,
    order_count         INTEGER,
    last_verified_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cloud_project_deleted_verified
    ON cloud_project_deleted(last_verified_at DESC);

COMMENT ON TABLE cloud_project_deleted IS '云上已删除或 getList 不可见的项目；同步脚本应跳过';

COMMIT;
