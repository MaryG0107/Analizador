const path = require('path');
const Database = require('better-sqlite3');

const dbPath = path.join(__dirname, '..', 'data.sqlite');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
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
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    answers TEXT NOT NULL DEFAULT '{}'
  );

  CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT
  );
`);

/* ---------------------------- Questions ---------------------------------- */
function listQuestions() {
  return db.prepare('SELECT * FROM questions ORDER BY position ASC').all().map(rowToQuestion);
}

function insertQuestion(q) {
  const position = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM questions').get().p;
  db.prepare('INSERT INTO questions (id, text, type, options, depends_on, position) VALUES (?, ?, ?, ?, ?, ?)')
    .run(q.id, q.text, q.type, JSON.stringify(q.options), q.dependsOn ? JSON.stringify(q.dependsOn) : null, position);
  return getQuestion(q.id);
}

function insertQuestionsBulk(questions) {
  const tx = db.transaction(qs => qs.map(q => insertQuestion(q)));
  return tx(questions);
}

function getQuestion(id) {
  const row = db.prepare('SELECT * FROM questions WHERE id = ?').get(id);
  return row ? rowToQuestion(row) : null;
}

function updateQuestion(id, fields) {
  const existing = getQuestion(id);
  if (!existing) return null;
  const merged = { ...existing, ...fields };
  db.prepare('UPDATE questions SET text = ?, type = ?, options = ? WHERE id = ?')
    .run(merged.text, merged.type, JSON.stringify(merged.options), id);
  return getQuestion(id);
}

function deleteQuestion(id) {
  db.prepare('DELETE FROM questions WHERE id = ?').run(id);
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
function listResponses() {
  return db.prepare('SELECT * FROM responses ORDER BY rowid ASC').all().map(rowToResponse);
}

function getResponse(id) {
  const row = db.prepare('SELECT * FROM responses WHERE id = ?').get(id);
  return row ? rowToResponse(row) : null;
}

function insertResponse(id, answers) {
  db.prepare('INSERT INTO responses (id, answers) VALUES (?, ?)').run(id, JSON.stringify(answers || {}));
  return getResponse(id);
}

function updateResponse(id, answers) {
  const existing = getResponse(id);
  if (!existing) return null;
  db.prepare('UPDATE responses SET answers = ? WHERE id = ?').run(JSON.stringify(answers), id);
  return getResponse(id);
}

function deleteResponse(id) {
  db.prepare('DELETE FROM responses WHERE id = ?').run(id);
}

function rowToResponse(row) {
  return { id: row.id, createdAt: row.created_at, answers: JSON.parse(row.answers) };
}

/* ---------------------------- Config --------------------------------------- */
function getConfig(key, fallback) {
  const row = db.prepare('SELECT value FROM config WHERE key = ?').get(key);
  return row ? JSON.parse(row.value) : fallback;
}

function setConfig(key, value) {
  db.prepare('INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, JSON.stringify(value));
}

module.exports = {
  listQuestions, insertQuestion, insertQuestionsBulk, getQuestion, updateQuestion, deleteQuestion,
  listResponses, getResponse, insertResponse, updateResponse, deleteResponse,
  getConfig, setConfig
};
