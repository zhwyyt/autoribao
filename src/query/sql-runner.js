const { Pool } = require('pg');

const dbConfig = require('../../config/default.json').db || {};
const { normalizeText } = require('./team-directory-normalize');

let pool = null;

function getPool() {
    if (!pool) {
        pool = new Pool({
            host: dbConfig.host,
            port: dbConfig.port || 5432,
            user: dbConfig.user,
            password: dbConfig.password || '',
            database: dbConfig.database,
            max: 5,
            application_name: 'qq-query-service'
        });
    }
    return pool;
}

async function query(text, params = []) {
    return getPool().query(text, params);
}

function buildTeamScopeClause(columnName, scope, startingIndex = 1) {
    const normalizedTeams = Array.from(
        new Set((scope.fitupTeams || []).map(item => normalizeText(item)).filter(Boolean))
    );
    const fallbackExactNames = Array.from(
        new Set((scope.dbFallbackExactNames || []).map(item => normalizeText(item)).filter(Boolean))
    ).filter(item => !normalizedTeams.includes(item));

    const clauses = [];
    const params = [];
    let nextIndex = startingIndex;

    if (normalizedTeams.length > 0) {
        clauses.push(`regexp_replace(coalesce(${columnName}, ''), '\\s+', '', 'g') = any($${nextIndex}::text[])`);
        params.push(normalizedTeams);
        nextIndex++;
    }

    if (fallbackExactNames.length > 0) {
        clauses.push(`regexp_replace(coalesce(${columnName}, ''), '\\s+', '', 'g') = any($${nextIndex}::text[])`);
        params.push(fallbackExactNames);
        nextIndex++;
    }

    if (clauses.length === 0) {
        throw new Error('scope 未提供可查询的班组范围');
    }

    return {
        sql: `(${clauses.join(' OR ')})`,
        params,
        nextIndex
    };
}

module.exports = {
    query,
    buildTeamScopeClause
};
