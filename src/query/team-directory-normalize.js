function normalizeDisplay(value) {
    return String(value || '').trim();
}

function normalizeText(value) {
    return normalizeDisplay(value).replace(/\s+/g, '');
}

function stripFitupTeamSuffix(value) {
    const text = normalizeDisplay(value);
    if (text.endsWith('班组')) {
        return text.slice(0, -2);
    }
    return text;
}

function uniqueStrings(values) {
    return Array.from(
        new Set(
            (Array.isArray(values) ? values : [])
                .map(normalizeDisplay)
                .filter(Boolean)
        )
    );
}

module.exports = {
    normalizeDisplay,
    normalizeText,
    stripFitupTeamSuffix,
    uniqueStrings
};
