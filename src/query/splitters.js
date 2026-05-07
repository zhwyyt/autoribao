const { getQueryConfig } = require('./config');

function escapeRegex(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function splitIntoSegments(text) {
    const config = getQueryConfig();
    const splitters = ((config.parser && config.parser.splitters) || ['以及', '并且', '顺便', '，'])
        .filter(Boolean);
    const pattern = splitters.map(escapeRegex).join('|');
    if (!pattern) return [String(text || '').trim()].filter(Boolean);

    const normalized = String(text || '')
        .replace(new RegExp(`(${pattern})`, 'g'), '\n')
        .split('\n')
        .map(item => item.trim())
        .filter(Boolean);

    return normalized.length > 0 ? normalized : [String(text || '').trim()].filter(Boolean);
}

module.exports = {
    splitIntoSegments
};
