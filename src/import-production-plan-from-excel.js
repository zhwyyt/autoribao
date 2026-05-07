/**
 * 从已导出的生产计划 Excel 导入到数据库（无需再跑浏览器抓取）。
 *
 * 用法：
 *   node src/import-production-plan-from-excel.js "I:\\autoweb\\autoribao\\downloads\\production_plan_20260318_1037.xlsx"
 *   npm run import-production-plan -- "I:\\path\\to\\production_plan.xlsx"
 */
const path = require('path');

const ExcelJS = require('exceljs');
const { Pool } = require('pg');

const config = require('../config/default.json');
const logger = require('./logger');

function normalizeHeader(h) {
    return String(h || '').replace(/\s+/g, '').trim();
}

function findHeaderIndex(headers, candidates) {
    const normalized = headers.map(normalizeHeader);
    for (const c of candidates) {
        const want = normalizeHeader(c);
        const idx = normalized.findIndex(h => h === want);
        if (idx >= 0) return idx;
    }
    for (const c of candidates) {
        const want = normalizeHeader(c);
        const idx = normalized.findIndex(h => h.includes(want) || want.includes(h));
        if (idx >= 0) return idx;
    }
    return -1;
}

function mapPlanStatusFromText(text) {
    const t = String(text || '').trim();
    if (!t) return 'producing';
    // 页面约定：只有 “生产中/已完成”
    if (t.includes('已完成') || t === '完成' || t.includes('完成')) return 'completed';
    return 'producing';
}

function excelCellToText(v) {
    if (v === null || v === undefined) return '';
    if (v instanceof Date) return v.toISOString();
    if (typeof v === 'object') {
        // exceljs richText / formula / result
        if (v.text) return String(v.text).trim();
        if (typeof v.result !== 'undefined') return String(v.result).trim();
    }
    return String(v).trim();
}

function excelCellToInt(v) {
    if (v === null || v === undefined || v === '') return 0;
    if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v);
    const s = excelCellToText(v);
    const n = Number(String(s).replace(/[^\d.-]/g, ''));
    return Number.isFinite(n) ? Math.trunc(n) : 0;
}

function excelCellToTimestampText(v) {
    if (v instanceof Date) return v.toISOString();
    return excelCellToText(v);
}

function normalizeProjectName(name) {
    return String(name || '')
        .replace(/[\s\u3000\u200B\uFEFF]+/g, '')
        .trim();
}

async function readPlansFromExcel(filePath) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);

    const sheet = workbook.worksheets[0];
    if (!sheet) throw new Error('Excel 中找不到工作表');

    const headerRow = sheet.getRow(1);
    const headers = [];
    headerRow.eachCell({ includeEmpty: true }, cell => headers.push(excelCellToText(cell.value)));

    const idxId = findHeaderIndex(headers, ['计划ID', 'ID']);
    const idxName = findHeaderIndex(headers, ['生产计划名称', '计划名称', '名称']);
    const idxProjectName = findHeaderIndex(headers, ['所属项目', '项目名称']);
    const idxStartAt = findHeaderIndex(headers, ['计划开始时间', '开始时间']);
    const idxEndAt = findHeaderIndex(headers, ['计划结束时间', '结束时间']);
    const idxUpdatedAt = findHeaderIndex(headers, ['更新时间']);
    const idxComponentCount = findHeaderIndex(headers, ['构件数量', '构件数']);
    const idxStatus = findHeaderIndex(headers, ['生产状态', '计划状态', '状态']);

    if (idxId < 0 || idxName < 0 || idxProjectName < 0) {
        throw new Error(`无法从 Excel 表头定位必需列：计划ID/计划名称/所属项目。表头=${JSON.stringify(headers)}`);
    }

    const plans = [];
    for (let r = 2; r <= sheet.rowCount; r++) {
        const row = sheet.getRow(r);
        // exceljs is 1-based; convert to 0-based indexes
        const getCell = idx => row.getCell(idx + 1).value;

        const planId = excelCellToText(getCell(idxId));
        const planName = excelCellToText(getCell(idxName));
        const projectName = excelCellToText(getCell(idxProjectName));
        if (!planId || !planName || !projectName) continue;

        const startAt = idxStartAt >= 0 ? excelCellToTimestampText(getCell(idxStartAt)) : '';
        const endAt = idxEndAt >= 0 ? excelCellToTimestampText(getCell(idxEndAt)) : '';
        const updatedAt = idxUpdatedAt >= 0 ? excelCellToTimestampText(getCell(idxUpdatedAt)) : '';
        const componentCount = idxComponentCount >= 0 ? excelCellToInt(getCell(idxComponentCount)) : 0;
        const statusText = idxStatus >= 0 ? excelCellToText(getCell(idxStatus)) : '';

        plans.push({
            plan_id: planId,
            plan_name: planName,
            project_name: projectName,
            start_at_raw: startAt,
            end_at_raw: endAt,
            updated_at_raw: updatedAt,
            component_count: componentCount,
            plan_status: mapPlanStatusFromText(statusText)
        });
    }

    return { headers, plans };
}

async function syncPlansToDb(plans) {
    const uniqueById = new Map();
    for (const p of plans) {
        if (!p || !p.plan_id) continue;
        uniqueById.set(String(p.plan_id).trim(), p);
    }
    const uniquePlans = Array.from(uniqueById.values());

    const db = config.db || {};
    if (!db.host || !db.user || !db.database) {
        throw new Error('缺少数据库配置：请在 config/default.json 的 db 节点配置 host/user/database');
    }

    const pool = new Pool({
        host: db.host,
        port: db.port || 5432,
        user: db.user,
        password: db.password || '',
        database: db.database,
        max: 5,
        application_name: 'import-production-plan-from-excel'
    });

    const sqlUpsert = `
        WITH resolved_project AS (
            SELECT project_id
            FROM project
            WHERE regexp_replace(project_name, '[\\s\\u3000\\u200B\\uFEFF]+', '', 'g') = regexp_replace($2, '[\\s\\u3000\\u200B\\uFEFF]+', '', 'g')
            ORDER BY project_id
            LIMIT 1
        ),
        payload AS (
            SELECT
                $1::bigint AS plan_id,
                $3::text AS plan_name,
                NULLIF($4, '')::timestamptz AS start_at,
                NULLIF($5, '')::timestamptz AS end_at,
                NULLIF($6, '')::timestamptz AS updated_at,
                COALESCE($7::integer, 0) AS component_count,
                $8::plan_status AS plan_status
        ),
        upserted AS (
            INSERT INTO production_plan (plan_id, project_id, plan_name, start_at, end_at, updated_at, component_count, plan_status)
            SELECT
                p.plan_id,
                rp.project_id,
                p.plan_name,
                p.start_at,
                p.end_at,
                p.updated_at,
                p.component_count,
                p.plan_status
            FROM resolved_project rp
            JOIN payload p ON true
            ON CONFLICT (plan_id) DO UPDATE
              SET project_id  = EXCLUDED.project_id,
                  plan_name   = EXCLUDED.plan_name,
                  start_at    = EXCLUDED.start_at,
                  end_at      = EXCLUDED.end_at,
                  updated_at  = EXCLUDED.updated_at,
                  component_count = EXCLUDED.component_count,
                  plan_status = EXCLUDED.plan_status
            WHERE (production_plan.updated_at, production_plan.component_count)
                  IS DISTINCT FROM (EXCLUDED.updated_at, EXCLUDED.component_count)
            RETURNING (xmax = 0) AS inserted
        )
        SELECT
            true AS has_project,
            COALESCE((SELECT count(*) FROM upserted), 0)::int AS affected,
            COALESCE((SELECT inserted FROM upserted LIMIT 1), false) AS inserted,
            EXISTS (SELECT 1 FROM production_plan WHERE plan_id = $1) AS existed_before
        FROM resolved_project
    `;

    let inserted = 0;
    let updated = 0;
    let unchanged = 0;
    let skippedNoProject = 0;
    let deleted = 0;

    try {
        const diag = await pool.query(
            `SELECT
                current_database() AS database,
                current_user AS db_user,
                inet_server_addr()::text AS server_addr,
                inet_server_port() AS server_port,
                current_setting('search_path') AS search_path`
        );
        const projectCount = await pool.query('SELECT count(*)::bigint AS c FROM project');
        logger.info(
            `DB连接诊断：` +
            `database=${diag.rows[0] ? diag.rows[0].database : ''} ` +
            `user=${diag.rows[0] ? diag.rows[0].db_user : ''} ` +
            `server=${diag.rows[0] ? `${diag.rows[0].server_addr}:${diag.rows[0].server_port}` : ''} ` +
            `search_path=${diag.rows[0] ? diag.rows[0].search_path : ''} ` +
            `project_count=${projectCount.rows[0] ? projectCount.rows[0].c : ''}`
        );

        const dbProjects = await pool.query('SELECT project_name FROM project');
        const dbNameSet = new Set(dbProjects.rows.map(r => normalizeProjectName(r.project_name)).filter(Boolean));
        const excelNameSet = new Set(plans.map(p => normalizeProjectName(p.project_name)).filter(Boolean));

        let matched = 0;
        const unmatchedSamples = [];
        for (const n of excelNameSet) {
            if (dbNameSet.has(n)) {
                matched++;
            } else if (unmatchedSamples.length < 20) {
                unmatchedSamples.push(n);
            }
        }
        logger.info(
            `项目名匹配诊断：Excel项目数=${excelNameSet.size} DB项目数=${dbNameSet.size} 可匹配项目数=${matched} ` +
            `（以下为Excel未匹配项目名样例，已做去空白归一化）=${unmatchedSamples.join('，')}`
        );

        // 专项诊断：三厂箱型线
        const targetProject = '三厂箱型线';
        const excelTargetPlans = plans.filter(p => normalizeProjectName(p.project_name) === normalizeProjectName(targetProject));
        const excelTargetPlanIds = excelTargetPlans.map(p => p.plan_id);
        const dbTargetProject = await pool.query('SELECT project_id FROM project WHERE regexp_replace(project_name, \'[\\s\\u3000\\u200B\\uFEFF]+\', \'\', \'g\') = regexp_replace($1, \'[\\s\\u3000\\u200B\\uFEFF]+\', \'\', \'g\')', [targetProject]);
        const dbTargetProjectId = dbTargetProject.rows[0] ? dbTargetProject.rows[0].project_id : null;
        const existingTargetPlans = dbTargetProjectId
            ? await pool.query('SELECT plan_id FROM production_plan WHERE project_id = $1 LIMIT 20', [dbTargetProjectId])
            : { rows: [] };
        logger.info(
            `专项诊断（三厂箱型线）：` +
            `Excel计划数=${excelTargetPlans.length} ` +
            `DB项目ID=${dbTargetProjectId || '未找到'} ` +
            `production_plan中已存在的plan_id数=${existingTargetPlans.rows.length} ` +
            `Excel前10个plan_id=${excelTargetPlanIds.slice(0, 10).join(',')} ` +
            `DB已存在plan_id前10个=${existingTargetPlans.rows.slice(0, 10).map(r => r.plan_id).join(',')}`
        );

        await pool.query(`SET app.sync_source = 'import-production-plan-from-excel'`);

        if (uniquePlans.length !== plans.length) {
            logger.info(`生产计划入库按 plan_id 去重：原始 ${plans.length} 条，去重后 ${uniquePlans.length} 条`);
        }

        for (const p of uniquePlans) {
            const res = await pool.query(sqlUpsert, [
                p.plan_id,
                p.project_name,
                p.plan_name,
                p.start_at_raw,
                p.end_at_raw,
                p.updated_at_raw,
                p.component_count,
                p.plan_status
            ]);

            if (res.rowCount === 0) {
                // resolved_project 为空：确实找不到项目
                skippedNoProject++;
                continue;
            }

            const affected = res.rows[0] ? Number(res.rows[0].affected) : 0;
            const isInserted = Boolean(res.rows[0] && res.rows[0].inserted);
            const existedBefore = Boolean(res.rows[0] && res.rows[0].existed_before);
            if (!existedBefore && affected <= 0) {
                // 不存在且未影响：理论上不应走到这里，但防御性归入 unchanged
                unchanged++;
            } else if (!existedBefore && isInserted) {
                inserted++;
            } else if (existedBefore && affected <= 0) {
                unchanged++;
            } else if (existedBefore && !isInserted) {
                updated++;
            } else {
                // 其他情况防御性归入 unchanged
                unchanged++;
            }
        }

        const planIds = uniquePlans.map(p => p.plan_id).filter(Boolean);
        if (planIds.length > 0) {
            const resDel = await pool.query(
                'DELETE FROM production_plan WHERE plan_id NOT IN (SELECT UNNEST($1::bigint[]))',
                [planIds]
            );
            deleted = resDel.rowCount || 0;
        }
    } finally {
        await pool.end();
    }

    return { inserted, updated, unchanged, skippedNoProject, deleted, uniqueCount: uniquePlans.length };
}

async function main() {
    const filePathArg = process.argv.slice(2).join(' ').trim().replace(/^"(.*)"$/, '$1');
    if (!filePathArg) {
        logger.error('缺少 Excel 路径参数。示例：node src/import-production-plan-from-excel.js "I:\\path\\production_plan.xlsx"');
        process.exit(1);
    }

    const filePath = path.resolve(filePathArg);
    logger.info(`从 Excel 导入生产计划: ${filePath}`);

    try {
        const { plans } = await readPlansFromExcel(filePath);
        logger.info(`Excel 解析到生产计划 ${plans.length} 条，开始同步到数据库: ${config.db && config.db.database ? config.db.database : ''}`);

        const stats = await syncPlansToDb(plans);
        logger.success(
            `导入完成：去重后 ${stats.uniqueCount} 条；新增 ${stats.inserted}，更新 ${stats.updated}，` +
            `无变化（推算）${stats.unchanged}，因未找到所属项目而跳过 ${stats.skippedNoProject}，` +
            `因计划ID缺失被删除 ${stats.deleted}`
        );
    } catch (error) {
        logger.error(`执行失败: ${error && error.message ? error.message : String(error)}`);
        if (error && error.stack) logger.error(error.stack);
        process.exitCode = 1;
    }
}

main();

