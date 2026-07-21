const crypto = require('crypto');

function uid() { return crypto.randomBytes(4).toString('hex'); }

/**
 * DocxQuestionParser — single responsibility: turn raw text extracted from
 * a .docx into structured question objects. Detects:
 *  - questions: any line containing "¿...?"
 *  - options: lines marked with the ☐ checkbox glyph
 *  - conditional/dependent questions: lines starting with
 *    "Si su respuesta es Sí/No..." are linked to the immediately preceding
 *    question via `dependsOn = { questionId, answer }`.
 */
class DocxQuestionParser {
  constructor(registry) {
    this.registry = registry;
    this.CHECKBOX = '☐';
    this.CONDITION_RE = /^si\s+(su\s+respuesta\s+es|respondi[oó]|contest[oó])\s+(s[ií]|no)(?=[,\s.]|$)/i;
  }

  parse(rawText) {
    const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);
    const drafts = [];
    let current = null;
    const flush = () => { if (current && current.text) drafts.push(current); current = null; };

    for (const line of lines) {
      if (line.includes(this.CHECKBOX)) {
        if (!current) continue;
        const opts = line.split(this.CHECKBOX).map(s => s.trim()).filter(o => o.length > 1);
        current.rawOptions.push(...opts);
      } else if (line.includes('?')) {
        const conditionMatch = line.match(this.CONDITION_RE);
        flush();
        const dependsOn = (conditionMatch && drafts.length)
          ? { questionId: drafts[drafts.length - 1].id, answer: /^s/i.test(conditionMatch[2]) ? 'Sí' : 'No' }
          : null;
        current = { id: uid(), text: this.extractQuestionSentence(line), rawOptions: [], dependsOn };
      } else if (current && current.rawOptions.length === 0) {
        current.text += ' ' + line;
      }
    }
    flush();
    return drafts.map(d => this.finalize(d));
  }

  extractQuestionSentence(line) {
    const match = line.match(/¿[^?]*\?/);
    return (match ? match[0] : line).trim();
  }

  finalize(draft) {
    const options = [...new Set(draft.rawOptions)];
    const typeKey = this.registry.detect(draft.text, options);
    const type = this.registry.get(typeKey);
    return {
      id: draft.id,
      text: draft.text.replace(/\s+/g, ' ').trim(),
      type: typeKey,
      options: type.normalizeOptions(options),
      dependsOn: draft.dependsOn
    };
  }
}

module.exports = { DocxQuestionParser, uid };
