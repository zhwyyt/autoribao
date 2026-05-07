const { splitIntoSegments } = require('./splitters');
const { resolveScope } = require('./scope-resolver');
const { resolveDateRange } = require('./date-range');
const { normalizeDisplay } = require('./team-directory-normalize');

function detectIntent(text, scope, componentSelector) {
    const content = normalizeDisplay(text);
    if (!content) return null;

    if (
        componentSelector &&
        /(属于哪个计划|属于什么计划|是哪个计划|哪个计划|什么计划|计划名称)/.test(content) &&
        !/(未发货|没发货|未出库|没出库)/.test(content)
    ) {
        return 'component_plan_lookup';
    }

    if (/对应哪个装焊车间|属于哪个主任|哪些班组|什么班组|对应什么组织|哪个主任/.test(content)) {
        return 'org_lookup';
    }

    if (/(未发货|没发货|未出库|没出库)/.test(content)) {
        return 'plan_unshipped_components';
    }

    if (/(未完成|没做完|没完成|还有哪些任务|还有哪些未完成)/.test(content)) {
        return scope && scope.targetType === 'team'
            ? 'team_unfinished_tasks'
            : 'director_unfinished_tasks';
    }

    if (/(产量|多少吨|多少件|完成多少|做了多少|完成的产量|装焊完成)/.test(content)) {
        return scope && scope.targetType === 'team'
            ? 'team_daily_fitup_output'
            : 'director_daily_fitup_output';
    }

    if (componentSelector) {
        return 'component_plan_lookup';
    }

    return null;
}

function buildGenericFitupQueries(rawText, scope, dateRange, planSelector) {
    const content = normalizeDisplay(rawText);
    if (!content || !scope || !/装焊查询/.test(content)) {
        return [];
    }

    const intent = scope.targetType === 'team'
        ? 'team_unfinished_tasks'
        : 'director_unfinished_tasks';

    return [{
        intent,
        rawText: content,
        scope,
        dateRange,
        planSelector
    }];
}

function extractPlanSelector(text) {
    const content = normalizeDisplay(text);
    if (!content) return null;

    const idMatch = content.match(/计划(?:ID|Id|id)?\s*[:：]?\s*(\d+)/);
    if (idMatch) {
        return {
            planId: Number(idMatch[1]),
            raw: idMatch[0]
        };
    }

    if (!content.includes('计划')) {
        return null;
    }

    if (!/(未发货|没发货|未出库|没出库)/.test(content)) {
        return null;
    }

    let planNameLike = content
        .replace(/查(一下|下)?/g, '')
        .replace(/还有哪些构件/g, '')
        .replace(/还有哪些/g, '')
        .replace(/构件/g, '')
        .replace(/未发货|没发货|未出库|没出库/g, '')
        .replace(/那个计划|这个计划|该计划/g, '')
        .replace(/计划/g, '')
        .replace(/[？?]/g, '')
        .trim();

    if (!planNameLike || ['哪些', '什么', '构件', '还有哪些'].includes(planNameLike)) {
        return null;
    }
    return {
        planNameLike,
        raw: planNameLike
    };
}

function cleanComponentNo(value) {
    return String(value || '')
        .trim()
        .replace(/^[：:]/, '')
        .replace(/[？?。！!，,；;]$/g, '')
        .trim();
}

function extractComponentSelector(text) {
    const content = normalizeDisplay(text);
    if (!content) return null;

    let componentNo = null;

    const explicitMatch = content.match(/(?:构件编号|构件号|编号)\s*[:：]?\s*([A-Za-z0-9][A-Za-z0-9_-]*)/i);
    if (explicitMatch) {
        componentNo = explicitMatch[1];
    }

    if (!componentNo && /(属于哪个计划|属于什么计划|哪个计划|什么计划|计划名称)/.test(content)) {
        const leadingMatch = content.match(/^([A-Za-z0-9][A-Za-z0-9_-]*)\s*(?:属于哪个计划|属于什么计划|是哪个计划|哪个计划|什么计划|计划名称)/i);
        const trailingMatch = content.match(/(?:属于哪个计划|属于什么计划|是哪个计划|哪个计划|什么计划|计划名称)\s*([A-Za-z0-9][A-Za-z0-9_-]*)$/i);
        componentNo = (leadingMatch && leadingMatch[1]) || (trailingMatch && trailingMatch[1]) || null;
    }

    if (!componentNo) {
        const tokenMatch = content.match(/(^|[^A-Za-z0-9_-])([A-Za-z][A-Za-z0-9_]*-[A-Za-z0-9_]+(?:-[A-Za-z0-9_]+)+)(?=$|[^A-Za-z0-9_-])/);
        if (tokenMatch) {
            componentNo = tokenMatch[2];
        }
    }

    componentNo = cleanComponentNo(componentNo);
    if (!componentNo) {
        return null;
    }

    return {
        componentNo,
        raw: componentNo
    };
}

function parseSegment(segment, directory, now, inheritedContext = {}) {
    const rawText = normalizeDisplay(segment);
    if (!rawText) return [];

    const componentSelector = extractComponentSelector(rawText) || inheritedContext.componentSelector || null;
    const scope = resolveScope({
        text: rawText,
        directory,
        inheritedScope: inheritedContext.scope || null
    });
    const dateRange = componentSelector
        ? null
        : (resolveDateRange(rawText, now) || inheritedContext.dateRange || null);
    const planSelector = extractPlanSelector(rawText) || inheritedContext.planSelector || null;
    const intent = detectIntent(rawText, scope, componentSelector);

    if (intent) {
        return [{
            intent,
            rawText,
            scope,
            dateRange,
            planSelector,
            componentSelector
        }];
    }

    return buildGenericFitupQueries(rawText, scope, dateRange, planSelector);
}

function parseNaturalLanguage(text, directory, now = new Date()) {
    const normalizedText = normalizeDisplay(text);
    if (!normalizedText) {
        return {
            ok: false,
            queries: []
        };
    }

    const segments = splitIntoSegments(normalizedText);
    const sharedScope = resolveScope({ text: normalizedText, directory, inheritedScope: null });
    const sharedDateRange = resolveDateRange(normalizedText, now);
    const sharedPlanSelector = extractPlanSelector(normalizedText);
    const sharedComponentSelector = extractComponentSelector(normalizedText);

    const queries = [];
    let lastScope = sharedScope;
    let lastDateRange = sharedDateRange;

    for (const segment of segments) {
        const parsedList = parseSegment(segment, directory, now, {
            scope: lastScope,
            dateRange: lastDateRange,
            planSelector: sharedPlanSelector,
            componentSelector: sharedComponentSelector
        });
        for (const parsed of parsedList) {
            if (!parsed) continue;
            queries.push(parsed);
            if (parsed.scope) lastScope = parsed.scope;
            if (parsed.dateRange) lastDateRange = parsed.dateRange;
        }
    }

    if (queries.length === 0) {
        const fallbackList = parseSegment(normalizedText, directory, now, {
            scope: sharedScope,
            dateRange: sharedDateRange,
            planSelector: sharedPlanSelector,
            componentSelector: sharedComponentSelector
        });
        for (const fallback of fallbackList) {
            if (fallback) queries.push(fallback);
        }
    }

    return {
        ok: queries.length > 0,
        queries,
        sharedScope,
        sharedDateRange,
        sharedPlanSelector,
        sharedComponentSelector
    };
}

module.exports = {
    parseNaturalLanguage
};
