const { Pool } = require('pg');

const schema = process.env.DB_SCHEMA || 'public';
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  options: `-c search_path=${schema}`
});

async function init() {
  if (schema !== 'public') {
    await pool.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
  }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS questions (
      id TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      type TEXT NOT NULL,
      options TEXT NOT NULL,
      depends_on TEXT,
      position INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS responses (
      id TEXT PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      answers TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);
}

const ready = init();

/* ---------------------------- Questions ---------------------------------- */
async function listQuestions() {
  await ready;
  const { rows } = await pool.query('SELECT * FROM questions ORDER BY position ASC');
  return rows.map(rowToQuestion);
}

async function insertQuestion(q) {
  await ready;
  const { rows: posRows } = await pool.query('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM questions');
  const position = posRows[0].p;
  await pool.query(
    'INSERT INTO questions (id, text, type, options, depends_on, position) VALUES ($1, $2, $3, $4, $5, $6)',
    [q.id, q.text, q.type, JSON.stringify(q.options), q.dependsOn ? JSON.stringify(q.dependsOn) : null, position]
  );
  return getQuestion(q.id);
}

async function insertQuestionsBulk(questions) {
  await ready;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const saved = [];
    for (const q of questions) {
      const { rows: posRows } = await client.query('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM questions');
      const position = posRows[0].p;
      await client.query(
        'INSERT INTO questions (id, text, type, options, depends_on, position) VALUES ($1, $2, $3, $4, $5, $6)',
        [q.id, q.text, q.type, JSON.stringify(q.options), q.dependsOn ? JSON.stringify(q.dependsOn) : null, position]
      );
      const { rows } = await client.query('SELECT * FROM questions WHERE id = $1', [q.id]);
      saved.push(rowToQuestion(rows[0]));
    }
    await client.query('COMMIT');
    return saved;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function getQuestion(id) {
  await ready;
  const { rows } = await pool.query('SELECT * FROM questions WHERE id = $1', [id]);
  return rows[0] ? rowToQuestion(rows[0]) : null;
}

async function updateQuestion(id, fields) {
  await ready;
  const existing = await getQuestion(id);
  if (!existing) return null;
  const merged = { ...existing, ...fields };
  await pool.query(
    'UPDATE questions SET text = $1, type = $2, options = $3 WHERE id = $4',
    [merged.text, merged.type, JSON.stringify(merged.options), id]
  );
  return getQuestion(id);
}

async function deleteQuestion(id) {
  await ready;
  await pool.query('DELETE FROM questions WHERE id = $1', [id]);
}

function rowToQuestion(row) {
  return {
    id: row.id,
    text: row.text,
    type: row.type,
    options: JSON.parse(row.options),
    dependsOn: row.depends_on ? JSON.parse(row.depends_on) : null
  };
}

/* ---------------------------- Responses ----------------------------------- */
async function listResponses() {
  await ready;
  const { rows } = await pool.query('SELECT * FROM responses ORDER BY created_at ASC');
  return rows.map(rowToResponse);
}

async function getResponse(id) {
  await ready;
  const { rows } = await pool.query('SELECT * FROM responses WHERE id = $1', [id]);
  return rows[0] ? rowToResponse(rows[0]) : null;
}

async function insertResponse(id, answers) {
  await ready;
  await pool.query('INSERT INTO responses (id, answers) VALUES ($1, $2)', [id, JSON.stringify(answers || {})]);
  return getResponse(id);
}

async function updateResponse(id, answers) {
  await ready;
  const existing = await getResponse(id);
  if (!existing) return null;
  await pool.query('UPDATE responses SET answers = $1 WHERE id = $2', [JSON.stringify(answers), id]);
  return getResponse(id);
}

async function deleteResponse(id) {
  await ready;
  await pool.query('DELETE FROM responses WHERE id = $1', [id]);
}

function rowToResponse(row) {
  const createdAt = row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at;
  return { id: row.id, createdAt, answers: JSON.parse(row.answers) };
}

/* ---------------------------- Config --------------------------------------- */
async function getConfig(key, fallback) {
  await ready;
  const { rows } = await pool.query('SELECT value FROM config WHERE key = $1', [key]);
  return rows[0] ? JSON.parse(rows[0].value) : fallback;
}

async function setConfig(key, value) {
  await ready;
  await pool.query(
    'INSERT INTO config (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
    [key, JSON.stringify(value)]
  );
}

async function close() {
  await pool.end();
}

module.exports = {
  listQuestions, insertQuestion, insertQuestionsBulk, getQuestion, updateQuestion, deleteQuestion,
  listResponses, getResponse, insertResponse, updateResponse, deleteResponse,
  getConfig, setConfig, close
};
