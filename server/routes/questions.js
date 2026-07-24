const express = require('express');
const db = require('../db');
const { uid } = require('../parser');
const { QUESTION_TYPES } = require('../questionTypes');
const asyncHandler = require('../asyncHandler');

module.exports = function questionsRouter(io) {
  const router = express.Router();

  router.get('/', asyncHandler(async (req, res) => {
    res.json(await db.listQuestions());
  }));

  router.post('/', asyncHandler(async (req, res) => {
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
    const saved = await db.insertQuestion(question);
    io.emit('questions:changed');
    res.status(201).json(saved);
  }));

  router.post('/bulk', asyncHandler(async (req, res) => {
    const { questions } = req.body;
    if (!Array.isArray(questions)) return res.status(400).json({ error: 'questions must be an array' });
    const saved = await db.insertQuestionsBulk(questions);
    io.emit('questions:changed');
    res.status(201).json(saved);
  }));

  router.put('/:id', asyncHandler(async (req, res) => {
    const { type, options } = req.body;
    const questionType = type ? QUESTION_TYPES.get(type) : null;
    const fields = {};
    if (type) fields.type = questionType.key;
    if (options) fields.options = questionType ? questionType.normalizeOptions(options) : options;
    const updated = await db.updateQuestion(req.params.id, fields);
    if (!updated) return res.status(404).json({ error: 'not found' });
    io.emit('questions:changed');
    res.json(updated);
  }));

  router.delete('/:id', asyncHandler(async (req, res) => {
    await db.deleteQuestion(req.params.id);
    io.emit('questions:changed');
    res.status(204).end();
  }));

  return router;
};
