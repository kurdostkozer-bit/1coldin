/* KurdBox Shared UI Utilities — used by both chatView and agentView */

const PROVIDER_MODELS = {
  groq:['llama-3.3-70b-versatile','llama3-70b-8192','llama3-8b-8192','mixtral-8x7b-32768'],
  sambanova:['DeepSeek-V3.1','Meta-Llama-3.3-70B-Instruct','Meta-Llama-3.1-405B-Instruct','Meta-Llama-3.1-8B-Instruct'],
  gemini:['gemini-2.5-flash','gemini-2.5-pro','gemini-1.5-flash'],
  cerebras:['llama3.3-70b','llama3.1-70b','llama3.1-8b'],
  openrouter:['google/gemini-flash-1.5-free','meta-llama/llama-3-8b-instruct:free'],
  mistral:['mistral-large-latest','mistral-small-latest','codestral-latest'],
  nvidia:['meta/llama-3.1-70b-instruct','meta/llama-3.1-8b-instruct'],
  github:['gpt-4o-mini','gpt-4o','Meta-Llama-3.1-70B-Instruct'],
  perplexity:['sonar','sonar-pro','sonar-reasoning'],
  fireworks:['accounts/fireworks/models/llama-v3p1-70b-instruct'],
};
const ALIASES = ['best-70b','best-8b','best-flash','best-large','best-coder','best-free','best-cheap','best-reasoning'];

let providers = [], streamDiv = null, advancedOpen = false;

function toggleAdvanced() {
  advancedOpen = !advancedOpen;
  document.getElementById('advanced-panel').classList.toggle('visible', advancedOpen);
  document.getElementById('adv-arrow').textContent = advancedOpen ? '▴' : '▾';
}

function setProviders(data) {
  providers = data;
  const usable = data.filter(p => ['active','limited','cooldown'].includes(p.status));
  const activeOnly = data.filter(p => p.status === 'active');
  const pill = document.getElementById('status-pill');
  const txt = document.getElementById('status-text');
  if (usable.length > 0) {
    pill.className = 'status-pill ok';
    txt.textContent = activeOnly.length + ' مزود نشط';
  } else {
    pill.className = 'status-pill err';
    txt.textContent = 'غير متصل';
  }
  const sel = document.getElementById('sel-provider');
  if (sel) {
    sel.innerHTML = '<option value="">✦ تلقائي</option>' +
      usable.map(p => `<option value="${p.id}">${p.status !== 'active' ? '⚡ ' : ''}${p.name}</option>`).join('');
    onProviderChange();
  }
}

function onProviderChange() {
  const pid = document.getElementById('sel-provider')?.value;
  const sel = document.getElementById('sel-model');
  if (!sel) return;
  const prev = sel.value;
  let models = [];
  const usable = providers.filter(p => ['active','limited','cooldown'].includes(p.status));
  if (!pid) {
    const seen = new Set();
    usable.forEach(p => {
      const ms = (p.models && p.models.length) ? p.models : (PROVIDER_MODELS[p.id] || []);
      ms.forEach(m => { if (!seen.has(m)) { seen.add(m); models.push({v:m,l:m+' ('+p.name+')'}); }});
    });
  } else {
    const p = providers.find(x => x.id === pid);
    const ms = (p && p.models && p.models.length) ? p.models : (PROVIDER_MODELS[pid] || []);
    models = ms.map(m => ({v:m,l:m}));
  }
  sel.innerHTML =
    '<optgroup label="🎯 Smart Aliases">' + ALIASES.map(a => `<option value="${a}">${a}</option>`).join('') + '</optgroup>' +
    (models.length ? '<optgroup label="📦 نماذج">' + models.map(m => `<option value="${m.v}">${m.l}</option>`).join('') + '</optgroup>' : '');
  const opts = Array.from(sel.options).map(o => o.value);
  sel.value = opts.includes(prev) ? prev : (models[0]?.v || 'best-70b');
}

function getModel(text = '') {
  if (advancedOpen) return document.getElementById('sel-model')?.value || 'best-70b';
  const t = text.trim(), len = t.length;
  const GREET = /^(مرحبا|مرحباً|سلام|هلا|أهلا|أهلاً|hello|hi|hey|سلاو|سڵاو|چۆنی|باشی|صباح|مساء)[\s!.,؟?]*$/iu;
  const CODE = /\b(fix|debug|error|bug|code|function|class|import|def |var |const |let |return|syntax|traceback|exception|implement|refactor|review)\b/i;
  const DEEP = /\b(why|analyze|compare|explain|difference|architecture|design|strategy|evaluate|pros|cons|معمارية|تحليل|فرق|لماذا|اشرح|قارن)\b/i;
  if (GREET.test(t)) return 'best-70b';
  if (CODE.test(t)) return 'best-coder';
  if (DEEP.test(t) || len > 250) return 'best-70b';
  if (len < 60) return 'best-8b';
  return 'best-70b';
}
function getProvider() { return advancedOpen ? (document.getElementById('sel-provider')?.value || '') : ''; }
function getStream() {
  if (!advancedOpen) { return false; }
  return document.getElementById('chk-stream')?.checked ?? false;
}

function escHtml(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function autoResize(el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 120) + 'px'; }
function onKey(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }

let thinkEl = null;
function showThinking() {
  thinkEl = document.createElement('div');
  thinkEl.className = 'thinking-wrap';
  thinkEl.innerHTML = '<div class="thinking-orb">✦</div><div class="thinking-dots"><span></span><span></span><span></span></div>';
  document.getElementById('msgs').appendChild(thinkEl);
  document.getElementById('msgs').scrollTop = 99999;
}
function hideThinking() { if (thinkEl) { thinkEl.remove(); thinkEl = null; } }

/** Single source of truth — full re-render from controller state. */
function renderChat(messages, thinking) {
  hideThinking();
  window._lastChatMessages = messages;
  const msgs = document.getElementById('msgs');
  msgs.innerHTML = '';
  if (!messages || messages.length === 0) {
    msgs.innerHTML = '<div class="msg-system">KurdBox AI جاهز ✦</div>';
  } else {
    messages.forEach(m => {
      const type = m.role === 'assistant' ? 'assistant' : m.role === 'error' ? 'error' : 'user';
      appendMsgBubble(m.text, type);
    });
  }
  if (thinking) showThinking();
  msgs.scrollTop = 99999;
}
window.renderChat = renderChat;

function appendMsgBubble(text, type) {
  const wrap = document.createElement('div');
  wrap.className = 'msg-wrap msg-' + type;
  const label = document.createElement('div');
  label.className = 'msg-label';
  label.textContent = type === 'user' ? 'أنت' : type === 'error' ? 'خطأ' : 'KurdBox AI';
  const timestamp = document.createElement('span');
  timestamp.className = 'msg-timestamp';
  const now = new Date();
  timestamp.textContent = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
  label.appendChild(timestamp);
  const el = document.createElement('div');
  el.className = 'msg';
  el.textContent = type === 'error' ? '⚠️ ' + text : text;
  wrap.appendChild(label);
  wrap.appendChild(el);
  document.getElementById('msgs').appendChild(wrap);
}

/** Legacy helper — prefer renderChat. */
function addMsg(text, type, isStream = false) {
  const wrap = document.createElement('div');
  wrap.className = 'msg-wrap msg-' + type;
  const label = document.createElement('div');
  label.className = 'msg-label';
  label.textContent = type === 'user' ? 'أنت' : 'KurdBox AI';
  const timestamp = document.createElement('span');
  timestamp.className = 'msg-timestamp';
  const now = new Date();
  timestamp.textContent = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
  label.appendChild(timestamp);
  const el = document.createElement('div');
  el.className = 'msg';
  if (isStream) { el.dataset.content = ''; el.textContent = ''; }
  else el.textContent = text;
  wrap.appendChild(label);
  wrap.appendChild(el);
  document.getElementById('msgs').appendChild(wrap);
  document.getElementById('msgs').scrollTop = 99999;
  return el;
}

function renderStream(div) {
  const content = div.dataset.content || '';
  div.textContent = content;
  document.getElementById('msgs').scrollTop = 99999;
}

// History management
function toggleHistory() {
  const panel = document.getElementById('history-panel');
  if (panel.style.display === 'none' || panel.style.display === '') {
    panel.style.display = 'flex';
    vscode.postMessage({ type: 'getHistory' });
  } else {
    panel.style.display = 'none';
  }
}

function closeHistory() {
  const panel = document.getElementById('history-panel');
  if (panel) panel.style.display = 'none';
}
window.closeHistory = closeHistory;

function loadHistory(conversations) {
  const list = document.getElementById('history-list');
  list.innerHTML = '';
  if (!conversations || conversations.length === 0) {
    list.innerHTML = '<div class="history-empty">لا توجد محادثات محفوظة</div>';
    return;
  }
  conversations.forEach(conv => {
    const item = document.createElement('div');
    item.className = 'history-item';
    item.innerHTML = `
      <div class="history-item-title">${conv.title}</div>
      <div class="history-item-meta">
        <span class="history-item-date">${new Date(conv.updatedAt).toLocaleDateString('ar-SA')}</span>
        <span>${conv.messages.length} رسالة</span>
      </div>
      <div class="history-item-actions">
        <button class="history-action-btn" onclick="loadConversation('${conv.id}')">📂 فتح</button>
        <button class="history-action-btn delete" onclick="deleteConversation('${conv.id}')">🗑️ حذف</button>
      </div>
    `;
    list.appendChild(item);
  });
}

function loadConversation(id) {
  vscode.postMessage({ type: 'loadConversation', id });
  toggleHistory();
}

function deleteConversation(id) {
  vscode.postMessage({ type: 'deleteConversation', id });
}

function clearHistory() {
  if (confirm('هل أنت متأكد من مسح جميع سجل المحادثات؟')) {
    vscode.postMessage({ type: 'clearHistory' });
    toggleHistory();
  }
}
