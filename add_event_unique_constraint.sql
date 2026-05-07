-- 为 component_status_event 表添加唯一约束
ALTER TABLE component_status_event 
ADD CONSTRAINT component_status_event_unique_status 
UNIQUE (component_id, status_type, event_at);
