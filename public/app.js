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
  constructor(key, label, chartKind, isMultiSelect) { this.key = key; this.label = label; this.chartKind = chartKind; this.isMultiSelect = isMultiSelect; }
  isSelected(answer, option) { return answer === option; }
  applyAnswer(answer, option) { return option; }
}
class YesNoQuestionType extends QuestionType { constructor() { super('yesno', 'Si / No', 'doughnut', false); } }
class MultiQuestionType extends QuestionType {
  constructor() { super('multi', 'Multiple (varias opciones)', 'bar', true); }
  isSelected(answer, option) { return Array.isArray(answer) && answer.includes(option); }
  applyAnswer(answer, option) {
    const current = Array.isArray(answer) ? answer : [];
    return current.includes(option) ? current.filter(o => o !== option) : [...current, option];
  }
}
class McQuestionType extends QuestionType { constructor() { super('mc', 'Opcion multiple', 'bar', false); } }
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
    if (!res.ok) throw new Error(`${opts?.method || 'GET'} ${url} -> ${res.status}`);
    return res.status === 204 ? null : res.json();
  }
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
    this.state = { questions: [], target: 100, responses: [], tab: 'config', captureIndex: 0, wizardStep: 0, loaded: false, draftQuestions: null, online: true };
  }

  async loadAll() {
    const [questions, responses, config] = await Promise.all([this.api.getQuestions(), this.api.getResponses(), this.api.getConfig()]);
    this.state.questions = questions;
    this.state.responses = responses;
    this.state.target = config.target;
    if (this.state.captureIndex > this.state.responses.length) this.state.captureIndex = this.state.responses.length;
    this.state.loaded = true;
    if (this.state.questions.length > 0 && this.state.tab === 'config' && this.state._autoAdvanced !== true) {
      // Only auto-jump to capture on first load, not on every realtime refresh.
    }
  }

  usableQuestions() { return this.state.questions.filter(q => q.options && q.options.length >= 2); }

  isApplicable(question, answers) {
    if (!question.dependsOn) return true;
    return answers[question.dependsOn.questionId] === question.dependsOn.answer;
  }
  visibleQuestions(answers) { return this.usableQuestions().filter(q => this.isApplicable(q, answers)); }

  currentAnswers() {
    const r = this.state.responses[this.state.captureIndex];
    return r ? r.answers : {};
  }

  async ensureCurrentResponse() {
    if (this.state.responses[this.state.captureIndex]) return this.state.responses[this.state.captureIndex];
    const created = await this.api.createResponse({});
    this.state.responses[this.state.captureIndex] = created;
    return created;
  }

  async applyAnswer(questionId, option) {
    const q = this.state.questions.find(q => q.id === questionId);
    const type = this.registry.get(q.type);
    const response = await this.ensureCurrentResponse();
    response.answers[questionId] = type.applyAnswer(response.answers[questionId], option);
    await this.api.updateResponse(response.id, response.answers);
  }

  wizardNext() { this.state.wizardStep++; }
  wizardPrev() { this.state.wizardStep = Math.max(0, this.state.wizardStep - 1); }

  async saveAndAdvance() {
    this.state.captureIndex = this.state.responses.length;
    this.state.wizardStep = 0;
  }

  goTo(idx) {
    this.state.captureIndex = Math.max(0, Math.min(idx, this.state.responses.length));
    this.state.wizardStep = 0;
  }

  async deleteCurrent() {
    const r = this.state.responses[this.state.captureIndex];
    if (!r) return;
    await this.api.deleteResponse(r.id);
    this.state.responses.splice(this.state.captureIndex, 1);
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

/* ---------------------------- Chart renderers (Open/Closed) --------------- */
class ChartRenderer { render() { throw new Error('not implemented'); } }
class BarChartRenderer extends ChartRenderer {
  render(canvasId, counts, compact) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return null;
    const labels = Object.keys(counts);
    return new Chart(ctx, {
      type: 'bar',
      data: { labels, datasets: [{ data: Object.values(counts), backgroundColor: labels.map((_, i) => PALETTE[i % PALETTE.length]), borderRadius: 4, maxBarThickness: compact ? 26 : 40 }] },
      options: {
        indexAxis: compact ? 'y' : 'x',
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { beginAtZero: compact, ticks: { precision: 0, font: { family: 'IBM Plex Mono', size: compact ? 10 : 11 } } },
          y: { beginAtZero: !compact, ticks: { font: { family: 'IBM Plex Sans', size: compact ? 10 : 12 }, autoSkip: false } }
        }
      }
    });
  }
}
class DoughnutChartRenderer extends ChartRenderer {
  render(canvasId, counts) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return null;
    const labels = Object.keys(counts);
    return new Chart(ctx, {
      type: 'doughnut',
      data: { labels, datasets: [{ data: Object.values(counts), backgroundColor: labels.map((_, i) => PALETTE[i % PALETTE.length]), borderWidth: 2, borderColor: '#fff' }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { font: { family: 'IBM Plex Sans', size: 11 }, boxWidth: 10, padding: 8 } } } }
    });
  }
}
class ChartRendererFactory {
  constructor(registry) { this.registry = registry; this.renderers = { bar: new BarChartRenderer(), doughnut: new DoughnutChartRenderer() }; }
  forQuestion(question) { return this.renderers[this.registry.get(question.type).chartKind] || this.renderers.bar; }
}
class ChartPool {
  constructor(factory) { this.factory = factory; this.instances = []; }
  destroyAll() { this.instances.forEach(c => c && c.destroy()); this.instances = []; }
  render(canvasId, question, counts, compact) { this.instances.push(this.factory.forQuestion(question).render(canvasId, counts, compact)); }
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
    const isNewSurvey = s.captureIndex >= total;
    const pct = Math.min(100, Math.round((total / s.target) * 100));
    const answers = this.store.currentAnswers();
    const visible = this.store.visibleQuestions(answers);
    const step = Math.min(s.wizardStep, Math.max(0, visible.length - 1));
    const q = visible[step];
    const isLastStep = step >= visible.length - 1;

    if (!q) return `<div class="empty">No hay preguntas aplicables para esta encuesta.</div>`;

    const type = this.registry.get(q.type);
    return `
    <div class="capture-nav">
      <div class="tally">Encuesta ${s.captureIndex + 1} ${isNewSurvey ? '(nueva)' : ''} - ${total} de ${s.target}<span class="bar"><i style="width:${pct}%"></i></span></div>
      <div style="display:flex;gap:6px;">
        <button onclick="App.goTo(${s.captureIndex - 1})" ${s.captureIndex <= 0 ? 'disabled' : ''}>Encuesta anterior</button>
        <button onclick="App.goTo(${s.captureIndex + 1})" ${isNewSurvey ? 'disabled' : ''}>Encuesta siguiente</button>
      </div>
    </div>
    <div class="capture-layout">
      <div class="card">
        <div class="wizard-progress"><span>Pregunta ${step + 1} de ${visible.length}</span>${q.dependsOn ? '<span>pregunta condicional</span>' : ''}</div>
        <div class="wizard-track"><i style="width:${Math.round(((step + 1) / visible.length) * 100)}%"></i></div>
        <div class="qblock">
          <div class="qname">${Utils.escapeHtml(q.text)}</div>
          ${type.isMultiSelect ? '<div class="qhint">puede marcar varias opciones</div>' : ''}
          <div class="opts-grid">
            ${q.options.map((o, i) => {
              const selected = type.isSelected(answers[q.id], o);
              return `<div class="opt-pill ${selected ? 'selected' : ''}" onclick="App.applyAnswer('${q.id}', '${Utils.escapeAttr(o)}')">${i < 9 ? `<span class="kbd">${i + 1}</span>` : ''}${Utils.escapeHtml(o)}</div>`;
            }).join('')}
          </div>
        </div>
        <div class="capture-actions">
          <div style="display:flex;gap:8px;">
            <button onclick="App.wizardPrev()" ${step <= 0 ? 'disabled' : ''}>Anterior</button>
            ${!isNewSurvey && step === 0 ? `<button class="ghost danger-outline" onclick="App.deleteCurrent()">Eliminar esta encuesta</button>` : ''}
          </div>
          ${isLastStep
            ? `<button class="primary" onclick="App.finishSurvey()">Guardar y ${isNewSurvey ? 'nueva' : 'siguiente'} encuesta -></button>`
            : `<button class="primary" onclick="App.wizardNext()">Siguiente pregunta -></button>`}
        </div>
        <div class="kbd-hint">Atajos: teclas 1-9 eligen opcion &middot; Enter avanza &middot; Flecha izquierda retrocede</div>
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
    const cards = parts.map((p, i) => `
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:baseline;">
          <h3 style="font-size:14px;">${Utils.escapeHtml(p.q.text)}<span class="badge-type">${this.registry.get(p.q.type).label}</span></h3>
          <span class="badge-warn">${p.answered} de ${p.applicable} respondieron</span>
        </div>
        <div class="chart-wrap"><canvas id="chart-${i}"></canvas></div>
        <div class="stat-line"><span>Respuesta mas frecuente</span><span><strong>${Utils.escapeHtml(p.top[0])}</strong> (${p.topPct}%)</span></div>
      </div>`).join('');

    setTimeout(() => parts.forEach((p, i) => this.analysisCharts.render(`chart-${i}`, p.q, p.counts, false)), 0);

    return `
    <div class="toolbar">
      <button onclick="App.exportAs('csv')">CSV</button>
      <button onclick="App.exportAs('excel')">Excel</button>
      <button onclick="App.exportPdf()">PDF</button>
      <button onclick="App.exportAs('word')">Word</button>
    </div>
    <div class="card conclusion"><h3 style="margin-bottom:10px;">Conclusion general</h3>${conclusionLines.map(l => `<p>${Utils.escapeHtml(l)}</p>`).join('')}</div>
    ${cards}`;
  }

  root() {
    if (!this.store.state.loaded) return `<div class="empty">Cargando...</div>`;
    const s = this.store.state;
    const body = s.tab === 'config' ? this.config() : s.tab === 'capture' ? this.capture() : this.analysis();
    return `<div class="header"><h1>Analizador de encuestas</h1><div class="sub"><span class="live-dot ${s.online ? '' : 'offline'}"></span>${s.online ? 'en vivo' : 'sin conexion'} &middot; ${s.responses.length} respuestas guardadas</div></div>${this.tabs()}${body}`;
  }
}

/* ---------------------------- App (composition root + DOM wiring) --------- */
const App = {
  init() {
    this.el = document.getElementById('app');
    this.registry = QUESTION_TYPES;
    this.api = new ApiClient();
    this.store = new SurveyStore(this.api, this.registry);
    this.stats = new StatsCalculator(this.store);
    const factory = new ChartRendererFactory(this.registry);
    this.analysisCharts = new ChartPool(factory);
    this.liveCharts = new ChartPool(factory);
    this.views = new SurveyViews(this.store, this.stats, this.registry, this.analysisCharts, this.liveCharts);
    document.addEventListener('keydown', e => this.handleKeydown(e));
    this.reload(true);
    this.wireRealtime();
  },

  async reload(firstLoad) {
    try {
      await this.store.loadAll();
      this.store.state.online = true;
      if (firstLoad && this.store.state.questions.length > 0) this.store.state.tab = 'capture';
    } catch (e) {
      this.store.state.online = false;
    }
    this.render();
  },

  wireRealtime() {
    const socket = io();
    socket.on('connect', () => { this.store.state.online = true; this.render(); });
    socket.on('disconnect', () => { this.store.state.online = false; this.render(); });
    socket.on('questions:changed', () => this.reload(false));
    socket.on('responses:changed', () => this.reload(false));
    socket.on('config:changed', () => this.reload(false));
  },

  render() { this.el.innerHTML = this.views.root(); },

  handleKeydown(e) {
    if (this.store.state.tab !== 'capture') return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    const digit = parseInt(e.key);
    if (!isNaN(digit) && digit >= 1 && digit <= 9) {
      const answers = this.store.currentAnswers();
      const visible = this.store.visibleQuestions(answers);
      const q = visible[Math.min(this.store.state.wizardStep, visible.length - 1)];
      if (q && q.options[digit - 1]) this.applyAnswer(q.id, q.options[digit - 1]);
    } else if (e.key === 'Enter') { this.wizardNext(); }
    else if (e.key === 'ArrowLeft') { this.wizardPrev(); }
  },

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

  async applyAnswer(qId, opt) { await this.store.applyAnswer(qId, opt); this.render(); },
  wizardNext() {
    const answers = this.store.currentAnswers();
    const visible = this.store.visibleQuestions(answers);
    if (this.store.state.wizardStep >= visible.length - 1) this.finishSurvey();
    else { this.store.wizardNext(); this.render(); }
  },
  wizardPrev() { this.store.wizardPrev(); this.render(); },
  async finishSurvey() { await this.store.saveAndAdvance(); this.render(); },
  goTo(idx) { this.store.goTo(idx); this.render(); },
  async deleteCurrent() { await this.store.deleteCurrent(); this.render(); },

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
      const canvas = document.getElementById(`chart-${i}`);
      if (canvas) { try { if (y > 210) { doc.addPage(); y = 18; } doc.addImage(canvas.toDataURL('image/png'), 'PNG', 14, y, 100, 55); y += 60; } catch (e) {} }
      y += 3;
    });
    doc.save('analisis-encuesta.pdf');
  }
};

App.init();
