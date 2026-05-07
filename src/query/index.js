const logger = require('../logger');
const { getQueryConfig } = require('./config');
const { loadTeamDirectory } = require('./team-directory-loader');
const { parseNaturalLanguage } = require('./parser-rules');
const { parseWithLlmFallback } = require('./parser-llm');
const { executeQueries } = require('./router');
const { buildFeedbackWorkbookForQueries } = require('./feedback-builder');

async function handleNaturalLanguageQuery(input = {}) {
    const text = String(input.text || '').trim();
    if (!text) {
        return {
            ok: false,
            handled: false,
            replyText: '请先发送要查询的内容。'
        };
    }

    try {
        const now = input.now || new Date();
        const directory = await loadTeamDirectory();
        let parsed = parseNaturalLanguage(text, directory, now);

        const queryConfig = getQueryConfig();
        const shouldTryLlm = !parsed.ok &&
            Boolean(queryConfig.parser && queryConfig.parser.enableLlmFallback);

        if (!parsed.ok && shouldTryLlm) {
            const llmParsed = await parseWithLlmFallback({ text, directory, now });
            if (llmParsed && llmParsed.ok) {
                parsed = llmParsed;
            }
        }

        if (!parsed.ok || !parsed.queries || parsed.queries.length === 0) {
            return {
                ok: false,
                handled: false,
                replyText: '没有识别到可执行的查询意图。可以试试“葛十军下面还有哪些未完成任务”“韩祥玉今天装焊做了多少吨”或“T2-8ZCL-1属于哪个计划”。'
            };
        }

        const results = await executeQueries(parsed.queries, {
            directory,
            now,
            rawText: text,
            senderId: input.senderId || null,
            source: input.source || 'unknown'
        });

        const replyParts = results
            .map(item => item && item.replyText)
            .filter(Boolean);

        const response = {
            ok: true,
            handled: true,
            mode: 'rule-only',
            queries: parsed.queries,
            results,
            files: []
        };

        try {
            const feedbackResult = await buildFeedbackWorkbookForQueries({
                queries: parsed.queries,
                directory,
                now,
                rawText: text,
                senderId: input.senderId || null,
                source: input.source || 'unknown'
            });

            if (feedbackResult && feedbackResult.ok && feedbackResult.outputPath) {
                response.feedback = feedbackResult;
                response.files.push({
                    path: feedbackResult.outputPath,
                    kind: 'file',
                    name: feedbackResult.outputPath
                });
                if (feedbackResult.replyText) {
                    replyParts.push(feedbackResult.replyText);
                }
            } else if (feedbackResult && feedbackResult.replyText) {
                replyParts.push(feedbackResult.replyText);
            }
        } catch (feedbackError) {
            logger.warn(`反馈表生成失败（已忽略文件回传）：${feedbackError.message}`);
            replyParts.push(`反馈表生成失败：${feedbackError.message}`);
        }

        response.replyText = replyParts.join('\n') || '已识别查询，但没有可返回的结果。';
        return response;
    } catch (error) {
        logger.error(`自然语言查询失败: ${error.message}`);
        return {
            ok: false,
            handled: true,
            replyText: `查询失败：${error.message}`
        };
    }
}

module.exports = {
    handleNaturalLanguageQuery
};
