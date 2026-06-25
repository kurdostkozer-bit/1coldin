# خطة تصليح Chat — KurdBox

> ترتيب المراحل حسب التأثير والاعتماديات. كل مرحلة مستقلة قدر الإمكان.

---

## المرحلة 1 — رسائل خطأ واضحة (Extension)
**الحالة:** ✅ مكتملة

**المشكلة:** عند فشل Chat أو Stream يرجع رد فارغ بدون تفسير.

**الإصلاح:**
- `ApiClient.chat()` — رفض الرد الفارغ وعرض `detail` من السيرفر
- `ApiClient.streamChat()` — عرض `error` من SSE ورسائل HTTP
- `ChatController` — إظهار الخطأ في الواجهة وإيقاف حالة streaming

**الملفات:** `extension/src/api/ApiClient.ts`, `extension/src/chat/ChatController.ts`

---

## المرحلة 2 — إيقاف حقن سياق Workspace التلقائي
**الحالة:** ✅ مكتملة

**المشكلة:** كل رسالة غير تحية تُرفق بشجرة ملفات + محتوى ملف + git diff → رسائل ضخمة وتصنيف خاطئ من Economy.

**الإصلاح:**
- إزالة حقن السياق التلقائي من `ChatController`
- إضافة إعداد `kurdbox.chat.includeWorkspaceContext` (افتراضي: `false`)
- عند التفعيل: إرفاق ملخص مختصر فقط (مسار الملف النشط، بدون شجرة كاملة)

**الملفات:** `extension/src/chat/ChatController.ts`, `extension/package.json`

---

## المرحلة 3 — تخفيف Economy على الـ Backend
**الحالة:** ✅ مكتملة

**المشكلة:** `context_classifier` يحتفظ برسالة واحدة فقط للأسئلة البسيطة ويقطع `max_tokens` إلى 500.

**الإصلاح:**
- رفع `context_messages` للمحادثات العادية (مثلاً 10–20)
- رفع حد `max_tokens` الأدنى لـ SIMPLE (مثلاً 1024)
- عدم تصنيف الرسالة كـ FILE بسبب امتدادات في سياق مُحقون

**الملفات:** `backend/app/economy/context_classifier.py`, `backend/app/economy/economy_middleware.py`

---

## المرحلة 4 — Chat افتراضي، Agent باختيار المستخدم
**الحالة:** ✅ مكتملة

**المشكلة:** `IntelligentRouter` يحوّل أسئلة عادية (اكتب، نفذ، ابحث...) إلى Agent.

**الإصلاح:**
- إعداد `kurdbox.chat.autoAgentRouting` (افتراضي: `false`)
- زر/أمر صريح لتفعيل Agent mode
- عند التعطيل: كل الرسائل تذهب لـ Chat

**الملفات:** `extension/src/chat/IntelligentRouter.ts`, `extension/src/chat/ChatController.ts`, `extension/package.json`

---

## المرحلة 5 — إصلاح واجهة Agent mode
**الحالة:** ✅ مكتملة

**المشكلة:** بعد Agent لا ترجع الواجهة لوضع Chat (`agentModeChange active: false` غير موجود).

**الإصلاح:**
- إرسال `agentModeChange { active: false }` عند بدء Chat وعند انتهاء Agent
- إعادة تفعيل زر الإرسال بعد انتهاء Agent

**الملفات:** `extension/src/chat/ChatController.ts`, `extension/src/agent/AgentController.ts`

---

## المرحلة 6 — تحسين Streaming
**الحالة:** ✅ مكتملة

**المشكلة:** Streaming مفعّل دائماً؛ أخطاء الشبكة لا تُعرض بشكل صحيح.

**الإصلاح:**
- جعل non-stream الافتراضي في الواجهة (أو حسب الإعداد)
- معالجة `streamEnd` عند فشل mid-stream
- timeout مع رسالة واضحة

**الملفات:** `extension/src/ui/assets/shared.js`, `extension/src/api/ApiClient.ts`

---

## المرحلة 7 — مصادقة Chat (اختياري للإنتاج)
**الحالة:** ⏳ لاحقاً

**المشكلة:** الاعتماد على `demo-token` فقط؛ فشل صامت إذا `DEMO_MODE=false`.

**الإصلاح:**
- دعم login/register في الإضافة أو تخزين token يدوياً
- رسالة واضحة عند فشل الحصول على token

**الملفات:** `extension/src/api/ApiClient.ts`, `extension/package.json`

---

## المرحلة 8 — مصدر واحد للحقيقة (معمارية UI)
**الحالة:** ✅ مكتملة

**المشكلة:** رسائل مكررة (send + restoreChatState)، ردود غريبة من سياق قديم، سؤال ثاني بدون رد.

**الإصلاح:**
- Controller يعرض رسالة المستخدم عبر `userMsg` / `setMessages` فقط (بدون `addMsg` في `send()`)
- إزالة `restoreChatState()` التلقائي عند تحميل الصفحة
- `syncUiToWebview()` عند `ready` لمزامنة الذاكرة مع الواجهة
- تحية جديدة = مسح `_history` + `setMessages` (واجهة نظيفة)
- تنظيف رسائل السجل من سياق workspace القديم
- `best-70b` للتحيات بدل `best-8b` (تقليل الهلوسة)
- حماية `sending` لمنع إرسال مزدوج
- **إصلاح إضافي:** إعادة العرض الفوري في `send()` + إغلاق لوحة السجل عند الإرسال (كانت تغطي الشاشة بالكامل)

**الملفات:** `ChatController.ts`, `ChatPanel.ts`, `chatView.html`, `shared.js`, `ModelSelector.ts`, `types.ts`

---

## كيفية التتبع

| المرحلة | الوصف | الحالة |
|---------|--------|--------|
| 1 | رسائل خطأ واضحة | ✅ |
| 2 | إيقاف حقن السياق | ✅ |
| 3 | تخفيف Economy | ✅ |
| 4 | Chat افتراضي | ✅ |
| 5 | واجهة Agent | ✅ |
| 6 | Streaming | ✅ |
| 7 | مصادقة | ⏳ |
| 8 | مصدر واحد للحقيقة | ✅ |
| 9 | إعادة بناء نظيفة (`renderChat`) | ✅ |

---

## المرحلة 9 — إعادة بناء نظيفة
**الحالة:** ✅ مكتملة — Controller يملك `_uiMessages` ويرسل `renderChat` فقط. الواجهة لا تضيف رسائل محلياً.

---

*آخر تحديث: يُحدَّث بعد إكمال كل مرحلة.*
