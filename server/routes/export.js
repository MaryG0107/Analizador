const express = require('express');
const db = require('../db');
const asyncHandler = require('../asyncHandler');

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

  // Excel, PDF and Word are generated client-side (they embed the live chart canvases, which only exist in the browser).
  return router;
};
