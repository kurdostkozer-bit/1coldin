/**
 * ModelSelector — smart model auto-selection based on message content.
 * Pure function, no state. Extracted from old chatPanel HTML inline script.
 */

const CODE_KEYWORDS = /\b(fix|debug|error|bug|code|function|class|import|def |var |const |let |return|syntax|traceback|exception|implement|refactor|review)\b/i;
const DEEP_KEYWORDS = /\b(why|analyze|compare|explain|difference|architecture|design|strategy|evaluate|pros|cons|tradeoff|معمارية|تحليل|فرق|لماذا|اشرح|قارن)\b/i;
const SHORT_THRESHOLD = 60;
const LONG_THRESHOLD = 250;

const GREETING = /^(مرحبا|مرحباً|سلام|هلا|أهلا|أهلاً|hello|hi|hey|سلاو|سڵاو|چۆنی|باشی|صباح|مساء)[\s!.,؟?]*$/iu;

export function selectModel(text: string, manualOverride?: string): string {
    if (manualOverride) {
        return manualOverride;
    }
    const t = text.trim();
    const len = t.length;

    if (GREETING.test(t)) {
        return 'best-70b';
    }
    if (CODE_KEYWORDS.test(t)) {
        return 'best-coder';
    }
    if (DEEP_KEYWORDS.test(t) || len > LONG_THRESHOLD) {
        return 'best-70b';
    }
    if (len < SHORT_THRESHOLD) {
        return 'best-8b';
    }
    return 'best-70b';
}
