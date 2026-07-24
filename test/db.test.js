const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dbPath = path.join(os.tmpdir(), `analizador-test-${process.pid}.sqlite`);
for (const ext of ['', '-shm', '-wal']) {
  try { fs.unlinkSync(dbPath + ext); } catch {}
}
process.env.DB_PATH = dbPath;

const db = require('../server/db');

function cleanup() {
  for (const ext of ['', '-shm', '-wal']) {
    try { fs.unlinkSync(dbPath + ext); } catch {}
  }
}

try {
  const question = db.insertQuestion({
    id: 'q1',
    text: '¿Cuál es tu color favorito?',
    type: 'text',
    options: [],
    dependsOn: null
  });
  assert.strictEqual(question.text, '¿Cuál es tu color favorito?');

  const fetchedQuestion = db.getQuestion('q1');
  assert.ok(fetchedQuestion, 'la pregunta insertada debe poder leerse');
  assert.strictEqual(fetchedQuestion.id, 'q1');

  const questions = db.listQuestions();
  assert.strictEqual(questions.length, 1);

  const response = db.insertResponse('r1', { q1: 'Azul' });
  assert.strictEqual(response.answers.q1, 'Azul');

  const fetchedResponse = db.getResponse('r1');
  assert.ok(fetchedResponse, 'la respuesta insertada debe poder leerse');
  assert.strictEqual(fetchedResponse.answers.q1, 'Azul');

  const responses = db.listResponses();
  assert.strictEqual(responses.length, 1);

  console.log('db.test.js: OK — preguntas y respuestas se guardan y leen correctamente');
} finally {
  cleanup();
}
