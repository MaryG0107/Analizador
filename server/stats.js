function isApplicable(question, answers) {
  if (!question.dependsOn) return true;
  return answers[question.dependsOn.questionId] === question.dependsOn.answer;
}

function questionStats(question, responses) {
  const counts = {};
  (question.options || []).forEach(o => (counts[o] = 0));
  let applicable = 0;
  let answered = 0;
  responses.forEach(r => {
    if (!isApplicable(question, r.answers)) return;
    applicable++;
    const v = r.answers[question.id];
    if (Array.isArray(v)) {
      if (v.length) {
        answered++;
        v.forEach(o => { if (o in counts) counts[o]++; });
      }
    } else if (v) {
      answered++;
      if (v in counts) counts[v]++;
    }
  });
  return { counts, answered, applicable };
}

function conclusionParts(questions, responses) {
  return questions
    .filter(q => q.options && q.options.length >= 2)
    .map(q => {
      const { counts, answered, applicable } = questionStats(q, responses);
      const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
      const topPct = answered ? Math.round((top[1] / answered) * 100) : 0;
      return { q, top, topPct, answered, applicable, counts };
    });
}

function conclusionLines(parts, total) {
  const strong = parts.filter(p => p.topPct >= 70);
  const split = parts.filter(p => p.topPct < 55);
  const lines = [`Se analizaron ${total} encuestas sobre ${parts.length} preguntas.`];
  if (strong.length > 0) {
    lines.push('Hay consenso claro en: ' + strong.map(p => `${p.q.text} (${p.topPct}% respondio "${p.top[0]}")`).join('; ') + '.');
  }
  if (split.length > 0) {
    lines.push('Las respuestas estan mas divididas en: ' + split.map(p => p.q.text).join(', ') + ', lo que sugiere opiniones variadas.');
  }
  if (strong.length === 0 && split.length === 0) {
    lines.push('En general las respuestas muestran una tendencia moderada, sin consenso extremo ni division marcada.');
  }
  return lines;
}

module.exports = { isApplicable, questionStats, conclusionParts, conclusionLines };
