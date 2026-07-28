/**
 * 检查「部分未写入」剩余订单是否已发货（构件级 + 订单状态）。
 * 用法：node scripts/check-partial-orders-shipping.js
 */
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const ExcelJS = require('exceljs');
const config = require('../config/default.json');

const EXCLUDED = [1, 16, 18];

(async () => {
    const pool = new Pool({ ...config.db, max: 4 });

    const ordersRes = await pool.query(
        `
            SELECT
                so.order_id,
                so.cloud_project_id,
                so.project_name,
                so.order_name,
                so.order_code,
                so.order_status,
                so.order_status_name,
                so.artifacts_count,
                count(oc.order_component_id)::int AS order_component_count
            FROM sales_order so
            LEFT JOIN order_component oc ON oc.order_id = so.order_id
            WHERE so.cloud_project_id IS NOT NULL
              AND NOT (so.cloud_project_id = ANY($1::bigint[]))
            GROUP BY so.order_id, so.cloud_project_id, so.project_name, so.order_name,
                     so.order_code, so.order_status, so.order_status_name, so.artifacts_count
            HAVING count(oc.order_component_id) > 0
               AND so.artifacts_count > count(oc.order_component_id)
            ORDER BY (so.artifacts_count - count(oc.order_component_id)) DESC
        `,
        [EXCLUDED]
    );

    const orderIds = ordersRes.rows.map(r => Number(r.order_id));

    const compRes = await pool.query(
        `
            SELECT
                oc.order_id,
                count(*)::int AS linked_rows,
                count(*) FILTER (WHERE oc.component_id IS NOT NULL)::int AS with_component_id,
                count(*) FILTER (
                    WHERE oc.component_id IS NOT NULL
                      AND EXISTS (
                          SELECT 1 FROM component_status_event e
                          WHERE e.component_id = oc.component_id
                            AND e.status_type = 'shipping'
                            AND e.is_completed = TRUE
                      )
                )::int AS shipped_linked,
                count(*) FILTER (
                    WHERE oc.component_id IS NOT NULL
                      AND NOT EXISTS (
                          SELECT 1 FROM component_status_event e
                          WHERE e.component_id = oc.component_id
                            AND e.status_type = 'shipping'
                            AND e.is_completed = TRUE
                      )
                )::int AS unshipped_linked,
                count(*) FILTER (WHERE oc.component_id IS NULL)::int AS no_component_id
            FROM order_component oc
            WHERE oc.order_id = ANY($1::bigint[])
            GROUP BY oc.order_id
        `,
        [orderIds]
    );
    const compByOrder = new Map(compRes.rows.map(r => [Number(r.order_id), r]));

    const gapShipRes2 = await pool.query(
        `
            WITH partial AS (
                SELECT order_id, project_name, artifacts_count
                FROM sales_order
                WHERE order_id = ANY($1::bigint[])
            ),
            oc_stats AS (
                SELECT
                    oc.order_id,
                    oc.component_guid,
                    oc.scheduling_id,
                    max(oc.component_id) AS sample_component_id
                FROM order_component oc
                JOIN partial p ON p.order_id = oc.order_id
                GROUP BY oc.order_id, oc.component_guid, oc.scheduling_id
            ),
            prod_match AS (
                SELECT
                    s.order_id,
                    s.component_guid,
                    s.scheduling_id,
                    c.component_id
                FROM oc_stats s
                JOIN partial p ON p.order_id = s.order_id
                JOIN project pr ON trim(pr.project_name) = trim(p.project_name)
                JOIN production_plan pp ON pp.project_id = pr.project_id
                JOIN (
                    SELECT DISTINCT plan_id, scheduling_id
                    FROM order_component
                    WHERE plan_id IS NOT NULL AND scheduling_id IS NOT NULL
                ) ps ON ps.plan_id = pp.plan_id AND ps.scheduling_id = s.scheduling_id
                JOIN component c ON c.plan_id = pp.plan_id
                    AND trim(c.component_guid::text) = trim(s.component_guid)
            )
            SELECT
                pm.order_id,
                count(DISTINCT (pm.component_guid, pm.scheduling_id))::int AS guid_plan_keys,
                count(DISTINCT pm.component_id) FILTER (
                    WHERE EXISTS (
                        SELECT 1 FROM component_status_event e
                        WHERE e.component_id = pm.component_id
                          AND e.status_type = 'shipping'
                          AND e.is_completed = TRUE
                    )
                )::int AS prod_shipped,
                count(DISTINCT pm.component_id) FILTER (
                    WHERE NOT EXISTS (
                        SELECT 1 FROM component_status_event e
                        WHERE e.component_id = pm.component_id
                          AND e.status_type = 'shipping'
                          AND e.is_completed = TRUE
                    )
                )::int AS prod_unshipped
            FROM prod_match pm
            GROUP BY pm.order_id
        `,
        [orderIds]
    );

    const schedShipRes = await pool.query(
        `
            WITH order_sched AS (
                SELECT DISTINCT oc.order_id, oc.scheduling_id, oc.plan_id
                FROM order_component oc
                WHERE oc.order_id = ANY($1::bigint[])
                  AND oc.scheduling_id IS NOT NULL
            ),
            sched_components AS (
                SELECT
                    os.order_id,
                    c.component_id
                FROM order_sched os
                JOIN component c ON c.plan_id = os.plan_id
            )
            SELECT
                sc.order_id,
                count(DISTINCT sc.component_id)::int AS sched_plan_components,
                count(DISTINCT sc.component_id) FILTER (
                    WHERE EXISTS (
                        SELECT 1 FROM component_status_event e
                        WHERE e.component_id = sc.component_id
                          AND e.status_type = 'shipping'
                          AND e.is_completed = TRUE
                    )
                )::int AS sched_plan_shipped,
                count(DISTINCT sc.component_id) FILTER (
                    WHERE NOT EXISTS (
                        SELECT 1 FROM component_status_event e
                        WHERE e.component_id = sc.component_id
                          AND e.status_type = 'shipping'
                          AND e.is_completed = TRUE
                    )
                )::int AS sched_plan_unshipped
            FROM sched_components sc
            GROUP BY sc.order_id
        `,
        [orderIds]
    );
    const gapByOrder = new Map(gapShipRes2.rows.map(r => [Number(r.order_id), r]));
    const schedByOrder = new Map(schedShipRes.rows.map(r => [Number(r.order_id), r]));

    const rows = ordersRes.rows.map(r => {
        const orderId = Number(r.order_id);
        const api = Number(r.artifacts_count) || 0;
        const db = Number(r.order_component_count) || 0;
        const gap = api - db;
        const comp = compByOrder.get(orderId) || {};
        const gapShip = gapByOrder.get(orderId) || {};
        const linked = Number(comp.linked_rows) || db;
        const shippedLinked = Number(comp.shipped_linked) || 0;
        const unshippedLinked = Number(comp.unshipped_linked) || 0;
        const withCompId = Number(comp.with_component_id) || 0;

        let shippingSummary = '';
        if (withCompId === 0) {
            shippingSummary = '已入库行均未关联生产构件，无法判发货';
        } else if (shippedLinked === withCompId) {
            shippingSummary = '已关联生产构件均已发货';
        } else if (unshippedLinked === withCompId) {
            shippingSummary = '已关联生产构件均未发货';
        } else {
            shippingSummary = `已关联：已发货${shippedLinked}，未发货${unshippedLinked}`;
        }

        const prodShipped = Number(gapShip.prod_shipped) || 0;
        const prodUnshipped = Number(gapShip.prod_unshipped) || 0;
        const sched = schedByOrder.get(orderId) || {};
        const schedTotal = Number(sched.sched_plan_components) || 0;
        const schedShipped = Number(sched.sched_plan_shipped) || 0;
        const schedUnshipped = Number(sched.sched_plan_unshipped) || 0;

        let gapShippingNote = '';
        if (prodShipped + prodUnshipped > 0) {
            gapShippingNote = `已入库GUID产库匹配：已发货${prodShipped}，未发货${prodUnshipped}`;
        } else {
            gapShippingNote = '已入库行无额外产库GUID样本';
        }
        if (schedTotal > 0) {
            gapShippingNote += `；订单涉及排产计划下产库构件共${schedTotal}件(已发货${schedShipped}/未发货${schedUnshipped})`;
        }

        const statusName = String(r.order_status_name || '').trim();
        const orderShipHint =
            /发货|出库|完成|已交/.test(statusName) ? '订单状态含发货/完成语义' : statusName || '无订单状态名';

        return {
            order_id: orderId,
            project_name: r.project_name || '',
            order_name: r.order_name || '',
            order_code: r.order_code || '',
            cloud_project_id: r.cloud_project_id != null ? Number(r.cloud_project_id) : null,
            order_status: r.order_status,
            order_status_name: statusName,
            order_ship_hint: orderShipHint,
            api_artifacts_count: api,
            order_component_count: db,
            missing_count: gap,
            linked_with_component_id: withCompId,
            linked_shipped: shippedLinked,
            linked_unshipped: unshippedLinked,
            linked_shipping_summary: shippingSummary,
            gap_prod_shipped: prodShipped,
            gap_prod_unshipped: prodUnshipped,
            sched_plan_components: schedTotal,
            sched_plan_shipped: schedShipped,
            sched_plan_unshipped: schedUnshipped,
            gap_shipping_note: gapShippingNote
        };
    });

    const outDir = path.join(__dirname, '../downloads');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const xlsxPath = path.join(outDir, `部分未写入订单_发货核查_${stamp}.xlsx`);

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('发货核查');
    ws.columns = [
        { header: '订单ID', key: 'order_id', width: 10 },
        { header: '订单名称', key: 'order_name', width: 40 },
        { header: '项目名称', key: 'project_name', width: 28 },
        { header: '订单状态', key: 'order_status_name', width: 14 },
        { header: '订单状态解读', key: 'order_ship_hint', width: 22 },
        { header: 'API构件数', key: 'api_artifacts_count', width: 10 },
        { header: '已入库数', key: 'order_component_count', width: 10 },
        { header: '缺口数', key: 'missing_count', width: 8 },
        { header: '已关联生产构件数', key: 'linked_with_component_id', width: 14 },
        { header: '已关联-已发货', key: 'linked_shipped', width: 12 },
        { header: '已关联-未发货', key: 'linked_unshipped', width: 12 },
        { header: '已关联发货概况', key: 'linked_shipping_summary', width: 28 },
        { header: '缺口产库-已发货', key: 'gap_prod_shipped', width: 12 },
        { header: '缺口产库-未发货', key: 'gap_prod_unshipped', width: 12 },
        { header: '涉及排产-产库构件总数', key: 'sched_plan_components', width: 16 },
        { header: '涉及排产-已发货', key: 'sched_plan_shipped', width: 12 },
        { header: '涉及排产-未发货', key: 'sched_plan_unshipped', width: 12 },
        { header: '缺口发货说明', key: 'gap_shipping_note', width: 40 }
    ];
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    for (const row of rows) ws.addRow(row);

    const sum = wb.addWorksheet('汇总');
    sum.addRow(['指标', '数值']);
    sum.getRow(1).font = { bold: true };
    sum.addRow(['部分未写入订单数', rows.length]);
    sum.addRow([
        '已关联构件全部已发货',
        rows.filter(r => r.linked_with_component_id > 0 && r.linked_unshipped === 0).length
    ]);
    sum.addRow([
        '已关联构件存在未发货',
        rows.filter(r => r.linked_unshipped > 0).length
    ]);
    sum.addRow([
        '订单状态名含发货/完成语义',
        rows.filter(r => /发货|出库|完成|已交/.test(r.order_status_name)).length
    ]);
    sum.addRow(['说明', '发货以 component_status_event.status_type=shipping 且 is_completed=true 为准']);

    await wb.xlsx.writeFile(xlsxPath);

    console.log(
        JSON.stringify(
            {
                xlsxPath,
                orderCount: rows.length,
                allLinkedShipped: rows.filter(
                    r => r.linked_with_component_id > 0 && r.linked_unshipped === 0
                ).length,
                hasUnshippedLinked: rows.filter(r => r.linked_unshipped > 0).length,
                rows
            },
            null,
            2
        )
    );

    await pool.end();
})().catch(e => {
    console.error(e);
    process.exitCode = 1;
});
