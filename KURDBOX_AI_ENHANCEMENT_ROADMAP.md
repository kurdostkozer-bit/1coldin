# KurdBox AI - خارطة طريق التحسين لتصبح مثل Cascade و Cursor

## 📊 الوضع الحالي

### القدرات المتوفرة
- ✅ قراءة/كتابة/إنشاء/حذف الملفات (مع موافقة المستخدم)
- ✅ عرض هيكل المجلدات (file tree)
- ✅ تنفيذ أوامر التيرمينال
- ✅ عرض git diff
- ✅ Agent Mode مع أدوات محدودة
- ✅ Inline Completions

### النواقص الحرجة
- ❌ عمق محدود (3 مستويات فقط)
- ❌ عدد ملفات محدود (200 ملف فقط)
- ❌ لا يوجد بحث متقدم في الكود
- ❌ لا يوجد تحليل كود (AST, dependencies)
- ❌ لا يوجد استبدال ذكي (multi-edit)
- ❌ لا يوجد طلبات شبكة (HTTP requests)
- ❌ لا يجمع context تلقائياً في وضع Chat

---

## 🎯 الهدف النهائي

جعل KurdBox AI تمتلك نفس قدرات:
- **Cascade**: أدوات مباشرة للقراءة/الكتابة، بحث متقدم، تشغيل أوامر
- **Cursor**: فهم عميق للمشروع، تحليل كود، اقتراحات ذكية

---

## 🗺️ خارطة الطريق المرحلية

### المرحلة 1: تحسين الوصول للمشروع (الأولوية القصوى) ✅ مكتملة

#### 1.1 رفع الحدود الحالية
**المشكلة**: حدود صغيرة جداً تمنع فهم المشاريع الكبيرة

**الحلول**:
```typescript
// WorkspaceContext.ts
const MAX_DEPTH = 6;           // من 3 إلى 6
const MAX_ENTRIES = 1000;      // من 200 إلى 1000
const MAX_ACTIVE_FILE_BYTES = 512000;  // من 100KB إلى 500KB
const MAX_GIT_DIFF_CHARS = 50000;      // من 10KB إلى 50KB
```

**الأثر**: يمكن فهم مشاريع أكبر بشكل أفضل

#### 1.2 دعم مساحات عمل متعددة
**المشكلة**: يدعم workspace واحد فقط

**الحل**:
```typescript
// جمع context من جميع workspaces المفتوحة
const allWorkspaces = vscode.workspace.workspaceFolders.map(folder => ({
    root: folder.uri.fsPath,
    fileTree: await buildFileTree(folder.uri),
    // ... context لكل workspace
}));
```

**الأثر**: دعم monorepos ومشاريع متعددة

#### 1.3 جمع context تلقائي في وضع Chat
**المشكلة**: لا يجمع context تلقائياً إلا في Agent Mode

**الحل**:
```typescript
// ChatController.ts
async function sendMessage(message: string) {
    // جمع context تلقائي
    const context = await collectWorkspaceContext();
    const enrichedMessage = `
## Workspace Context
${context.fileTree}

## Active File
${context.activeFileContent}

## User Message
${message}
`;
    // إرسال للخادم
}
```

**الأثر**: Chat Mode يفهم المشروع تلقائياً

---

### المرحلة 2: إضافة أدوات البحث والتحليل ✅ مكتملة

#### 2.1 أداة البحث المتقدم (Grep)
**المشكلة**: لا يوجد بحث في الكود

**الحل**: إضافة tool جديد
```typescript
// tools/searchTool.ts
export async function executeSearch(
    args: { query: string; pattern?: string; caseSensitive?: boolean }
): Promise<ToolResult> {
    const results = await vscode.workspace.findText(
        new vscode.RelativePattern(args.pattern || '**', args.query),
        { include: '*.ts', '*.js', '*.py', '*.go' }
    );
    return {
        tool_call_id: callId,
        content: JSON.stringify(results.map(r => ({
            file: r.uri.fsPath,
            line: r.range.start.line,
            text: r.match
        })))
    };
}
```

**الأثر**: يمكن البحث عن أنماط في الكود

#### 2.2 أداة تحليل الاعتماديات
**المشكلة**: لا يفهم dependencies بين الملفات

**الحل**:
```typescript
// tools/dependencyTool.ts
export async function analyzeDependencies(filePath: string) {
    // تحليل imports/requires
    const content = await readFile(filePath);
    const imports = extractImports(content);
    const dependencies = await Promise.all(
        imports.map(imp => resolveImport(imp, filePath))
    );
    return { file: filePath, dependencies };
}
```

**الأثر**: فهم علاقات الملفات

#### 2.3 أداة تحليل AST
**المشكلة**: لا يفهم بنية الكود

**الحل**:
```typescript
// استخدام مكتبات مثل:
// - TypeScript Compiler API لـ TS/JS
// - ast-lib لـ Python
// - go/parser لـ Go
export async function analyzeAST(filePath: string) {
    const ast = parseAST(filePath);
    const functions = extractFunctions(ast);
    const classes = extractClasses(ast);
    return { functions, classes, structure };
}
```

**الأثر**: فهم عميق لبنية الكود

---

### المرحلة 3: أدوات التعديل المتقدمة ✅ مكتملة

#### 3.1 Multi-Edit Tool
**المشكلة**: يمكن تعديل ملف واحد فقط في كل مرة

**الحل**:
```typescript
// tools/multiEditTool.ts
export async function executeMultiEdit(
    args: { edits: Array<{ path: string; old: string; new: string }> }
): Promise<ToolResult> {
    const results = [];
    for (const edit of args.edits) {
        const uri = resolveSecurePath(edit.path, root);
        const content = await vscode.workspace.fs.readFile(uri);
        const updated = content.toString().replace(edit.old, edit.new);
        await vscode.workspace.fs.writeFile(uri, Buffer.from(updated));
        results.push({ path: edit.path, success: true });
    }
    return { content: JSON.stringify(results) };
}
```

**الأثر**: تعديل عدة ملفات في عملية واحدة

#### 3.2 Find and Replace Tool
**المشكلة**: لا يوجد استبدال ذكي

**الحل**:
```typescript
export async function executeFindReplace(
    args: { 
        query: string; 
        replacement: string; 
        files: string[];
        regex?: boolean;
        caseSensitive?: boolean;
    }
): Promise<ToolResult> {
    const edit = new vscode.WorkspaceEdit();
    for (const file of args.files) {
        const uri = vscode.Uri.file(file);
        const document = await vscode.workspace.openTextDocument(uri);
        const text = document.getText();
        const regex = new RegExp(args.query, args.regex ? 'g' : '');
        const matches = text.matchAll(regex);
        for (const match of matches) {
            const range = document.getWordRangeAtPosition(
                document.positionAt(match.index),
                new RegExp(args.query)
            );
            if (range) {
                edit.replace(uri, range, args.replacement);
            }
        }
    }
    await vscode.workspace.applyEdit(edit);
}
```

**الأثر**: استبدال ذكي عبر ملفات متعددة

---

### المرحلة 4: أدوات الشبكة والبيانات ✅ مكتملة

#### 4.1 HTTP Request Tool
**المشكلة**: لا يمكن إجراء طلبات خارجية

**الحل**:
```typescript
// tools/httpTool.ts
export async function executeHttpRequest(
    args: { 
        url: string; 
        method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
        headers?: Record<string, string>;
        body?: string;
    }
): Promise<ToolResult> {
    const response = await fetch(args.url, {
        method: args.method || 'GET',
        headers: args.headers,
        body: args.body
    });
    const data = await response.text();
    return {
        content: JSON.stringify({
            status: response.status,
            headers: Object.fromEntries(response.headers),
            body: data
        })
    };
}
```

**الأثر**: يمكن الوصول لـ APIs خارجية

#### 4.2 Database Query Tool
**المشكلة**: لا يوجد دعم قواعد بيانات

**الحل**:
```typescript
// tools/databaseTool.ts
export async function executeDatabaseQuery(
    args: { 
        type: 'sqlite' | 'mysql' | 'postgres';
        connectionString: string;
        query: string;
    }
): Promise<ToolResult> {
    // استخدام مكتبات مناسبة لكل نوع
    // - better-sqlite3 لـ SQLite
    // - mysql2 لـ MySQL
    // - pg لـ PostgreSQL
    const results = await executeQuery(args.type, args.connectionString, args.query);
    return { content: JSON.stringify(results) };
}
```

**الأثر**: يمكن العمل مع قواعد البيانات

---

### المرحلة 5: أدوات الاختبار والجودة ✅ مكتملة

#### 5.1 Test Runner Tool
**المشكلة**: لا يوجد تشغيل اختبارات تلقائي

**الحل**:
```typescript
// tools/testTool.ts
export async function executeTests(
    args: { 
        framework: 'jest' | 'pytest' | 'go test';
        path?: string;
        pattern?: string;
    }
): Promise<ToolResult> {
    const command = buildTestCommand(args);
    const result = await executeRunCommand({ 
        command, 
        cwd: workspaceRoot 
    });
    return { content: result.content };
}
```

**الأثر**: تشغيل الاختبارات وتحليل النتائج

#### 5.2 Linting Tool
**المشكلة**: لا يوجد فحص جودة الكود

**الحل**:
```typescript
export async function executeLint(
    args: { 
        tool: 'eslint' | 'pylint' | 'golint';
        path?: string;
    }
): Promise<ToolResult> {
    const command = `${args.tool} ${args.path || '.'}`;
    const result = await executeRunCommand({ command });
    return { content: result.content };
}
```

**الأثر**: فحص جودة الكود تلقائياً

---

### المرحلة 6: تحسين الذكاء الاصطناعي ✅ مكتملة

#### 6.1 تحسين System Prompt
**المشكلة**: الـ prompt الحالي بسيط جداً

**الحل**:
```typescript
private _buildSystemPrompt(ctx: WorkspaceContextData, tools: ToolDefinition[]): string {
    return `You are an expert AI coding assistant with deep understanding of software development.

## Your Capabilities
- Read and analyze code across the entire workspace
- Understand project structure and dependencies
- Make intelligent code suggestions
- Debug complex issues
- Refactor and optimize code
- Write tests and documentation

## Workspace Analysis
${this._analyzeProjectStructure(ctx)}

## Best Practices
- Follow the project's existing code style
- Use appropriate design patterns
- Write clean, maintainable code
- Add necessary error handling
- Consider performance implications

## Available Tools
${JSON.stringify(tools, null, 2)}

## Rules
- Always understand the full context before making changes
- Explain your reasoning clearly
- Ask for clarification when needed
- Test your changes when possible`;
}
```

**الأثر**: استجابات أكثر ذكاءً ودقة

#### 6.2 إضافة Memory System
**المشكلة**: لا يتذكر القرارات السابقة

**الحل**:
```typescript
// memory/MemorySystem.ts
export class MemorySystem {
    private memories: Map<string, any> = new Map();
    
    save(key: string, value: any) {
        this.memories.set(key, value);
        // حفظ في VSCode storage
    }
    
    recall(key: string): any {
        return this.memories.get(key);
    }
    
    // تذكر قرارات التصميم
    saveDesignDecision(decision: DesignDecision) {
        this.save(`design:${decision.id}`, decision);
    }
}
```

**الأثر**: تذكر القرارات والتفضيلات

---

### المرحلة 7: تحسين واجهة المستخدم ✅ مكتملة

#### 7.1 عرض Context بصري
**المشكلة**: Context يعرض كنص فقط

**الحل**:
```typescript
// عرض tree view تفاعلي
// عرض dependencies graph
// عرض code map
```

**الأثر**: فهم بصري أفضل للمشروع

#### 7.2 اقتراحات Context-Aware
**المشكلة**: الاقتراحات عامة جداً

**الحل**:
```typescript
// اقتراحات بناءً على:
// - الملف الحالي
// - الملفات المفتوحة
// - تاريخ التعديلات
// - أنماط الكود في المشروع
```

**الأثر**: اقتراحات أكثر دقة

---

## 📅 الجدول الزمني المقترح

### الشهر 1-2: المرحلة 1 (الأساسيات) ✅ مكتملة
- رفع الحدود الحالية ✅
- دعم multi-workspace ✅
- جمع context تلقائي ✅

### الشهر 3-4: المرحلة 2 (البحث والتحليل) ✅ مكتملة
- إضافة grep tool ✅
- تحليل dependencies ✅
- تحليل AST أساسي ✅

### الشهر 5-6: المرحلة 3 (التعديل المتقدم) ✅ مكتملة
- multi-edit tool
- find-replace tool
- تحسين system prompt

### الشهر 7-8: المرحلة 4 (الشبكة والبيانات) ✅ مكتملة
- HTTP requests
- دعم قواعد بيانات أساسي

### الشهر 9-10: المرحلة 5 (الاختبار والجودة) ✅ مكتملة
- test runner
- linting tools

### الشهر 11-12: المرحلة 6-7 (الذكاء والواجهة) ✅ مكتملة
- memory system
- تحسينات UI
- اقتراحات context-aware

---

## 🔧 المتطلبات التقنية

### Backend
- تحسين API لدعم المزيد من الأدوات
- إضافة endpoints للبحث والتحليل
- تحسين performance للطلبات الكبيرة

### Extension
- إضافة tools جديدة
- تحسين context collection
- تحسين UI/UX

### Dependencies

#### المكتبات المطلوبة حسب المرحلة

##### المرحلة 1: تحسين الوصول للمشروع
**لا تحتاج مكتبات إضافية** - تعديلات على الكود الموجود فقط

##### المرحلة 2: أدوات البحث والتحليل
```json
{
  "devDependencies": {
    "@typescript-eslint/parser": "^8.0.0",
    "@typescript-eslint/typescript-estree": "^8.0.0",
    "ast-types": "^0.16.0",
    "recast": "^0.23.0",
    "typescript": "^5.5.0"
  }
}
```
- **@typescript-eslint/parser**: تحليل TypeScript/JavaScript
- **@typescript-eslint/typescript-estree**: تحويل الكود لـ AST
- **ast-types**: التعامل مع AST nodes
- **recast**: تحويل وإعادة كتابة AST
- **typescript**: Compiler API لتحليل TS

##### المرحلة 3: أدوات التعديل المتقدمة ✅ مكتملة
```json
{
  "devDependencies": {
    "diff": "^5.2.0",
    "fast-diff": "^1.3.0"
  }
}
```
- **diff**: حساب الفروقات بين النصوص
- **fast-diff**: خوارزمية سريعة للمقارنة

##### المرحلة 4: أدوات الشبكة والبيانات ✅ مكتملة
```json
{
  "dependencies": {
    "node-fetch": "^3.3.2",
    "better-sqlite3": "^9.4.0",
    "mysql2": "^3.9.0",
    "pg": "^8.11.0"
  }
}
```
- **node-fetch**: HTTP requests
- **better-sqlite3**: SQLite database
- **mysql2**: MySQL database
- **pg**: PostgreSQL database

##### المرحلة 5: أدوات الاختبار والجودة ✅ مكتملة
```json
{
  "devDependencies": {
    "jest": "^29.7.0",
    "@types/jest": "^29.5.0"
  }
}
```
- **jest**: إطار عمل للاختبارات
- **@types/jest**: TypeScript types لـ Jest

##### المرحلة 6: تحسين الذكاء الاصطناعي ✅ مكتملة
```json
{
  "dependencies": {
    "uuid": "^9.0.1",
    "lowdb": "^7.0.1"
  }
}
```
- **uuid**: توليد معرفات فريدة
- **lowdb**: قاعدة بيانات محلية بسيطة للـ memory

##### المرحلة 7: تحسين واجهة المستخدم ✅ مكتملة
```json
{
  "dependencies": {
    "d3": "^7.9.0",
    "vis-network": "^9.1.6"
  }
}
```
- **d3**: رسوم بيانية وتصورات
- **vis-network**: عرض graphs للـ dependencies

#### قائمة المكتبات الكاملة (package.json)
```json
{
  "name": "kurdbox",
  "version": "3.0.0",
  "dependencies": {
    "node-fetch": "^3.3.2",
    "better-sqlite3": "^9.4.0",
    "mysql2": "^3.9.0",
    "pg": "^8.11.0",
    "uuid": "^9.0.1",
    "lowdb": "^7.0.1",
    "d3": "^7.9.0",
    "vis-network": "^9.1.6"
  },
  "devDependencies": {
    "@typescript-eslint/parser": "^8.0.0",
    "@typescript-eslint/typescript-estree": "^8.0.0",
    "ast-types": "^0.16.0",
    "recast": "^0.23.0",
    "typescript": "^5.5.0",
    "diff": "^5.2.0",
    "fast-diff": "^1.3.0",
    "jest": "^29.7.0",
    "@types/jest": "^29.5.0",
    "@types/node": "^20.0.0",
    "@types/vscode": "^1.85.0",
    "@vscode/vsce": "^3.0.0",
    "mocha": "^11.7.0",
    "ts-node": "^10.9.0"
  }
}
```

#### أوامر التثبيت
```bash
# تثبيت جميع المكتبات دفعة واحدة
cd extension
npm install

# أو تثبيت حسب المرحلة
# المرحلة 2
npm install --save-dev @typescript-eslint/parser @typescript-eslint/typescript-estree ast-types recast typescript

# المرحلة 3
npm install --save-dev diff fast-diff

# المرحلة 4
npm install node-fetch better-sqlite3 mysql2 pg

# المرحلة 5
npm install --save-dev jest @types/jest

# المرحلة 6
npm install uuid lowdb

# المرحلة 7
npm install d3 vis-network
```

#### ملخص المكتبات حسب الاستخدام

**تحليل الكود (AST):**
- @typescript-eslint/parser
- @typescript-eslint/typescript-estree
- ast-types
- recast
- typescript

**التعديل المتقدم:**
- diff
- fast-diff

**الشبكة والبيانات:**
- node-fetch
- better-sqlite3
- mysql2
- pg

**الاختبار:**
- jest
- @types/jest

**الذاكرة والتخزين:**
- uuid
- lowdb

**التصورات والرسوم:**
- d3
- vis-network

---

## 🎯 الأولويات

### الأولوية القصوى (ابدأ فوراً)
1. رفع الحدود الحالية
2. جمع context تلقائي في Chat Mode
3. إضافة grep tool

### الأولوية العالية
4. multi-edit tool
5. تحليل dependencies
6. تحسين system prompt

### الأولوية المتوسطة
7. HTTP requests
8. test runner
9. memory system

### الأولوية المنخفضة
10. database support
11. تحسينات UI متقدمة
12. اقتراحات context-aware

---

## 📈 مقاييس النجاح

### الكمية
- عدد الأدوات المتوفرة: من 6 إلى 20+
- عمق file tree: من 3 إلى 6 مستويات
- عدد الملفات المعروضة: من 200 إلى 1000+

### النوعية
- دقة فهم المشروع: من 40% إلى 80%+
- دقة الاقتراحات: من 50% إلى 85%+
- رضا المستخدم: من 3/5 إلى 4.5/5

---

## 🚀 الخطوات التالية الفورية

1. **بدء المرحلة 1.1**: رفع الحدود الحالية
2. **إضافة context collection**: في Chat Mode
3. **إضافة grep tool**: للبحث في الكود
4. **اختبار وتحسين**: مع مستخدمين حقيقيين

---

## 📝 ملاحظات مهمة

- **الأمان**: كل الأدوات الجديدة يجب أن تمر عبر PathSecurity
- **الأداء**: تجنب عمليات ثقيلة تؤثر على VSCode
- **التوافق**: يجب العمل مع جميع أنواع المشاريع
- **التوثيق**: كل أداة جديدة تحتاج توثيق واضح
- **الاختبار**: اختبار شامل لكل ميزة جديدة

---

## 🤝 المساهمة

هذا المشروع مفتوح المصدر - المساهمات مرحب بها!

- Fork the repository
- Create feature branch
- Submit pull request

---

**آخر تحديث**: يونيو 2026  
**الإصدار**: 2.0.0 → 3.0.0 Roadmap
