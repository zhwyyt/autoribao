const fs = require('fs');
const path = require('path');

function readJsonIfExists(filePath) {
    try {
        if (!fs.existsSync(filePath)) return null;
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
        return null;
    }
}

function getQueryConfig() {
    const projectRoot = path.join(__dirname, '..', '..');
    const actualPath = path.join(projectRoot, 'config', 'query-service.json');
    const examplePath = path.join(projectRoot, 'config', 'query-service.example.json');

    const actual = readJsonIfExists(actualPath);
    if (actual) return actual;

    const example = readJsonIfExists(examplePath);
    if (example) return example;

    return {
        mode: 'rule-only',
        teamDirectory: {
            excelPath: '',
            sheetName: 'Sheet1',
            cachePath: './src/data/team-directory-cache.json',
            reloadOnBoot: true
        },
        parser: {
            splitters: ['以及', '并且', '顺便', '，'],
            enableLlmFallback: false
        },
        query: {
            defaultTimezone: 'Asia/Shanghai',
            maxDetailRows: 20,
            maxReplyChars: 1200
        },
        intents: []
    };
}

module.exports = {
    getQueryConfig
};
