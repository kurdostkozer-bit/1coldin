/**
 * IntelligentRouter — decides whether to use Chat or Agent based on request analysis.
 * Automatically routes complex tasks to Agent and simple queries to Chat.
 */

export type RouteMode = 'chat' | 'agent';

export interface RouteDecision {
    mode: RouteMode;
    confidence: number;
    reason: string;
}

/**
 * Analyzes user request to determine if it requires Agent tools or simple Chat.
 * Only routes to Agent when autoAgentRouting is enabled in settings.
 */
export function analyzeRequest(text: string, autoAgentRouting: boolean): RouteDecision {
    if (!autoAgentRouting) {
        return {
            mode: 'chat',
            confidence: 1.0,
            reason: 'Auto agent routing disabled — using chat',
        };
    }

    const lowerText = text.toLowerCase().trim();
    
    // 1. فحص فوري ومبكر جداً للرسايل السريعة والتحيات لمنع سحب الـ Context نهائياً
    const ultraSimplePatterns = [
        /^(سلاو|سڵاو|چۆنی|باشی|مرحبا|سلام|هلا|أهلا|أهلاً|صباح|مساء|شلون|كيفك|شخبار|حباب|ممكن|شكرا|شكراً|thanks|thank you|hello|hi|hey)/i
    ];
    if (ultraSimplePatterns.some(p => p.test(lowerText)) && text.length < 30) {
        return {
            mode: 'chat',
            confidence: 0.95,
            reason: 'Explicit short greeting or simple conversational trigger'
        };
    }

    // 2. مؤشرات الـ Agent (عمليات تحتاج ملفات، تعديل، أو أجهزة أدوات) يدعم العربي والكردي والإنكليزي
    const agentIndicators = [
        // العمليات على الملفات والكود (Create, Write, Edit, Refactor, دروستکردن، تعديل، اصلاح)
        /\b(create|write|edit|modify|delete|remove|add|insert|replace|refactor|optimize|improve)\b/i,
        /(تعديل|اصلاح|اكتب|انشئ|احذف|غير|تغيير|طور|برمج|صمم|ضيف|اضافة|دروستكردن|چاككردن|گۆڕین)/i,
        
        // البحث والتحليل (Search, Find, ابحث، فتش، تحليل)
        /\b(search|find|locate|grep|analyze|review|audit)\b/i,
        /(ابحث|دور|فتش|حلل|راجع|دۆزینەوە|پشکنین)/i,
        
        // الفحص والتصحيح والـ Terminal (Test, Debug, Fix, شغل، نفذ)
        /\b(test|debug|fix|solve|resolve|run|execute|compile|terminal|bash|shell)\b/i,
        /(شغل|نفذ|فحص|تست|ديباج|حل الخطأ|تنفيذ|امر|تەرمیناڵ)/i,
        
        // المكتبات والحزم (Install, Package)
        /\b(install|package|dependency|library|module)\b/i,
        /(ثبت|تنصيب|مكتبة|حزمة|داونلود)/i
    ];
    
    // مؤشرات الـ Chat (أسئلة عامة، استفسارات، نقاش وشرح)
    const chatIndicators = [
        /\b(what|how|why|when|where|who|which|explain|describe|tell me|show me|help|assist)\b/i,
        /(شلون|كيف|ما هو|ماذا|لماذا|متى|أين|من|شرح|اشرحلي|كيفية|ساعدني|شنو|وش|شو|چۆن|چی)/i
    ];
    
    let agentScore = 0;
    for (const pattern of agentIndicators) {
        if (pattern.test(lowerText)) {
            agentScore += 2;
        }
    }
    
    let chatScore = 0;
    for (const pattern of chatIndicators) {
        if (pattern.test(lowerText)) {
            chatScore += 1;
        }
    }
    
    // حجم الرسالة: النصوص الطويلة جداً غالباً فيها كود أو طلبات معقدة
    if (text.length > 250) {
        agentScore += 1;
    }
    
    // وجود كتل كود برمجية واضحة
    if (text.includes('```') || /\b(function|class|import|export|def|return)\b/.test(text)) {
        agentScore += 2;
    }
    
    // الفحص الذكي لمسارات الملفات (وليس مجرد أي نقطة تافهة بنهاية السطر)
    // يبحث عن امتدادات حقيقية (.ts, .py, .json) أو ممرات مجلدات حقيقية (/src, static/)
    const realPathRegex = /(\w+\.(ts|js|json|py|md|html|css|txt|example|env))|([A-Za-z0-9_-]+\/[A-Za-z0-9_-]+)/i;
    if (realPathRegex.test(text)) {
        agentScore += 1.5;
    }
    
    // منطق اتخاذ القرار العادل
    if (agentScore >= chatScore + 2) {
        return {
            mode: 'agent',
            confidence: Math.min(0.95, 0.5 + (agentScore - chatScore) * 0.1),
            reason: 'Request requires automation tools or dynamic workspace access'
        };
    } else if (chatScore >= agentScore + 1) {
        return {
            mode: 'chat',
            confidence: Math.min(0.95, 0.5 + (chatScore - agentScore) * 0.1),
            reason: 'Request identified as an informational query or casual chat'
        };
    } else {
        // الافتراضي هو الـ Chat لضمان عدم إزعاج المستخدم بسحب الملفات على الفاضي
        return {
            mode: 'chat',
            confidence: 0.5,
            reason: 'Ambiguous language pattern - defaulting to stable chat mode'
        };
    }
}
