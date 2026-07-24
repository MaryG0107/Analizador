require('dotenv').config();
const assert = require('assert');
const path = require('path');
const { spawn } = require('child_process');
const { Pool } = require('pg');

const PORT = 4173;
const testSchema = `test_server_${process.pid}`;

const serverEntry = path.join(__dirname, '..', 'server', 'index.js');
const child = spawn(process.execPath, [serverEntry], {
  cwd: path.join(__dirname, '..'),
  env: { ...process.env, PORT: String(PORT), DB_SCHEMA: testSchema },
  stdio: ['ignore', 'pipe', 'pipe']
});

let serverOutput = '';
child.stdout.on('data', chunk => { serverOutput += chunk; });
child.stderr.on('data', chunk => { serverOutput += chunk; });

async function cleanup() {
  child.kill();
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  await pool.query(`DROP SCHEMA IF EXISTS "${testSchema}" CASCADE`);
  await pool.end();
}

async function waitForServer(url, attempts = 30, delayMs = 250) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url);
      return res;
    } catch {
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  throw new Error(`El servidor no respondió después de ${attempts} intentos.\nSalida del proceso:\n${serverOutput}`);
}

(async () => {
  try {
    const res = await waitForServer(`http://localhost:${PORT}/api/session`);
    assert.strictEqual(res.status, 200, `se esperaba status 200, se obtuvo ${res.status}`);

    const body = await res.json();
    assert.strictEqual(body.authenticated, false, 'sin haber iniciado sesión, /api/session debe indicar authenticated:false');

    console.log('server.test.js: OK — el servidor arranca y responde en /api/session');
  } catch (err) {
    console.error('server.test.js: FALLÓ');
    console.error(err);
    process.exitCode = 1;
  } finally {
    await cleanup();
  }
})();
