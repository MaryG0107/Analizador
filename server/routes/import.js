const express = require('express');
const multer = require('multer');
const mammoth = require('mammoth');
const { DocxQuestionParser } = require('../parser');
const { QUESTION_TYPES } = require('../questionTypes');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

module.exports = function importRouter() {
  const router = express.Router();
  const parser = new DocxQuestionParser(QUESTION_TYPES);

  router.post('/', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'file is required (field name: file)' });
    try {
      const result = await mammoth.extractRawText({ buffer: req.file.buffer });
      const questions = parser.parse(result.value);
      res.json({ questions });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'No se pudo leer el documento .docx' });
    }
  });

  return router;
};
