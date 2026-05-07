WITH completed_fitup_weld_report AS (
  SELECT
    e.component_id,
    MAX(e.event_at) AS fitup_weld_report_completed_at
  FROM component_status_event e
  WHERE e.status_type = 'fitup_weld_report'
    AND e.is_completed = TRUE
  GROUP BY e.component_id
)
SELECT
  p.project_id,
  p.project_name,
  pp.plan_id,
  pp.plan_name,
  c.component_id,
  c.component_no,
  c.component_guid,
  c.model_id,
  c.spec,
  c.quantity,
  c.weight,
  c.length,
  c.production_feature,
  c.location,
  c.current_status,
  c.current_status_at,
  r.fitup_weld_report_completed_at
FROM completed_fitup_weld_report r
JOIN component c
  ON c.component_id = r.component_id
JOIN production_plan pp
  ON pp.plan_id = c.plan_id
JOIN project p
  ON p.project_id = pp.project_id
WHERE p.project_name = '杭钢玉环汽摩配智施智造中心及产业集成项目'
ORDER BY
  pp.plan_id,
  c.component_no NULLS LAST,
  c.component_id;
