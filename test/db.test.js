require('dotenv').config();
const assert = require('assert');
const { Pool } = require('pg');

const testSchema = `test_db_${process.pid}`;
process.env.DB_SCHEMA = testSchema;

const db = require('../server/db');

async function cleanup() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  await pool.query(`DROP SCHEMA IF EXISTS "${testSchema}" CASCADE`);
  await pool.end();
  await db.close();
}

(async () => {
  try {
    const question = await db.insertQuestion({
      id: 'q1',
      text: '¿Cuál es tu color favorito?',
      type: 'text',
      options: [],
      dependsOn: null
    });
    assert.strictEqual(question.text, '¿Cuál es tu color favorito?');

    const fetchedQuestion = await db.getQuestion('q1');
    assert.ok(fetchedQuestion, 'la pregunta insertada debe poder leerse');
    assert.strictEqual(fetchedQuestion.id, 'q1');

    const questions = await db.listQuestions();
    assert.strictEqual(questions.length, 1);

    const response = await db.insertResponse('r1', { q1: 'Azul' });
    assert.strictEqual(response.answers.q1, 'Azul');

    const fetchedResponse = await db.getResponse('r1');
    assert.ok(fetchedResponse, 'la respuesta insertada debe poder leerse');
    assert.strictEqual(fetchedResponse.answers.q1, 'Azul');

    const responses = await db.listResponses();
    assert.strictEqual(responses.length, 1);

    console.log('db.test.js: OK — preguntas y respuestas se guardan y leen correctamente en Postgres');
  } catch (err) {
    console.error('db.test.js: FALLÓ');
    console.error(err);
    process.exitCode = 1;
  } finally {
    await cleanup();
  }
})();
