const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const logger = require('../logger');
const { getQueryConfig } = require('./config');
const {
    normalizeDisplay,
    normalizeText,
    stripFitupTeamSuffix,
    uniqueStrings
} = require('./team-directory-normalize');

let cachedDirectory = null;

function ensureParentDir(filePath) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function mapRowsToMembers(rows) {
    return rows
        .map((row, index) => ({
            rowNo: index + 2,
            memberName: normalizeDisplay(row['人']),
            steelStartTeamName: normalizeDisplay(row['钢构生产开始']),
            fitupTeamName: normalizeDisplay(row['装焊报检']),
            ndiTeamName: normalizeDisplay(row['装焊探伤']),
            qcTeamName: normalizeDisplay(row['装焊质检']),
            paintTeamName: normalizeDisplay(row['涂装']),
            workshopOwnerNameRaw: normalizeDisplay(row['车间']),
            fitupWorkshopName: normalizeDisplay(row['装焊车间']),
            workshopDirectorName: normalizeDisplay(row['车间主任'])
        }))
        .filter(item => item.fitupTeamName || item.workshopDirectorName || item.fitupWorkshopName);
}

function toSortedDisplayArray(setLike) {
    return uniqueStrings(Array.from(setLike || []))
        .sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

function buildIndexes(members) {
    const fitupTeamsByName = new Map();
    const fitupTeamsByBaseNorm = new Map();
    const directorsByName = new Map();
    const directorsByNorm = new Map();
    const workshopsByName = new Map();
    const workshopsByNorm = new Map();
    const peopleByName = new Map();

    for (const member of members) {
        const fitupTeamName = member.fitupTeamName;
        const memberName = member.memberName;
        const fitupWorkshopName = member.fitupWorkshopName;
        const workshopDirectorName = member.workshopDirectorName;

        if (fitupTeamName) {
            if (!fitupTeamsByName.has(fitupTeamName)) {
                fitupTeamsByName.set(fitupTeamName, []);
            }
            fitupTeamsByName.get(fitupTeamName).push(member);

            const teamBaseNorm = normalizeText(stripFitupTeamSuffix(fitupTeamName));
            if (teamBaseNorm) {
                if (!fitupTeamsByBaseNorm.has(teamBaseNorm)) {
                    fitupTeamsByBaseNorm.set(teamBaseNorm, new Set());
                }
                fitupTeamsByBaseNorm.get(teamBaseNorm).add(fitupTeamName);
            }
        }

        if (workshopDirectorName) {
            if (!directorsByName.has(workshopDirectorName)) {
                directorsByName.set(workshopDirectorName, {
                    workshopDirectorName,
                    fitupTeams: new Set(),
                    fitupWorkshopNames: new Set(),
                    memberNames: new Set()
                });
            }
            const director = directorsByName.get(workshopDirectorName);
            if (fitupTeamName) director.fitupTeams.add(fitupTeamName);
            if (fitupWorkshopName) director.fitupWorkshopNames.add(fitupWorkshopName);
            if (memberName) director.memberNames.add(memberName);

            const norm = normalizeText(workshopDirectorName);
            if (norm) {
                if (!directorsByNorm.has(norm)) {
                    directorsByNorm.set(norm, new Set());
                }
                directorsByNorm.get(norm).add(workshopDirectorName);
            }
        }

        if (fitupWorkshopName) {
            if (!workshopsByName.has(fitupWorkshopName)) {
                workshopsByName.set(fitupWorkshopName, {
                    fitupWorkshopName,
                    fitupTeams: new Set(),
                    workshopDirectorNames: new Set(),
                    memberNames: new Set()
                });
            }
            const workshop = workshopsByName.get(fitupWorkshopName);
            if (fitupTeamName) workshop.fitupTeams.add(fitupTeamName);
            if (workshopDirectorName) workshop.workshopDirectorNames.add(workshopDirectorName);
            if (memberName) workshop.memberNames.add(memberName);

            const norm = normalizeText(fitupWorkshopName);
            if (norm) {
                if (!workshopsByNorm.has(norm)) {
                    workshopsByNorm.set(norm, new Set());
                }
                workshopsByNorm.get(norm).add(fitupWorkshopName);
            }
        }

        if (memberName) {
            if (!peopleByName.has(memberName)) {
                peopleByName.set(memberName, {
                    memberName,
                    fitupTeams: new Set(),
                    fitupWorkshopNames: new Set(),
                    workshopDirectorNames: new Set()
                });
            }
            const person = peopleByName.get(memberName);
            if (fitupTeamName) person.fitupTeams.add(fitupTeamName);
            if (fitupWorkshopName) person.fitupWorkshopNames.add(fitupWorkshopName);
            if (workshopDirectorName) person.workshopDirectorNames.add(workshopDirectorName);
        }
    }

    const fitupTeamNames = toSortedDisplayArray(fitupTeamsByName.keys());
    const fitupWorkshopNames = toSortedDisplayArray(workshopsByName.keys());
    const directorNames = toSortedDisplayArray(directorsByName.keys());
    const memberNames = toSortedDisplayArray(peopleByName.keys());

    for (const record of directorsByName.values()) {
        record.fitupTeams = toSortedDisplayArray(record.fitupTeams);
        record.fitupWorkshopNames = toSortedDisplayArray(record.fitupWorkshopNames);
        record.memberNames = toSortedDisplayArray(record.memberNames);
    }

    for (const record of workshopsByName.values()) {
        record.fitupTeams = toSortedDisplayArray(record.fitupTeams);
        record.workshopDirectorNames = toSortedDisplayArray(record.workshopDirectorNames);
        record.memberNames = toSortedDisplayArray(record.memberNames);
    }

    for (const record of peopleByName.values()) {
        record.fitupTeams = toSortedDisplayArray(record.fitupTeams);
        record.fitupWorkshopNames = toSortedDisplayArray(record.fitupWorkshopNames);
        record.workshopDirectorNames = toSortedDisplayArray(record.workshopDirectorNames);
    }

    return {
        fitupTeamsByName,
        fitupTeamsByBaseNorm: new Map(
            Array.from(fitupTeamsByBaseNorm.entries()).map(([key, value]) => [key, toSortedDisplayArray(value)])
        ),
        directorsByName,
        directorsByNorm: new Map(
            Array.from(directorsByNorm.entries()).map(([key, value]) => [key, toSortedDisplayArray(value)])
        ),
        workshopsByName,
        workshopsByNorm: new Map(
            Array.from(workshopsByNorm.entries()).map(([key, value]) => [key, toSortedDisplayArray(value)])
        ),
        peopleByName,
        catalogs: {
            fitupTeamNames,
            fitupWorkshopNames,
            directorNames,
            memberNames
        },
        search: {
            fitupTeamNames: [...fitupTeamNames].sort((a, b) => b.length - a.length),
            fitupWorkshopNames: [...fitupWorkshopNames].sort((a, b) => b.length - a.length),
            directorNames: [...directorNames].sort((a, b) => b.length - a.length),
            memberNames: [...memberNames].sort((a, b) => b.length - a.length)
        }
    };
}

async function loadTeamDirectory(options = {}) {
    if (cachedDirectory && !options.forceReload) {
        return cachedDirectory;
    }

    const queryConfig = getQueryConfig();
    const teamDirectoryConfig = queryConfig.teamDirectory || {};
    const excelPath = options.excelPath || teamDirectoryConfig.excelPath;
    const sheetName = options.sheetName || teamDirectoryConfig.sheetName || 'Sheet1';
    const cachePathRel = options.cachePath || teamDirectoryConfig.cachePath || './src/data/team-directory-cache.json';

    if (!excelPath) {
        throw new Error('query-service 未配置 teamDirectory.excelPath');
    }
    if (!fs.existsSync(excelPath)) {
        throw new Error(`班组对应表不存在：${excelPath}`);
    }

    const workbook = XLSX.readFile(excelPath);
    const targetSheetName = workbook.SheetNames.includes(sheetName)
        ? sheetName
        : workbook.SheetNames[0];
    const worksheet = workbook.Sheets[targetSheetName];
    const rows = XLSX.utils.sheet_to_json(worksheet, { defval: '' });
    const members = mapRowsToMembers(rows);
    const indexes = buildIndexes(members);

    const directory = {
        loadedAt: new Date().toISOString(),
        excelPath,
        sheetName: targetSheetName,
        memberCount: members.length,
        members,
        indexes
    };

    const projectRoot = path.join(__dirname, '..', '..');
    const cachePath = path.isAbsolute(cachePathRel)
        ? cachePathRel
        : path.join(projectRoot, cachePathRel);

    try {
        ensureParentDir(cachePath);
        const cachePayload = {
            loadedAt: directory.loadedAt,
            excelPath,
            sheetName: targetSheetName,
            memberCount: members.length,
            members
        };
        fs.writeFileSync(cachePath, JSON.stringify(cachePayload, null, 2), 'utf8');
    } catch (error) {
        logger.warn(`写入班组目录缓存失败（已忽略）：${error.message}`);
    }

    cachedDirectory = directory;
    logger.info(
        `已加载班组目录：sheet=${targetSheetName} 成员=${members.length} 装焊班组=${indexes.catalogs.fitupTeamNames.length} 主任=${indexes.catalogs.directorNames.length}`
    );
    return directory;
}

module.exports = {
    loadTeamDirectory
};
