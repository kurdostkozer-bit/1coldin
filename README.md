# KurdBox AI Gateway 🚀

منصة بوابة AI موحدة توفر الوصول إلى مزودي LLM متعددين مع VSCode extension متكامل.

## 🚀 التشغيل السريع

### الطريقة 1: الأوامر الموحدة (موصى به)

```bash
# تشغيل كل شيء بضغطة واحدة
npm start

# إيقاف كل شيء
npm stop

# وضع التطوير (backend + extension مع auto-reload)
npm run dev
```

### الطريقة 2: باستخدام ملفات الباتش

```bash
# تشغيل كل الخدمات
start-all.bat

# إيقاف كل الخدمات
stop-all.bat
```

### الطريقة 3: يدوياً

```bash
# تشغيل الخادم الخلفي
cd backend
.\start_dev.ps1

# في نافذة أخرى - تشغيل وضع التطوير للـ extension
cd extension
npm run dev
```

## 📦 الهيكل

```
KurdBox/
├── backend/           # FastAPI الخادم الخلفي
├── extension/         # VSCode Extension
├── electron/          # تطبيق سطح المكتب (قادم)
├── start-all.ps1      # سكريبت تشغيل موحد
├── stop-all.ps1       # سكريبت إيقاف موحد
└── package.json       # أوامر npm موحدة
```

## 🔧 الأوامر المتاحة

### أوامر npm الموحدة

```bash
npm start              # تشغيل كل الخدمات (مع قائمة اختيارات)
npm stop               # إيقاف كل الخدمات
npm run dev            # وضع التطوير (backend + extension معاً)
npm run backend:start  # تشغيل الخادم الخلفي فقط
npm run backend:stop   # إيقاف الخادم الخلفي
npm run extension:dev  # تشغيل وضع التطوير للـ extension
npm run extension:build    # بناء الـ extension
npm run extension:install   # تثبيت الـ extension
npm run extension:reload   # إعادة تحميل الـ extension
npm run install:all    # تثبيت كل المتطلبات
```

### أوامر الـ backend

```bash
cd backend
.\start_dev.ps1       # تشغيل وضع التطوير
.\start.ps1           # تشغيل وضع الإنتاج
python -m uvicorn app.main:app --host 127.0.0.1 --port 5001 --reload
```

### أوامر الـ extension

```bash
cd extension
npm run dev           # وضع التطوير مع auto-reload
npm run compile       # تجميع TypeScript
npm run package       # بناء ملف VSIX
npm run quick-reload  # إعادة تحميل سريعة
```

## 🎯 المميزات

### 🔍 الكشف التلقائي عن السيرفر
- الـ extension يكتشف السيرفر تلقائياً على المنافذ الشائعة
- لا حاجة لتكوين يدوي للعنوان

### 🔄 التحديث التلقائي
- يتحقق من التحديثات تلقائياً كل 24 ساعة
- إشعارات عند توفر إصدارات جديدة

### ⚡ Auto-Reload للتطوير
- يراقب التغييرات ويعيد التثبيت تلقائياً
- مثالي للتطوير السريع

### 🤖 Agent Mode
- وكيل AI مستقل مع أدوات متعددة
- قدرات برمجية وتحليلية متقدمة

### 💬 Chat Panel
- محادثة تفاعلية مع تيار متدفق
- دعم مزودين متعددين

## 🌐 المنافذ

- **Backend**: `http://127.0.0.1:5001`
- **API Docs**: `http://127.0.0.1:5001/docs`
- **Health Check**: `http://127.0.0.1:5001/api/v1/health`

## ⌨️ اختصارات VSCode

- `Ctrl+Shift+K` - فتح Chat Panel
- `Ctrl+Shift+A` - فتح Agent Panel
- `Ctrl+Shift+D` - Debug Error

## 🔐 الأمان

- تشفير Fernet AES-128 لمفاتيح API
- JWT tokens مع انتهاء صلاحية 8 ساعات
- .env file protection

## 📚 المزيد من المعلومات

- [دليل النشر](./DEPLOYMENT_GUIDE.md)
- [تقرير البنية](./ARCHITECTURE_REPORT.md)
- [مرجع API](./API_REFERENCE.md)
- [Extension README](./extension/README.md)

## 🤝 المساهمة

المساهمات مرحب بها! يرجى فتح Issue أو Pull Request.

## 📄 الترخيص

MIT License
