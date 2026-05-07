const {
    normalizeDisplay,
    normalizeText,
    stripFitupTeamSuffix,
    uniqueStrings
} = require('./team-directory-normalize');

function buildTeamScope(directory, teamName, resolutionRule) {
    const members = directory.indexes.fitupTeamsByName.get(teamName) || [];
    const fitupWorkshopNames = uniqueStrings(members.map(item => item.fitupWorkshopName));
    const directorNames = uniqueStrings(members.map(item => item.workshopDirectorName));
    const memberNames = uniqueStrings(members.map(item => item.memberName));

    return {
        targetType: 'team',
        canonicalName: teamName,
        resolutionRule,
        fitupTeams: [teamName],
        fitupWorkshopNames,
        directorNames,
        memberNames,
        dbFallbackExactNames: []
    };
}

function buildDirectorScope(directory, directorName, resolutionRule) {
    const record = directory.indexes.directorsByName.get(directorName);
    const fitupWorkshopNames = record ? record.fitupWorkshopNames : [];
    const fallbackExactNames = uniqueStrings([
        directorName,
        ...fitupWorkshopNames.flatMap(name => [
            `${name}（${directorName}）`,
            `${name}(${directorName})`
        ])
    ]);

    return {
        targetType: 'director',
        canonicalName: directorName,
        resolutionRule,
        fitupTeams: record ? record.fitupTeams : [],
        fitupWorkshopNames,
        directorNames: [directorName],
        memberNames: record ? record.memberNames : [],
        dbFallbackExactNames: fallbackExactNames
    };
}

function buildWorkshopScope(directory, workshopName, resolutionRule) {
    const record = directory.indexes.workshopsByName.get(workshopName);
    const directors = record ? record.workshopDirectorNames : [];
    const fallbackExactNames = uniqueStrings([
        ...directors,
        ...directors.flatMap(name => [
            `${workshopName}（${name}）`,
            `${workshopName}(${name})`
        ])
    ]);

    return {
        targetType: 'workshop',
        canonicalName: workshopName,
        resolutionRule,
        fitupTeams: record ? record.fitupTeams : [],
        fitupWorkshopNames: [workshopName],
        directorNames: directors,
        memberNames: record ? record.memberNames : [],
        dbFallbackExactNames: fallbackExactNames
    };
}

function pickIncludedMatch(text, candidates) {
    const display = normalizeDisplay(text);
    if (!display) return null;
    for (const candidate of candidates || []) {
        if (display.includes(candidate)) {
            return candidate;
        }
    }
    return null;
}

function resolveScope({ text, directory, inheritedScope = null } = {}) {
    const displayText = normalizeDisplay(text);
    if (!displayText) return inheritedScope || null;

    const explicitTeam = pickIncludedMatch(displayText, directory.indexes.search.fitupTeamNames);
    if (explicitTeam) {
        return buildTeamScope(directory, explicitTeam, 'explicit-fitup-team');
    }

    const directorMatch = pickIncludedMatch(displayText, directory.indexes.search.directorNames);
    if (directorMatch) {
        return buildDirectorScope(directory, directorMatch, 'workshop-director-name');
    }

    const workshopMatch = pickIncludedMatch(displayText, directory.indexes.search.fitupWorkshopNames);
    if (workshopMatch) {
        return buildWorkshopScope(directory, workshopMatch, 'fitup-workshop-name');
    }

    const memberMatch = pickIncludedMatch(displayText, directory.indexes.search.memberNames);
    if (memberMatch) {
        const person = directory.indexes.peopleByName.get(memberMatch);
        if (person) {
            if (person.workshopDirectorNames.length === 1 && person.workshopDirectorNames[0] === memberMatch) {
                return buildDirectorScope(directory, memberMatch, 'member-name-equals-director');
            }
            if (person.fitupTeams.length === 1) {
                return buildTeamScope(directory, person.fitupTeams[0], 'member-name-unique-fitup-team');
            }
        }
    }

    const normalizedBase = normalizeText(stripFitupTeamSuffix(displayText));
    if (!normalizedBase) return inheritedScope || null;

    const directorCandidates = directory.indexes.directorsByNorm.get(normalizedBase) || [];
    if (directorCandidates.length === 1) {
        return buildDirectorScope(directory, directorCandidates[0], 'normalized-director-name');
    }

    const workshopCandidates = directory.indexes.workshopsByNorm.get(normalizedBase) || [];
    if (workshopCandidates.length === 1) {
        return buildWorkshopScope(directory, workshopCandidates[0], 'normalized-fitup-workshop-name');
    }

    const fitupTeamCandidates = directory.indexes.fitupTeamsByBaseNorm.get(normalizedBase) || [];
    if (fitupTeamCandidates.length === 1 && directorCandidates.length === 0) {
        return buildTeamScope(directory, fitupTeamCandidates[0], 'normalized-unique-fitup-team');
    }

    return inheritedScope || null;
}

module.exports = {
    resolveScope
};
