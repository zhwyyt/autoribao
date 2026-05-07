function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function endOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

function addDays(date, diffDays) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + diffDays, date.getHours(), date.getMinutes(), date.getSeconds(), date.getMilliseconds());
}

function buildMonthDayDate(now, month, day) {
    const current = new Date(now);
    let target = new Date(current.getFullYear(), month - 1, day);
    if (target.getMonth() !== month - 1 || target.getDate() !== day) {
        return null;
    }

    // Near year boundaries, interpret future month/day mentions as the previous year.
    if (target.getTime() - current.getTime() > 31 * 24 * 60 * 60 * 1000) {
        target = new Date(current.getFullYear() - 1, month - 1, day);
        if (target.getMonth() !== month - 1 || target.getDate() !== day) {
            return null;
        }
    }

    return target;
}

function resolveDateRange(text, nowInput = new Date()) {
    const textValue = String(text || '').trim();
    const now = new Date(nowInput);
    if (!textValue) return null;

    const explicitDateMatch = textValue.match(/(\d{4}-\d{2}-\d{2})/);
    if (explicitDateMatch) {
        const [year, month, day] = explicitDateMatch[1].split('-').map(Number);
        const target = new Date(year, month - 1, day);
        return {
            kind: 'date',
            label: explicitDateMatch[1],
            start: startOfDay(target),
            end: endOfDay(target)
        };
    }

    const monthDayMatch = textValue.match(/(?<!\d)(\d{1,2})月(\d{1,2})日(?!\d)/);
    if (monthDayMatch) {
        const month = Number(monthDayMatch[1]);
        const day = Number(monthDayMatch[2]);
        const target = buildMonthDayDate(now, month, day);
        if (target) {
            const label = `${target.getFullYear()}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            return {
                kind: 'date',
                label,
                start: startOfDay(target),
                end: endOfDay(target)
            };
        }
    }

    const shortMonthDayMatch = textValue.match(/(?<!\d)(\d{1,2})[\/\-\.](\d{1,2})(?!\d)/);
    if (shortMonthDayMatch) {
        const month = Number(shortMonthDayMatch[1]);
        const day = Number(shortMonthDayMatch[2]);
        const target = buildMonthDayDate(now, month, day);
        if (target) {
            const label = `${target.getFullYear()}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            return {
                kind: 'date',
                label,
                start: startOfDay(target),
                end: endOfDay(target)
            };
        }
    }

    if (textValue.includes('今天') || textValue.includes('今日')) {
        return {
            kind: 'today',
            label: '今天',
            start: startOfDay(now),
            end: endOfDay(now)
        };
    }

    if (textValue.includes('昨天') || textValue.includes('昨日')) {
        const target = addDays(now, -1);
        return {
            kind: 'yesterday',
            label: '昨天',
            start: startOfDay(target),
            end: endOfDay(target)
        };
    }

    if (textValue.includes('前天')) {
        const target = addDays(now, -2);
        return {
            kind: 'day-before-yesterday',
            label: '前天',
            start: startOfDay(target),
            end: endOfDay(target)
        };
    }

    if (textValue.includes('本周')) {
        const weekday = now.getDay() || 7;
        const start = addDays(startOfDay(now), 1 - weekday);
        return {
            kind: 'this-week',
            label: '本周',
            start,
            end: endOfDay(now)
        };
    }

    if (textValue.includes('本月')) {
        const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
        return {
            kind: 'this-month',
            label: '本月',
            start,
            end: endOfDay(now)
        };
    }

    return null;
}

module.exports = {
    resolveDateRange
};
