function formatWeight(value) {
    const num = Number(value || 0);
    if (!Number.isFinite(num)) return '0.000';
    return num.toFixed(3);
}

function formatInt(value) {
    const num = Number(value || 0);
    if (!Number.isFinite(num)) return '0';
    return String(Math.trunc(num));
}

function formatDateTime(value) {
    if (!value) return '未知';
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) return '未知';
    const yyyy = String(date.getFullYear());
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const hh = String(date.getHours()).padStart(2, '0');
    const mi = String(date.getMinutes()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

function shortTeamList(teams, limit = 6) {
    const list = Array.isArray(teams) ? teams.filter(Boolean) : [];
    if (list.length <= limit) return list.join('、');
    return `${list.slice(0, limit).join('、')} 等 ${list.length} 个班组`;
}

module.exports = {
    formatWeight,
    formatInt,
    formatDateTime,
    shortTeamList
};
