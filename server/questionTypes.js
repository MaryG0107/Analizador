/**
 * QuestionType hierarchy — Open/Closed principle.
 * Adding a new question type (e.g. a 1-5 Likert scale) means adding a new
 * subclass and registering it below. No other file needs to change.
 */
class QuestionType {
  constructor(key, label, chartKind, isMultiSelect) {
    this.key = key;
    this.label = label;
    this.chartKind = chartKind; // 'bar' | 'doughnut'
    this.isMultiSelect = isMultiSelect;
  }
  detect(_text, _options) { return false; }
  normalizeOptions(options) { return options; }
}

class YesNoQuestionType extends QuestionType {
  constructor() { super('yesno', 'Si / No', 'doughnut', false); }
  detect(_text, options) { return options.length === 2 && options.every(o => /^s[ií]$|^no$/i.test(o)); }
  normalizeOptions() { return ['Sí', 'No']; }
}

class MultiQuestionType extends QuestionType {
  constructor() { super('multi', 'Multiple (varias opciones)', 'bar', true); }
  detect(text) { return /puede marcar m[aá]s de una|marque todas|seleccione todas|marca todas/i.test(text); }
}

class McQuestionType extends QuestionType {
  constructor() { super('mc', 'Opcion multiple', 'bar', false); }
  detect() { return false; } // fallback type
}

class QuestionTypeRegistry {
  constructor(types) { this.types = types; }
  get(key) { return this.types.find(t => t.key === key) || this.types.find(t => t.key === 'mc'); }
  all() { return this.types; }
  detect(text, options) {
    const match = this.types.find(t => t.detect(text, options));
    return match ? match.key : 'mc';
  }
}

const QUESTION_TYPES = new QuestionTypeRegistry([
  new YesNoQuestionType(),
  new MultiQuestionType(),
  new McQuestionType()
]);

module.exports = { QuestionType, YesNoQuestionType, MultiQuestionType, McQuestionType, QuestionTypeRegistry, QUESTION_TYPES };
