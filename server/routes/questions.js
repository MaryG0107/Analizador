const express = require('express');
const db = require('../db');
const { uid } = require('../parser');
const { QUESTION_TYPES } = require('../questionTypes');

module.exports = function questionsRouter(io) {
  const router = express.Router();

  router.get('/', (req, res) => {
    res.json(db.listQuestions());
  });

  router.post('/', (req, res) => {
    const { text, type, options } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: 'text is required' });
    const questionType = QUESTION_TYPES.get(type || 'mc');
    const question = {
      id: uid(),
      text: text.trim(),
      type: questionType.key,
      options: questionType.normalizeOptions(options || []),
      dependsOn: null
    };
    const saved = db.insertQuestion(question);
    io.emit('questions:changed');
    res.status(201).json(saved);
  });

  router.post('/bulk', (req, res) => {
    const { questions } = req.body;
    if (!Array.isArray(questions)) return res.status(400).json({ error: 'questions must be an array' });
    const saved = db.insertQuestionsBulk(questions);
    io.emit('questions:changed');
    res.status(201).json(saved);
  });

  router.put('/:id', (req, res) => {
    const { type, options } = req.body;
    const questionType = type ? QUESTION_TYPES.get(type) : null;
    const fields = {};
    if (type) fields.type = questionType.key;
    if (options) fields.options = questionType ? questionType.normalizeOptions(options) : options;
    const updated = db.updateQuestion(req.params.id, fields);
    if (!updated) return res.status(404).json({ error: 'not found' });
    io.emit('questions:changed');
    res.json(updated);
  });

  router.delete('/:id', (req, res) => {
    db.deleteQuestion(req.params.id);
    io.emit('questions:changed');
    res.status(204).end();
  });

  return router;
};
