-- 由于接口返回的“构件GUID”并非标准 UUID（示例：9GT-1-251013-081514-2），因此将 component.component_guid 从 uuid 调整为 text

BEGIN;

-- 1) 删除依赖该列的唯一约束（名称不确定，使用 DO 块动态查找）
DO $$
DECLARE
    c_name text;
BEGIN
    SELECT conname INTO c_name
    FROM pg_constraint
    WHERE conrelid = 'component'::regclass
      AND contype = 'u'
      AND pg_get_constraintdef(oid) LIKE '%(plan_id, component_guid)%'
    LIMIT 1;

    IF c_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE component DROP CONSTRAINT %I', c_name);
    END IF;
END$$;

-- 2) 修改字段类型为 text（保留原值）
ALTER TABLE component
    ALTER COLUMN component_guid TYPE text
    USING component_guid::text;

-- 3) 重新创建唯一约束
ALTER TABLE component
    ADD CONSTRAINT uq_component_plan_guid UNIQUE (plan_id, component_guid);

COMMIT;
