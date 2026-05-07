-- 为 project 表添加 head_person_name 字段（API 返回的负责人姓名）
ALTER TABLE project
ADD COLUMN IF NOT EXISTS head_person_name TEXT;

-- 可选：加注释说明字段来源
COMMENT ON COLUMN project.head_person_name IS 'API 返回的项目负责人姓名，用于变更判定与审计';

-- 若需记录负责人变更历史，可参考 project_name_history 建表（此处暂不展开）
