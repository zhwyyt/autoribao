const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const { query } = require('./query/sql-runner');

const OUTPUT_DIR = path.resolve(__dirname, '../downloads/project-component-details-db');
let hasProjectNameHistoryTable = null;

function normalizeText(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

function sanitizeFileName(value) {
    return normalizeText(value).replace(/[\\/:*?"<>|]/g, '_');
}

async function hasHistoryTable() {
    if (typeof hasProjectNameHistoryTable === 'boolean') {
        return hasProjectNameHistoryTable;
    }

    const res = await query(
        `
            SELECT EXISTS (
                SELECT 1
                FROM information_schema.tables
                WHERE table_schema = 'public'
                  AND table_name = 'project_name_history'
            ) AS exists
        `
    );
    hasProjectNameHistoryTable = Boolean(res.rows && res.rows[0] && res.rows[0].exists);
    return hasProjectNameHistoryTable;
}

function buildOutputPath(projectName) {
    ensureDir(OUTPUT_DIR);
    const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
    return path.join(OUTPUT_DIR, `${sanitizeFileName(projectName)}_构件详情_${stamp}.xlsx`);
}

function parseProjectDetailCommand(text) {
    const content = normalizeText(text);
    if (!content) return null;

    const exactPattern = /^(.+?)的构件详情$/;
    const exactMatch = content.match(exactPattern);
    if (exactMatch) {
        const projectName = normalizeText(exactMatch[1]);
        if (projectName) {
            return { projectName, raw: content };
        }
    }

    if (content.startsWith('项目构件详情')) {
        const match = content.match(/项目名称\s*[:：=]?\s*(.+)$/);
        if (match) {
            const projectName = normalizeText(match[1]);
            if (projectName) {
                return { projectName, raw: content };
            }
        }
    }

    return null;
}

async function resolveProjectName(inputName) {
    const rawName = normalizeText(inputName);
    if (!rawName) {
        return {
            ok: false,
            reason: 'empty',
            candidates: []
        };
    }

    const exactRes = await query(
        `
            SELECT p.project_id, p.project_name
            FROM project p
            WHERE regexp_replace(coalesce(p.project_name, ''), '\\s+', '', 'g')
                  = regexp_replace($1, '\\s+', '', 'g')
            ORDER BY p.project_id DESC
            LIMIT 2
        `,
        [rawName]
    );
    if ((exactRes.rows || []).length === 1) {
        return {
            ok: true,
            projectId: exactRes.rows[0].project_id,
            projectName: exactRes.rows[0].project_name,
            matchedBy: 'exact'
        };
    }

    const historyEnabled = await hasHistoryTable();
    const candidateSql = historyEnabled
        ? `
            WITH candidates AS (
                SELECT
                    p.project_id,
                    p.project_name,
                    p.project_name AS matched_name,
                    CASE
                        WHEN regexp_replace(coalesce(p.project_name, ''), '\\s+', '', 'g')
                             = regexp_replace($1, '\\s+', '', 'g') THEN 1
                        WHEN replace(lower(coalesce(p.project_name, '')), ' ', '')
                             LIKE '%' || replace(lower($1), ' ', '') || '%' THEN 2
                        ELSE 9
                    END AS priority
                FROM project p
                WHERE replace(lower(coalesce(p.project_name, '')), ' ', '')
                      LIKE '%' || replace(lower($1), ' ', '') || '%'

                UNION ALL

                SELECT
                    p.project_id,
                    p.project_name,
                    COALESCE(h.new_name, h.old_name) AS matched_name,
                    CASE
                        WHEN replace(lower(coalesce(h.new_name, h.old_name, '')), ' ', '')
                             = replace(lower($1), ' ', '') THEN 3
                        WHEN replace(lower(coalesce(h.new_name, h.old_name, '')), ' ', '')
                             LIKE '%' || replace(lower($1), ' ', '') || '%' THEN 4
                        ELSE 9
                    END AS priority
                FROM project_name_history h
                JOIN project p ON p.project_id = h.project_id
                WHERE replace(lower(coalesce(h.new_name, h.old_name, '')), ' ', '')
                      LIKE '%' || replace(lower($1), ' ', '') || '%'
            )
            SELECT
                project_id,
                project_name,
                min(priority) AS priority,
                string_agg(DISTINCT matched_name, ' / ') AS matched_names
            FROM candidates
            GROUP BY project_id, project_name
            ORDER BY min(priority) ASC, length(project_name) ASC, project_id DESC
            LIMIT 10
        `
        : `
            SELECT
                p.project_id,
                p.project_name,
                min(
                    CASE
                        WHEN regexp_replace(coalesce(p.project_name, ''), '\\s+', '', 'g')
                             = regexp_replace($1, '\\s+', '', 'g') THEN 1
                        WHEN replace(lower(coalesce(p.project_name, '')), ' ', '')
                             LIKE '%' || replace(lower($1), ' ', '') || '%' THEN 2
                        ELSE 9
                    END
                ) AS priority,
                p.project_name AS matched_names
            FROM project p
            WHERE replace(lower(coalesce(p.project_name, '')), ' ', '')
                  LIKE '%' || replace(lower($1), ' ', '') || '%'
            GROUP BY p.project_id, p.project_name
            ORDER BY priority ASC, length(p.project_name) ASC, p.project_id DESC
            LIMIT 10
        `;
    const candidateRes = await query(candidateSql, [rawName]);

    const candidates = candidateRes.rows || [];
    if (candidates.length === 1) {
        return {
            ok: true,
            projectId: candidates[0].project_id,
            projectName: candidates[0].project_name,
            matchedBy: 'fuzzy',
            matchedNames: candidates[0].matched_names
        };
    }

    return {
        ok: false,
        reason: candidates.length > 1 ? 'ambiguous' : 'not_found',
        candidates
    };
}

async function fetchProjectComponentDetails(projectId) {
    const sql = `
        WITH fitup_qc AS (
            SELECT DISTINCT ON (p.project_name, pp.plan_name, c.component_guid)
                e.component_id,
                e.event_at AS qc_completed_at,
                e.is_completed
            FROM component_status_event e
            JOIN component c ON c.component_id = e.component_id
            JOIN production_plan pp ON pp.plan_id = c.plan_id
            JOIN project p ON p.project_id = pp.project_id
            WHERE e.status_type = 'fitup_weld_qc'
            ORDER BY p.project_name, pp.plan_name, c.component_guid, COALESCE(e.event_at, e.updated_at, e.created_at) DESC NULLS LAST, e.updated_at DESC NULLS LAST, e.event_id DESC
        ),
        fitup_report AS (
            SELECT DISTINCT ON (p.project_name, pp.plan_name, c.component_guid)
                e.component_id,
                e.event_at AS inbound_at,
                e.is_completed,
                NULLIF(trim(e.team_name), '') AS fitup_team,
                NULLIF(trim(COALESCE(e.operator_name, e.trace_operator_name)), '') AS inbound_operator
            FROM component_status_event e
            JOIN component c ON c.component_id = e.component_id
            JOIN production_plan pp ON pp.plan_id = c.plan_id
            JOIN project p ON p.project_id = pp.project_id
            WHERE e.status_type = 'fitup_weld_report'
            ORDER BY p.project_name, pp.plan_name, c.component_guid, COALESCE(e.event_at, e.updated_at, e.created_at) DESC NULLS LAST, e.updated_at DESC NULLS LAST, e.event_id DESC
        ),
        shipping AS (
            SELECT DISTINCT ON (p.project_name, pp.plan_name, c.component_guid)
                e.component_id,
                e.event_at AS outbound_at,
                e.is_completed
            FROM component_status_event e
            JOIN component c ON c.component_id = e.component_id
            JOIN production_plan pp ON pp.plan_id = c.plan_id
            JOIN project p ON p.project_id = pp.project_id
            WHERE e.status_type = 'shipping'
            ORDER BY p.project_name, pp.plan_name, c.component_guid, COALESCE(e.event_at, e.updated_at, e.created_at) DESC NULLS LAST, e.updated_at DESC NULLS LAST, e.event_id DESC
        )
        SELECT
            p.project_name,
            c.location,
            c.component_no,
            c.component_guid,
            c.spec,
            c.length,
            c.quantity,
            c.weight,
            q.qc_completed_at,
            r.fitup_team,
            r.inbound_at,
            r.inbound_operator,
            s.outbound_at,
            CASE
                WHEN s.outbound_at IS NOT NULL THEN 0
                ELSE COALESCE(c.quantity, 0)
            END AS stock_qty
        FROM project p
        JOIN production_plan pp ON pp.project_id = p.project_id
        JOIN component c ON c.plan_id = pp.plan_id
        LEFT JOIN fitup_qc q ON q.component_id = c.component_id AND q.is_completed = TRUE AND q.qc_completed_at IS NOT NULL
        LEFT JOIN fitup_report r ON r.component_id = c.component_id AND r.is_completed = TRUE AND r.inbound_at IS NOT NULL
        LEFT JOIN shipping s ON s.component_id = c.component_id AND s.is_completed = TRUE AND s.outbound_at IS NOT NULL
        WHERE p.project_id = $1
        ORDER BY
            c.component_no NULLS LAST,
            c.component_id;
    `;

    const res = await query(sql, [projectId]);
    return res.rows || [];
}

async function exportProjectComponentWorkbook(projectName, rows) {
    const outputPath = buildOutputPath(projectName);
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('ag-grid');

    sheet.columns = [
        { header: '#', key: 'seq', width: 8 },
        { header: '项目名称', key: 'project_name', width: 28 },
        { header: '区域部位/所在楼层', key: 'location', width: 22 },
        { header: '构件编号', key: 'component_no', width: 20 },
        { header: '规格/型号', key: 'spec', width: 22 },
        { header: '长度', key: 'length', width: 12 },
        { header: '数量', key: 'quantity', width: 10 },
        { header: '重量', key: 'weight', width: 12 },
        { header: '质检完成日期', key: 'qc_completed_at', width: 22 },
        { header: '装焊班组', key: 'fitup_team', width: 22 },
        { header: '入库日期', key: 'inbound_at', width: 22 },
        { header: '入库扫码', key: 'inbound_operator', width: 14 },
        { header: '出库日期', key: 'outbound_at', width: 22 },
        { header: '结存数量', key: 'stock_qty', width: 12 },
        { header: '构件GUID', key: 'component_guid', width: 28 }
    ];

    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.autoFilter = { from: 'A1', to: 'O1' };

    rows.forEach((row, index) => {
        sheet.addRow({
            seq: index + 1,
            ...row,
            length: row.length == null ? null : Number(row.length),
            quantity: row.quantity == null ? null : Number(row.quantity),
            weight: row.weight == null ? null : Number(row.weight),
            stock_qty: row.stock_qty == null ? null : Number(row.stock_qty)
        });
    });

    ['F', 'G', 'H', 'N'].forEach((col) => {
        sheet.getColumn(col).numFmt = '0.000';
    });
    ['I', 'K', 'M'].forEach((col) => {
        sheet.getColumn(col).numFmt = 'yyyy-mm-dd hh:mm:ss';
    });
    sheet.getColumn('G').numFmt = '0';
    sheet.getColumn('N').numFmt = '0';

    await workbook.xlsx.writeFile(outputPath);
    return outputPath;
}

function buildReplyText(projectName, rows, outputPath) {
    const count = rows.length;
    if (count === 0) {
        return `没有在数据库中查到项目“${projectName}”的构件详情。`;
    }
    return [
        `已从数据库生成“${projectName}”的构件详情。`,
        `构件数量：${count}`,
        `结果文件：${outputPath}`
    ].join('\n');
}

async function handleProjectComponentDetailExport(text) {
    const parsed = parseProjectDetailCommand(text);
    if (!parsed) {
        return { handled: false };
    }

    const resolved = await resolveProjectName(parsed.projectName);
    if (!resolved.ok) {
        if (resolved.reason === 'ambiguous') {
            const lines = (resolved.candidates || []).slice(0, 5).map((item, index) =>
                `${index + 1}. ${item.project_name}${item.matched_names ? `（匹配到：${item.matched_names}）` : ''}`
            );
            return {
                handled: true,
                ok: false,
                replyText: `项目简称“${parsed.projectName}”匹配到多个项目，请说得再具体一点：\n${lines.join('\n')}`,
                files: []
            };
        }
        return {
            handled: true,
            ok: false,
            replyText: `没有找到项目“${parsed.projectName}”对应的标准项目名称。`,
            files: []
        };
    }

    const rows = await fetchProjectComponentDetails(resolved.projectId);
    if (rows.length === 0) {
        return {
            handled: true,
            ok: true,
            replyText: `没有在数据库中查到项目“${resolved.projectName}”的构件详情。`,
            files: []
        };
    }

    const outputPath = await exportProjectComponentWorkbook(resolved.projectName, rows);
    return {
        handled: true,
        ok: true,
        replyText: buildReplyText(resolved.projectName, rows, outputPath),
        files: [{
            path: outputPath,
            kind: 'file',
            name: path.basename(outputPath)
        }],
        count: rows.length,
        projectName: resolved.projectName
    };
}

module.exports = {
    parseProjectDetailCommand,
    resolveProjectName,
    fetchProjectComponentDetails,
    exportProjectComponentWorkbook,
    handleProjectComponentDetailExport
};
