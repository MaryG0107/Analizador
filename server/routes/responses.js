const express = require('express');
const db = require('../db');
const { uid } = require('../parser');

module.exports = function responsesRouter(io) {
  const router = express.Router();

  router.get('/', (req, res) => {
    res.json(db.listResponses());
  });

  router.post('/', (req, res) => {
    const saved = db.insertResponse(uid(), req.body.answers || {});
    io.emit('responses:changed', { reason: 'created', id: saved.id });
    res.status(201).json(saved);
  });

  router.put('/:id', (req, res) => {
    const updated = db.updateResponse(req.params.id, req.body.answers || {});
    if (!updated) return res.status(404).json({ error: 'not found' });
    io.emit('responses:changed', { reason: 'updated', id: updated.id });
    res.json(updated);
  });

  router.delete('/:id', (req, res) => {
    db.deleteResponse(req.params.id);
    io.emit('responses:changed', { reason: 'deleted', id: req.params.id });
    res.status(204).end();
  });

  return router;
};
