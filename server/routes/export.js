const express = require('express');
const XLSX = require('xlsx');
const db = require('../db');
const stats = require('../stats');
const asyncHandler = require('../asyncHandler');

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtAnswer(v) { return Array.isArray(v) ? v.join(' | ') : (v || ''); }

module.exports = function exportRouter() {
  const router = express.Router();

  router.get('/csv', asyncHandler(async (req, res) => {
    const questions = (await db.listQuestions()).filter(q => q.options && q.options.length >= 2);
    const responses = await db.listResponses();
    const headers = ['encuesta', ...questions.map(q => q.text)];
    const rows = responses.map((r, i) => [i + 1, ...questions.map(q => fmtAnswer(r.answers[q.id]))]);
    const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="respuestas-encuesta.csv"');
    res.send(csv);
  }));

  router.get('/excel', asyncHandler(async (req, res) => {
    const questions = (await db.listQuestions()).filter(q => q.options && q.options.length >= 2);
    const responses = await db.listResponses();
    const rawData = [['Encuesta', ...questions.map(q => q.text)]];
    responses.forEach((r, i) => rawData.push([i + 1, ...questions.map(q => fmtAnswer(r.answers[q.id]))]));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rawData), 'Respuestas');

    const summaryData = [['Pregunta', 'Opcion', 'Conteo', 'Porcentaje']];
    questions.forEach(q => {
      const { counts, answered } = stats.questionStats(q, responses);
      Object.entries(counts).forEach(([opt, count]) => {
        summaryData.push([q.text, opt, count, (answered ? Math.round((count / answered) * 100) : 0) + '%']);
      });
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryData), 'Resumen');

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="analisis-encuesta.xlsx"');
    res.send(buffer);
  }));

  router.get('/word', asyncHandler(async (req, res) => {
    const questions = (await db.listQuestions()).filter(q => q.options && q.options.length >= 2);
    const responses = await db.listResponses();
    const parts = stats.conclusionParts(questions, responses);
    const lines = stats.conclusionLines(parts, responses.length);

    let html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
    <head><meta charset="utf-8"><title>Analisis de encuesta</title></head>
    <body style="font-family:Calibri, Arial, sans-serif;">
    <h1>Analisis de encuesta</h1><p><i>${new Date().toLocaleDateString()}</i></p>
    <h2>Conclusion general</h2>${lines.map(l => `<p>${escapeHtml(l)}</p>`).join('')}`;
    parts.forEach(p => {
      html += `<h3>${escapeHtml(p.q.text)}</h3><table border="1" cellspacing="0" cellpadding="5" style="border-collapse:collapse;width:100%;"><tr><th align="left">Opcion</th><th align="left">Conteo</th><th align="left">Porcentaje</th></tr>`;
      Object.entries(p.counts).forEach(([opt, count]) => {
        const pct = p.answered ? Math.round((count / p.answered) * 100) : 0;
        html += `<tr><td>${escapeHtml(opt)}</td><td>${count}</td><td>${pct}%</td></tr>`;
      });
      html += `</table><br/>`;
    });
    html += `</body></html>`;

    res.setHeader('Content-Type', 'application/msword');
    res.setHeader('Content-Disposition', 'attachment; filename="analisis-encuesta.doc"');
    res.send(html);
  }));

  // PDF is generated client-side (it embeds the live chart canvases, which only exist in the browser).
  return router;
};
