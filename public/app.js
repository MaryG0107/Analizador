/* ============================================================================
   Same SOLID structure as the original prototype, adapted to talk to a real
   backend (ApiClient) instead of local-only storage, and kept in sync across
   every connected browser via Socket.IO (see App.wireRealtime).
   ============================================================================ */

const PALETTE = ['#1B6F66', '#C97F06', '#B0452F', '#3A6EA5', '#6E5AA6', '#4C8C4A', '#B0752F', '#3F7D9E'];

const Utils = {
  escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); },
  escapeAttr(s) { return String(s).replace(/'/g, "\\'"); },
  splitOptions(raw) { return raw.split(',').map(s => s.trim()).filter(Boolean); }
};

/* ---------------------------- Question types (Open/Closed) ---------------- */
class QuestionType {
  constructor(key, label, isMultiSelect) { this.key = key; this.label = label; this.isMultiSelect = isMultiSelect; }
  isSelected(answer, option) { return answer === option; }
  applyAnswer(answer, option) { return option; }
}
class YesNoQuestionType extends QuestionType { constructor() { super('yesno', 'Si / No', false); } }
class MultiQuestionType extends QuestionType {
  constructor() { super('multi', 'Multiple (varias opciones)', true); }
  isSelected(answer, option) { return Array.isArray(answer) && answer.includes(option); }
  applyAnswer(answer, option) {
    const current = Array.isArray(answer) ? answer : [];
    return current.includes(option) ? current.filter(o => o !== option) : [...current, option];
  }
}
class McQuestionType extends QuestionType { constructor() { super('mc', 'Opcion multiple', false); } }
class QuestionTypeRegistry {
  constructor(types) { this.types = types; }
  get(key) { return this.types.find(t => t.key === key) || this.types.find(t => t.key === 'mc'); }
  all() { return this.types; }
}
const QUESTION_TYPES = new QuestionTypeRegistry([new YesNoQuestionType(), new MultiQuestionType(), new McQuestionType()]);

/* ---------------------------- API client (Dependency Inversion) ----------- */
class ApiClient {
  async _json(url, opts) {
    const res = await fetch(url, opts);
    if (res.status === 401) { const err = new Error('unauthorized'); err.status = 401; throw err; }
    if (!res.ok) throw new Error(`${opts?.method || 'GET'} ${url} -> ${res.status}`);
    return res.status === 204 ? null : res.json();
  }
  getSession() { return this._json('/api/session'); }
  login(username, password) { return this._json('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) }); }
  logout() { return this._json('/api/logout', { method: 'POST' }); }

  getQuestions() { return this._json('/api/questions'); }
  createQuestion(q) { return this._json('/api/questions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(q) }); }
  bulkCreateQuestions(questions) { return this._json('/api/questions/bulk', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ questions }) }); }
  updateQuestion(id, fields) { return this._json(`/api/questions/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fields) }); }
  deleteQuestion(id) { return this._json(`/api/questions/${id}`, { method: 'DELETE' }); }

  getResponses() { return this._json('/api/responses'); }
  createResponse(answers) { return this._json('/api/responses', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ answers }) }); }
  updateResponse(id, answers) { return this._json(`/api/responses/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ answers }) }); }
  deleteResponse(id) { return this._json(`/api/responses/${id}`, { method: 'DELETE' }); }

  getConfig() { return this._json('/api/config'); }
  setConfig(fields) { return this._json('/api/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fields) }); }

  async importDocx(file) {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch('/api/import', { method: 'POST', body: form });
    if (!res.ok) throw new Error('import failed');
    return res.json();
  }
}

/* ---------------------------- Store (client-side cache) ------------------- */
class SurveyStore {
  constructor(api, registry) {
    this.api = api; this.registry = registry;
    this.state = { questions: [], target: 100, responses: [], tab: 'config', captureIndex: 0, loaded: false, draftQuestions: null, online: true, draft: {} };
  }

  async loadAll() {
    const [questions, responses, config] = await Promise.all([this.api.getQuestions(), this.api.getResponses(), this.api.getConfig()]);
    this.state.questions = questions;
    this.state.responses = responses;
    this.state.target = config.target;
    if (this.state.captureIndex > this.state.responses.length) this.state.captureIndex = this.state.responses.length;
    if (!this.state.loaded) this.syncDraftFromCurrent();
    this.state.loaded = true;
  }

  usableQuestions() { return this.state.questions.filter(q => q.options && q.options.length >= 2); }

  isApplicable(question, answers) {
    if (!question.dependsOn) return true;
    return answers[question.dependsOn.questionId] === question.dependsOn.answer;
  }
  visibleQuestions(answers) { return this.usableQuestions().filter(q => this.isApplicable(q, answers)); }

  currentAnswers() { return this.state.draft; }

  isEditingExisting() { return this.state.captureIndex < this.state.responses.length; }

  syncDraftFromCurrent() {
    const r = this.state.responses[this.state.captureIndex];
    this.state.draft = r ? JSON.parse(JSON.stringify(r.answers)) : {};
  }

  setDraftAnswer(questionId, option) {
    const q = this.state.questions.find(q => q.id === questionId);
    const type = this.registry.get(q.type);
    this.state.draft[questionId] = type.applyAnswer(this.state.draft[questionId], option);
  }

  async submitDraft() {
    if (this.isEditingExisting()) {
      const existing = this.state.responses[this.state.captureIndex];
      this.state.responses[this.state.captureIndex] = await this.api.updateResponse(existing.id, this.state.draft);
    } else {
      const created = await this.api.createResponse(this.state.draft);
      this.state.responses.push(created);
      this.state.captureIndex = this.state.responses.length;
    }
    this.syncDraftFromCurrent();
  }

  goTo(idx) {
    this.state.captureIndex = Math.max(0, Math.min(idx, this.state.responses.length));
    this.syncDraftFromCurrent();
  }

  async deleteCurrent() {
    const r = this.state.responses[this.state.captureIndex];
    if (!r) return;
    await this.api.deleteResponse(r.id);
    this.state.responses.splice(this.state.captureIndex, 1);
    if (this.state.captureIndex > this.state.responses.length) this.state.captureIndex = this.state.responses.length;
    this.syncDraftFromCurrent();
  }

  async setTarget(val) {
    this.state.target = parseInt(val) || 100;
    await this.api.setConfig({ target: this.state.target });
  }

  async startImport(file) {
    const { questions } = await this.api.importDocx(file);
    this.state.draftQuestions = questions;
  }
  updateDraftType(id, typeKey) {
    const q = this.state.draftQuestions.find(q => q.id === id);
    q.type = typeKey;
    q.options = typeKey === 'yesno' ? ['Sí', 'No'] : (q.options.length ? q.options : []);
  }
  updateDraftOptions(id, optsRaw) { this.state.draftQuestions.find(q => q.id === id).options = Utils.splitOptions(optsRaw); }
  removeDraft(id) { this.state.draftQuestions = this.state.draftQuestions.filter(q => q.id !== id); }
  async confirmImport() {
    const valid = this.state.draftQuestions.filter(q => q.text.trim());
    await this.api.bulkCreateQuestions(valid);
    this.state.draftQuestions = null;
  }
  cancelImport() { this.state.draftQuestions = null; }

  async addQuestion(text, typeKey, optsRaw) {
    if (!text.trim()) return;
    const type = this.registry.get(typeKey);
    const options = typeKey === 'yesno' ? ['Sí', 'No'] : Utils.splitOptions(optsRaw);
    await this.api.createQuestion({ text: text.trim(), type: typeKey, options });
  }
  async removeQuestion(id) { await this.api.deleteQuestion(id); }
  async updateQuestionType(id, typeKey) { await this.api.updateQuestion(id, { type: typeKey, options: typeKey === 'yesno' ? ['Sí', 'No'] : [] }); }
  async updateQuestionOptions(id, optsRaw) { await this.api.updateQuestion(id, { options: Utils.splitOptions(optsRaw) }); }
}

/* ---------------------------- Stats (pure) --------------------------------- */
class StatsCalculator {
  constructor(store) { this.store = store; }
  questionStats(question, responses) {
    const counts = {};
    (question.options || []).forEach(o => counts[o] = 0);
    let applicable = 0, answered = 0;
    responses.forEach(r => {
      if (!this.store.isApplicable(question, r.answers)) return;
      applicable++;
      const v = r.answers[question.id];
      if (Array.isArray(v)) { if (v.length) { answered++; v.forEach(o => { if (o in counts) counts[o]++; }); } }
      else if (v) { answered++; if (v in counts) counts[v]++; }
    });
    return { counts, answered, applicable };
  }
  conclusionParts(questions, responses) {
    return questions.filter(q => q.options && q.options.length >= 2).map(q => {
      const { counts, answered, applicable } = this.questionStats(q, responses);
      const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
      const topPct = answered ? Math.round((top[1] / answered) * 100) : 0;
      return { q, top, topPct, answered, applicable, counts };
    });
  }
  questionInsight(p) {
    if (p.answered === 0) return 'Aun no hay respuestas para esta pregunta.';
    if (p.topPct >= 70) return `Consenso claro: ${p.topPct}% eligio "${p.top[0]}".`;
    if (p.topPct < 40) return `Las respuestas estan muy divididas entre las opciones, sin una tendencia clara.`;
    if (p.topPct < 55) return `Opiniones divididas; la mas elegida es "${p.top[0]}" con ${p.topPct}%.`;
    return `Tendencia moderada hacia "${p.top[0]}" (${p.topPct}%).`;
  }

  conclusionLines(parts, total) {
    const strong = parts.filter(p => p.topPct >= 70);
    const split = parts.filter(p => p.topPct < 55);
    const lines = [`Se analizaron ${total} encuestas sobre ${parts.length} preguntas.`];
    if (strong.length > 0) lines.push('Hay consenso claro en: ' + strong.map(p => `${p.q.text} (${p.topPct}% respondio "${p.top[0]}")`).join('; ') + '.');
    if (split.length > 0) lines.push('Las respuestas estan mas divididas en: ' + split.map(p => p.q.text).join(', ') + ', lo que sugiere opiniones variadas.');
    if (strong.length === 0 && split.length === 0) lines.push('En general las respuestas muestran una tendencia moderada, sin consenso extremo ni division marcada.');
    return lines;
  }
}

/* ---------------------------- Chart preferences (per-question, per-browser) */
const ChartPrefs = {
  KEY: 'analizador_chart_prefs_v1',
  KINDS: [{ key: 'bar', label: 'Barras' }, { key: 'horizontalBar', label: 'Barras horizontales' }, { key: 'pie', label: 'Pastel' }, { key: 'doughnut', label: 'Dona' }, { key: 'line', label: 'Linea' }],
  load() { try { return JSON.parse(localStorage.getItem(this.KEY)) || {}; } catch (e) { return {}; } },
  save(all) { localStorage.setItem(this.KEY, JSON.stringify(all)); },
  defaultKind(question) { return question.type === 'yesno' ? 'doughnut' : 'bar'; },
  get(question) {
    const p = this.load()[question.id] || {};
    return { kind: p.kind || this.defaultKind(question), colors: p.colors || {} };
  },
  colorFor(question, option, index) {
    const { colors } = this.get(question);
    return colors[option] || PALETTE[index % PALETTE.length];
  },
  setKind(questionId, kind) {
    const all = this.load();
    all[questionId] = { ...(all[questionId] || {}), kind };
    this.save(all);
  },
  setColor(questionId, option, color) {
    const all = this.load();
    const entry = all[questionId] || {};
    entry.colors = { ...(entry.colors || {}), [option]: color };
    all[questionId] = entry;
    this.save(all);
  }
};

/* ---------------------------- Chart rendering ------------------------------ */
class ChartPool {
  constructor() { this.instances = []; this.byId = new Map(); }
  destroyAll() { this.instances.forEach(c => c && c.destroy()); this.instances = []; this.byId.clear(); }
  get(canvasId) { return this.byId.get(canvasId); }
  render(canvasId, question, counts, compact) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    const { kind } = ChartPrefs.get(question);
    const labels = Object.keys(counts);
    const colors = labels.map((label, i) => ChartPrefs.colorFor(question, label, i));
    const isPieLike = kind === 'pie' || kind === 'doughnut';
    const horizontal = kind === 'horizontalBar' || (compact && kind === 'bar');
    const labelSize = compact ? 11 : 15;
    const chart = new Chart(ctx, {
      type: kind === 'horizontalBar' ? 'bar' : kind,
      plugins: [ChartDataLabels],
      data: { labels, datasets: [{ data: Object.values(counts), backgroundColor: colors, borderRadius: isPieLike ? 0 : 4, borderWidth: isPieLike ? 2 : 0, borderColor: '#fff', maxBarThickness: compact ? 26 : 40 }] },
      options: {
        indexAxis: horizontal ? 'y' : 'x',
        responsive: true, maintainAspectRatio: false, devicePixelRatio: 2,
        layout: { padding: isPieLike ? 0 : { top: compact ? 14 : 22 } },
        plugins: {
          legend: { display: isPieLike, position: 'bottom', labels: { font: { family: 'IBM Plex Sans', size: labelSize }, boxWidth: 14, padding: 12 } },
          datalabels: {
            display: ctx => !!ctx.dataset.data[ctx.dataIndex],
            color: isPieLike ? '#fff' : '#1E2A24',
            anchor: isPieLike ? 'center' : 'end',
            align: isPieLike ? 'center' : 'end',
            offset: isPieLike ? 0 : 4,
            font: { family: 'IBM Plex Sans', size: labelSize, weight: '600' },
            formatter: (value, ctx) => {
              const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
              return total ? Math.round((value / total) * 100) + '%' : '';
            }
          }
        },
        scales: isPieLike ? {} : {
          x: { beginAtZero: true, ticks: { precision: 0, font: { family: 'IBM Plex Mono', size: compact ? 11 : 13 } } },
          y: { beginAtZero: true, ticks: { font: { family: 'IBM Plex Sans', size: compact ? 11 : 14 }, autoSkip: false } }
        }
      }
    });
    this.instances.push(chart);
    this.byId.set(canvasId, chart);
  }
}

/* ---------------------------- Views ---------------------------------------- */
class SurveyViews {
  constructor(store, stats, registry, analysisCharts, liveCharts) {
    this.store = store; this.stats = stats; this.registry = registry;
    this.analysisCharts = analysisCharts; this.liveCharts = liveCharts;
  }

  tabs() {
    const s = this.store.state;
    const tabs = [{ id: 'config', label: 'Preguntas', num: '01' }, { id: 'capture', label: 'Captura', num: '02' }, { id: 'analysis', label: 'Analisis', num: '03' }];
    return `<div class="tabs">${tabs.map(t => `<div class="tab ${s.tab === t.id ? 'active' : ''}" onclick="App.setTab('${t.id}')"><span class="num">${t.num}</span>${t.label}</div>`).join('')}</div>`;
  }

  typeOptionsHtml(selectedKey) {
    return this.registry.all().map(t => `<option value="${t.key}" ${selectedKey === t.key ? 'selected' : ''}>${t.label}</option>`).join('');
  }

  importBox() {
    const s = this.store.state;
    if (s.draftQuestions) {
      const missing = s.draftQuestions.filter(q => q.type !== 'yesno' && q.options.length < 2).length;
      return `<div class="card">
        <h3 style="font-size:14px;margin-bottom:4px;">Revisa las preguntas importadas</h3>
        <p class="muted" style="margin:0 0 10px;">Se detectaron ${s.draftQuestions.length} preguntas. ${missing > 0 ? `<span class="opts-missing">${missing} aun sin opciones completas</span>` : ''}</p>
        ${s.draftQuestions.map(q => `
          <div class="draft-item">
            <div class="qtext">${Utils.escapeHtml(q.text)}</div>
            ${q.dependsOn ? `<div class="depends-tag">Depende de la pregunta anterior = "${Utils.escapeHtml(q.dependsOn.answer)}"</div>` : ''}
            <div class="qitem-edit">
              <select onchange="App.updateDraftType('${q.id}', this.value)">${this.typeOptionsHtml(q.type)}</select>
              ${q.type !== 'yesno' ? `<input type="text" placeholder="Opciones separadas por coma" value="${Utils.escapeAttr((q.options || []).join(', '))}" onchange="App.updateDraftOptions('${q.id}', this.value)">` : ''}
              <button class="ghost" onclick="App.removeDraft('${q.id}')">Quitar</button>
            </div>
          </div>`).join('')}
        <div style="display:flex;gap:8px;margin-top:16px;">
          <button class="primary" onclick="App.confirmImport()">Agregar estas preguntas al formulario</button>
          <button onclick="App.cancelImport()">Cancelar</button>
        </div>
      </div>`;
    }
    return `<div class="import-box">
      <label style="margin-bottom:8px;">Importar preguntas desde Word</label>
      <p class="muted" style="margin:0 0 10px;">Sube un .docx. Se detecta como pregunta cada linea con "¿...?", como opciones las lineas con ☐, y como pregunta condicional cualquiera que empiece con "Si su respuesta es Si/No...".</p>
      <input type="file" accept=".docx" onchange="App.handleFileImport(this)">
    </div>`;
  }

  config() {
    const s = this.store.state;
    return `
    <div class="card">
      <label>Nueva pregunta manual</label>
      <div class="add-q-form">
        <div style="flex:2;min-width:220px;"><input type="text" id="new-q-text" placeholder="Ej. Como calificaria el servicio recibido?"></div>
        <div><select id="new-q-type">${this.typeOptionsHtml('mc')}</select></div>
        <div class="opts-field" id="opts-field"><input type="text" id="new-q-opts" placeholder="Opciones separadas por coma"></div>
        <div style="flex:0;"><button class="primary" onclick="App.submitNewQuestion()">Agregar</button></div>
      </div>
      ${this.importBox()}
      <div class="qlist">
        ${s.questions.length === 0 ? '<p class="muted" style="margin-top:14px;">Aun no has agregado preguntas.</p>' : s.questions.map(q => `
          <div class="qitem">
            <div class="qitem-top"><div class="qtext">${Utils.escapeHtml(q.text)}</div><button class="ghost" onclick="App.removeQuestion('${q.id}')">Eliminar</button></div>
            ${q.dependsOn ? `<div class="depends-tag">Depende de otra pregunta = "${Utils.escapeHtml(q.dependsOn.answer)}"</div>` : ''}
            <div class="qitem-edit">
              <select onchange="App.updateQuestionType('${q.id}', this.value)">${this.typeOptionsHtml(q.type)}</select>
              ${q.type !== 'yesno' ? `<input type="text" placeholder="Opciones separadas por coma" value="${Utils.escapeAttr((q.options || []).join(', '))}" onchange="App.updateQuestionOptions('${q.id}', this.value)">` : `<span class="muted">Si / No</span>`}
            </div>
            ${q.type !== 'yesno' && (!q.options || q.options.length < 2) ? '<div class="opts-missing" style="margin-top:5px;">Faltan opciones (minimo 2)</div>' : ''}
          </div>`).join('')}
      </div>
    </div>
    <div class="card">
      <label>Meta de encuestas a capturar</label>
      <div class="row" style="align-items:center;">
        <div style="max-width:120px;"><input type="number" value="${s.target}" min="1" onchange="App.updateTarget(this.value)"></div>
        <div class="muted" style="flex:2;">Compartida por todas las personas que capturan al mismo tiempo.</div>
      </div>
    </div>
    ${s.questions.length > 0 ? `<button class="primary" onclick="App.setTab('capture')">Ir a capturar respuestas -></button>` : ''}`;
  }

  liveDashboard() {
    const s = this.store.state;
    const usable = this.store.usableQuestions();
    if (usable.length === 0) return '';
    const total = s.responses.length;
    const pct = Math.min(100, Math.round((total / s.target) * 100));
    const parts = this.stats.conclusionParts(usable, s.responses);
    const strongest = parts.length ? parts.reduce((a, b) => (b.topPct > a.topPct ? b : a)) : null;

    setTimeout(() => {
      this.liveCharts.destroyAll();
      usable.forEach((q, i) => {
        const { counts } = this.stats.questionStats(q, s.responses);
        this.liveCharts.render(`live-chart-${i}`, q, counts, true);
      });
    }, 0);

    return `
    <div class="dash-section">
      <div class="dash-title"><span class="dash-dot"></span><h3>Dashboard en tiempo real</h3></div>
      <div class="metric-row">
        <div class="metric-card"><span class="micon">📋</span><div><div class="mlabel">Capturadas</div><div class="mvalue">${total}</div></div></div>
        <div class="metric-card"><span class="micon">🎯</span><div><div class="mlabel">Avance de la meta</div><div class="mvalue">${pct}%</div><div class="mbar"><i style="width:${pct}%"></i></div></div></div>
        <div class="metric-card"><span class="micon">❓</span><div><div class="mlabel">Preguntas activas</div><div class="mvalue">${usable.length}</div></div></div>
        ${strongest ? `<div class="metric-card"><span class="micon">🏆</span><div><div class="mlabel">Mayor consenso</div><div class="mvalue">${strongest.topPct}%</div></div></div>` : ''}
      </div>
      <div class="dash-grid">
        ${usable.map((q, i) => {
          const { counts, answered } = this.stats.questionStats(q, s.responses);
          const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
          return `<div class="mini-chart-card">
            <div class="mcname">${Utils.escapeHtml(q.text)}</div>
            <div class="chart-wrap mini"><canvas id="live-chart-${i}"></canvas></div>
            <div class="mctop"><span>Mas frecuente</span><span><strong>${Utils.escapeHtml(top[0])}</strong> (${answered ? Math.round((top[1] / answered) * 100) : 0}%)</span></div>
          </div>`;
        }).join('')}
      </div>
    </div>`;
  }

  capture() {
    const s = this.store.state;
    if (s.questions.length === 0) return `<div class="empty">Primero agrega tus preguntas en la pestana <strong>Preguntas</strong>.</div>`;
    const incomplete = s.questions.filter(q => !q.options || q.options.length < 2);
    if (incomplete.length > 0) return `<div class="empty">Faltan opciones de respuesta en ${incomplete.length} pregunta(s). Ve a la pestana <strong>Preguntas</strong> para completarlas.</div>`;

    const total = s.responses.length;
    const isNewSurvey = !this.store.isEditingExisting();
    const pct = Math.min(100, Math.round((total / s.target) * 100));
    const answers = this.store.currentAnswers();
    const visible = this.store.visibleQuestions(answers);

    if (visible.length === 0) return `<div class="empty">No hay preguntas aplicables para esta encuesta.</div>`;

    const answeredCount = visible.filter(q => {
      const v = answers[q.id];
      return Array.isArray(v) ? v.length > 0 : !!v;
    }).length;

    return `
    <div class="capture-nav">
      <div class="tally">Encuesta ${s.captureIndex + 1} ${isNewSurvey ? '(nueva)' : ''} - ${total} de ${s.target}<span class="bar"><i style="width:${pct}%"></i></span></div>
      <div style="display:flex;gap:6px;">
        <button onclick="App.goTo(${s.captureIndex - 1})" ${s.captureIndex <= 0 ? 'disabled' : ''}>Encuesta anterior</button>
        <button onclick="App.goTo(${s.captureIndex + 1})" ${isNewSurvey ? 'disabled' : ''}>Encuesta siguiente</button>
      </div>
    </div>
    <div class="capture-layout">
      <div class="card survey-form">
        <div class="form-progress muted">${answeredCount} de ${visible.length} preguntas respondidas</div>
        ${visible.map(q => {
          const type = this.registry.get(q.type);
          return `<div class="qblock form-qblock">
            <div class="qname">${Utils.escapeHtml(q.text)}</div>
            ${type.isMultiSelect ? '<div class="qhint">puede marcar varias opciones</div>' : ''}
            <div class="opts-grid">
              ${q.options.map(o => {
                const selected = type.isSelected(answers[q.id], o);
                return `<div class="opt-pill ${selected ? 'selected' : ''}" onclick="App.setDraftAnswer('${q.id}', '${Utils.escapeAttr(o)}')">${Utils.escapeHtml(o)}</div>`;
              }).join('')}
            </div>
          </div>`;
        }).join('')}
        <div class="capture-actions">
          <div style="display:flex;gap:8px;">
            ${!isNewSurvey ? `<button class="ghost danger-outline" onclick="App.deleteCurrent()">Eliminar esta encuesta</button>` : ''}
          </div>
          <button class="primary" onclick="App.submitDraft()">${isNewSurvey ? 'Enviar respuestas' : 'Guardar cambios'} -></button>
        </div>
      </div>
      ${this.liveDashboard()}
    </div>`;
  }

  analysis() {
    this.analysisCharts.destroyAll();
    const s = this.store.state;
    if (s.questions.length === 0) return `<div class="empty">Agrega preguntas y captura respuestas para ver el analisis.</div>`;
    if (s.responses.length === 0) return `<div class="empty">Aun no hay respuestas capturadas.</div>`;

    const parts = this.stats.conclusionParts(s.questions, s.responses);
    const conclusionLines = this.stats.conclusionLines(parts, s.responses.length);
    const cards = parts.map((p, i) => {
      const { kind } = ChartPrefs.get(p.q);
      const options = Object.keys(p.counts);
      const breakdown = options.map((opt, oi) => {
        const count = p.counts[opt];
        const pct = p.answered ? Math.round((count / p.answered) * 100) : 0;
        return `<div class="breakdown-row">
          <label class="swatch"><input type="color" value="${ChartPrefs.colorFor(p.q, opt, oi)}" onchange="App.setChartColor('${p.q.id}', '${Utils.escapeAttr(opt)}', this.value)"></label>
          <span class="breakdown-label">${Utils.escapeHtml(opt)}</span>
          <span class="breakdown-bar"><i style="width:${pct}%;background:${ChartPrefs.colorFor(p.q, opt, oi)};"></i></span>
          <span class="breakdown-val">${count} (${pct}%)</span>
        </div>`;
      }).join('');
      return `
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:6px;">
          <h3 style="font-size:14px;">${Utils.escapeHtml(p.q.text)}<span class="badge-type">${this.registry.get(p.q.type).label}</span></h3>
          <span class="badge-warn">${p.answered} de ${p.applicable} respondieron</span>
        </div>
        <div class="chart-controls">
          <label style="display:inline;text-transform:none;margin:0;">Tipo de grafica</label>
          <select onchange="App.setChartKind('${p.q.id}', this.value)">
            ${ChartPrefs.KINDS.map(k => `<option value="${k.key}" ${kind === k.key ? 'selected' : ''}>${k.label}</option>`).join('')}
          </select>
        </div>
        <div class="chart-wrap"><canvas id="chart-${i}"></canvas></div>
        <div class="answer-breakdown">${breakdown}</div>
        <div class="card-insight">${Utils.escapeHtml(this.stats.questionInsight(p))}</div>
      </div>`;
    }).join('');

    setTimeout(() => parts.forEach((p, i) => this.analysisCharts.render(`chart-${i}`, p.q, p.counts, false)), 0);

    return `
    <div class="toolbar">
      <button onclick="App.exportAs('csv')">CSV</button>
      <button onclick="App.exportExcel()">Excel</button>
      <button onclick="App.exportPdf()">PDF</button>
      <button onclick="App.exportWord()">Word</button>
    </div>
    <div class="card conclusion"><h3 style="margin-bottom:10px;">Conclusion general</h3>${conclusionLines.map(l => `<p>${Utils.escapeHtml(l)}</p>`).join('')}</div>
    ${cards}`;
  }

  root() {
    if (!this.store.state.loaded) return `<div class="empty">Cargando...</div>`;
    const s = this.store.state;
    const body = s.tab === 'config' ? this.config() : s.tab === 'capture' ? this.capture() : this.analysis();
    return `<div class="header"><h1>Analizador de encuestas</h1><div class="sub"><span class="live-dot ${s.online ? '' : 'offline'}"></span>${s.online ? 'en vivo' : 'sin conexion'} &middot; ${s.responses.length} respuestas guardadas <button class="ghost" onclick="App.logout()">Cerrar sesion</button></div></div>${this.tabs()}${body}`;
  }

  login(errorMsg) {
    return `<div class="login-wrap">
      <div class="card login-card">
        <h1 style="font-size:20px;margin-bottom:4px;">Analizador de encuestas</h1>
        <p class="muted" style="margin:0 0 18px;">Inicia sesion para continuar.</p>
        <form onsubmit="event.preventDefault(); App.login();">
          <label>Usuario</label>
          <input type="text" id="login-user" autocomplete="username" autofocus>
          <label style="margin-top:12px;">Contrasena</label>
          <input type="password" id="login-pass" autocomplete="current-password">
          ${errorMsg ? `<p style="color:var(--red);font-size:12px;margin:10px 0 0;">${Utils.escapeHtml(errorMsg)}</p>` : ''}
          <button class="primary" type="submit" style="width:100%;margin-top:16px;">Entrar</button>
        </form>
      </div>
    </div>`;
  }
}

/* ---------------------------- App (composition root + DOM wiring) --------- */
const App = {
  async init() {
    this.el = document.getElementById('app');
    this.registry = QUESTION_TYPES;
    this.api = new ApiClient();
    this.store = new SurveyStore(this.api, this.registry);
    this.stats = new StatsCalculator(this.store);
    this.analysisCharts = new ChartPool();
    this.liveCharts = new ChartPool();
    this.views = new SurveyViews(this.store, this.stats, this.registry, this.analysisCharts, this.liveCharts);

    let authenticated = false;
    try { authenticated = (await this.api.getSession()).authenticated; } catch (e) {}
    if (authenticated) { await this.reload(true); this.wireRealtime(); }
    else { this.el.innerHTML = this.views.login(); }
  },

  async login() {
    const username = document.getElementById('login-user').value;
    const password = document.getElementById('login-pass').value;
    try {
      await this.api.login(username, password);
      await this.reload(true);
      this.wireRealtime();
    } catch (e) {
      this.el.innerHTML = this.views.login('Usuario o contrasena incorrectos.');
    }
  },

  async logout() {
    if (this.socket) { this.socket.disconnect(); this.socket = null; }
    try { await this.api.logout(); } catch (e) {}
    this.store.state.loaded = false;
    this.el.innerHTML = this.views.login();
  },

  async reload(firstLoad) {
    try {
      await this.store.loadAll();
      this.store.state.online = true;
      if (firstLoad && this.store.state.questions.length > 0) this.store.state.tab = 'capture';
    } catch (e) {
      if (e.status === 401) { this.el.innerHTML = this.views.login('Tu sesion expiro, inicia sesion de nuevo.'); return; }
      this.store.state.online = false;
    }
    this.render();
  },

  wireRealtime() {
    this.socket = io();
    const socket = this.socket;
    socket.on('connect', () => { this.store.state.online = true; this.render(); });
    socket.on('disconnect', () => { this.store.state.online = false; this.render(); });
    socket.on('questions:changed', () => this.reload(false));
    socket.on('responses:changed', () => this.reload(false));
    socket.on('config:changed', () => this.reload(false));
  },

  render() { this.el.innerHTML = this.views.root(); },

  setTab(id) { this.store.state.tab = id; this.render(); },

  async submitNewQuestion() {
    const text = document.getElementById('new-q-text').value;
    const type = document.getElementById('new-q-type').value;
    const opts = document.getElementById('new-q-opts') ? document.getElementById('new-q-opts').value : '';
    await this.store.addQuestion(text, type, opts);
    await this.reload(false);
  },

  async removeQuestion(id) { await this.store.removeQuestion(id); await this.reload(false); },
  async updateQuestionType(id, type) { await this.store.updateQuestionType(id, type); await this.reload(false); },
  async updateQuestionOptions(id, opts) { await this.store.updateQuestionOptions(id, opts); await this.reload(false); },
  async updateTarget(val) { await this.store.setTarget(val); await this.reload(false); },

  async handleFileImport(input) {
    const file = input.files[0];
    if (!file) return;
    try { await this.store.startImport(file); }
    catch (e) { alert('No se pudo leer el documento. Verifica que sea un archivo .docx valido.'); }
    this.render();
  },
  updateDraftType(id, type) { this.store.updateDraftType(id, type); this.render(); },
  updateDraftOptions(id, opts) { this.store.updateDraftOptions(id, opts); this.render(); },
  removeDraft(id) { this.store.removeDraft(id); this.render(); },
  async confirmImport() { await this.store.confirmImport(); await this.reload(false); },
  cancelImport() { this.store.cancelImport(); this.render(); },

  setDraftAnswer(qId, opt) { this.store.setDraftAnswer(qId, opt); this.render(); },
  async submitDraft() { await this.store.submitDraft(); this.render(); },
  goTo(idx) { this.store.goTo(idx); this.render(); },
  async deleteCurrent() { await this.store.deleteCurrent(); this.render(); },

  setChartKind(qId, kind) { ChartPrefs.setKind(qId, kind); this.render(); },
  setChartColor(qId, opt, color) { ChartPrefs.setColor(qId, opt, color); this.render(); },

  exportAs(kind) { window.location.href = `/api/export/${kind}`; },

  exportPdf() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const questions = this.store.usableQuestions();
    const responses = this.store.state.responses;
    const parts = this.stats.conclusionParts(questions, responses);
    let y = 18;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.text('Analisis de encuesta', 14, y); y += 6;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(100);
    doc.text(new Date().toLocaleDateString(), 14, y); doc.setTextColor(20); y += 10;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.text('Conclusion general', 14, y); y += 6;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
    this.stats.conclusionLines(parts, responses.length).forEach(line => {
      doc.splitTextToSize(line, 180).forEach(w => { if (y > 280) { doc.addPage(); y = 18; } doc.text(w, 14, y); y += 5.5; });
      y += 2;
    });
    parts.forEach((p, i) => {
      if (y > 250) { doc.addPage(); y = 18; }
      y += 4;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
      doc.splitTextToSize(p.q.text, 180).forEach(w => { doc.text(w, 14, y); y += 5.5; });
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
      Object.entries(p.counts).forEach(([opt, count]) => {
        const pct = p.answered ? Math.round((count / p.answered) * 100) : 0;
        if (y > 280) { doc.addPage(); y = 18; }
        doc.text(`${opt}: ${count} (${pct}%)`, 18, y); y += 5;
      });
      y += 1;
      doc.setFont('helvetica', 'italic');
      doc.splitTextToSize(this.stats.questionInsight(p), 180).forEach(w => { if (y > 280) { doc.addPage(); y = 18; } doc.text(w, 18, y); y += 5; });
      doc.setFont('helvetica', 'normal');
      const chart = this.analysisCharts.get(`chart-${i}`);
      if (chart) {
        try {
          const ratio = chart.canvas.width / chart.canvas.height;
          const w = 90, h = w / ratio;
          if (y + h > 285) { doc.addPage(); y = 18; }
          doc.addImage(chart.toBase64Image(), 'PNG', 14, y, w, h);
          y += h + 6;
        } catch (e) {}
      }
      y += 3;
    });
    doc.save('analisis-encuesta.pdf');
  },

  exportWord() {
    const questions = this.store.usableQuestions();
    const responses = this.store.state.responses;
    const parts = this.stats.conclusionParts(questions, responses);
    const lines = this.stats.conclusionLines(parts, responses.length);
    let html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
    <head><meta charset="utf-8"><title>Analisis de encuesta</title></head>
    <body style="font-family:Calibri, Arial, sans-serif;">
    <h1>Analisis de encuesta</h1><p><i>${new Date().toLocaleDateString()}</i></p>
    <h2>Conclusion general</h2>${lines.map(l => `<p>${Utils.escapeHtml(l)}</p>`).join('')}`;
    parts.forEach((p, i) => {
      html += `<h3>${Utils.escapeHtml(p.q.text)}</h3>`;
      const chart = this.analysisCharts.get(`chart-${i}`);
      if (chart) html += `<p><img src="${chart.toBase64Image()}" width="480"></p>`;
      html += `<table border="1" cellspacing="0" cellpadding="5" style="border-collapse:collapse;width:100%;"><tr><th align="left">Opcion</th><th align="left">Conteo</th><th align="left">Porcentaje</th></tr>`;
      Object.entries(p.counts).forEach(([opt, count]) => {
        const pct = p.answered ? Math.round((count / p.answered) * 100) : 0;
        html += `<tr><td>${Utils.escapeHtml(opt)}</td><td>${count}</td><td>${pct}%</td></tr>`;
      });
      html += `</table><p><i>${Utils.escapeHtml(this.stats.questionInsight(p))}</i></p><br/>`;
    });
    html += `</body></html>`;

    const blob = new Blob(['﻿', html], { type: 'application/msword' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'analisis-encuesta.doc';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },

  async exportExcel() {
    const workbook = new ExcelJS.Workbook();
    const questions = this.store.usableQuestions();
    const responses = this.store.state.responses;
    const parts = this.stats.conclusionParts(questions, responses);

    const dataSheet = workbook.addWorksheet('Respuestas');
    dataSheet.addRow(['Encuesta', ...questions.map(q => q.text)]).font = { bold: true };
    responses.forEach((r, i) => {
      const v = q => { const a = r.answers[q.id]; return Array.isArray(a) ? a.join(' | ') : (a || ''); };
      dataSheet.addRow([i + 1, ...questions.map(v)]);
    });
    dataSheet.columns.forEach(col => { col.width = 30; });

    const summarySheet = workbook.addWorksheet('Resumen');
    summarySheet.getColumn(1).width = 45;
    summarySheet.getColumn(2).width = 12;
    summarySheet.getColumn(3).width = 12;
    summarySheet.getColumn(5).width = 55;

    const noteCell = summarySheet.getCell(1, 1);
    noteCell.value = 'Sugerencia: selecciona la tabla Opcion/Conteo/Porcentaje de una pregunta y usa Insertar > Grafico para crear una grafica nativa y editable a partir de esos datos.';
    noteCell.font = { italic: true, color: { argb: 'FF55625A' }, size: 10 };
    summarySheet.getRow(1).height = 28;
    summarySheet.mergeCells(1, 1, 1, 3);
    noteCell.alignment = { wrapText: true, vertical: 'middle' };

    let row = 3;
    parts.forEach((p, i) => {
      const startRow = row;
      const titleCell = summarySheet.getCell(row, 1);
      titleCell.value = p.q.text;
      titleCell.font = { bold: true, size: 12, color: { argb: 'FF12433E' } };
      row++;

      const headerRow = summarySheet.getRow(row);
      headerRow.getCell(1).value = 'Opcion'; headerRow.getCell(2).value = 'Conteo'; headerRow.getCell(3).value = 'Porcentaje';
      headerRow.font = { bold: true };
      row++;

      Object.entries(p.counts).forEach(([opt, count]) => {
        const pct = p.answered ? count / p.answered : 0;
        const r = summarySheet.getRow(row);
        r.getCell(1).value = opt; r.getCell(2).value = count;
        r.getCell(3).value = pct; r.getCell(3).numFmt = '0%';
        row++;
      });

      const insightCell = summarySheet.getCell(row, 1);
      insightCell.value = this.stats.questionInsight(p);
      insightCell.font = { italic: true, color: { argb: 'FF55625A' } };
      row++;

      let imageRows = 0;
      const chart = this.analysisCharts.get(`chart-${i}`);
      if (chart) {
        try {
          const ratio = chart.canvas.width / chart.canvas.height;
          const width = 380, height = Math.round(width / ratio);
          const base64 = chart.toBase64Image().split(',')[1];
          const imageId = workbook.addImage({ base64, extension: 'png' });
          summarySheet.addImage(imageId, { tl: { col: 4, row: startRow - 1 }, ext: { width, height } });
          imageRows = Math.ceil(height / 20);
        } catch (e) {}
      }
      row = Math.max(row, startRow + imageRows) + 2;
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'analisis-encuesta.xlsx';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
};

App.init();
