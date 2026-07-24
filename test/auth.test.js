require('dotenv').config();
const assert = require('assert');
const path = require('path');
const { spawn } = require('child_process');
const { Pool } = require('pg');

const PORT = 4174;
const testSchema = `test_auth_${process.pid}`;
const TEST_USER = 'test_admin';
const TEST_PASS = 'test_pass_ac9f3e';

const serverEntry = path.join(__dirname, '..', 'server', 'index.js');
const child = spawn(process.execPath, [serverEntry], {
  cwd: path.join(__dirname, '..'),
  env: {
    ...process.env,
    PORT: String(PORT),
    DB_SCHEMA: testSchema,
    ADMIN_USER: TEST_USER,
    ADMIN_PASSWORD: TEST_PASS,
    SESSION_SECRET: 'test_session_secret'
  },
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

function extractCookie(res) {
  const raw = res.headers.get('set-cookie') || '';
  return raw.split(';')[0];
}

(async () => {
  try {
    const base = `http://localhost:${PORT}`;

    const noAuth = await waitForServer(`${base}/api/config`);
    assert.strictEqual(noAuth.status, 401, `sin sesión se esperaba 401, se obtuvo ${noAuth.status}`);

    const badLogin = await fetch(`${base}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: TEST_USER, password: 'wrong-password' })
    });
    assert.strictEqual(badLogin.status, 401, `login incorrecto se esperaba 401, se obtuvo ${badLogin.status}`);

    const goodLogin = await fetch(`${base}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: TEST_USER, password: TEST_PASS })
    });
    assert.strictEqual(goodLogin.status, 200, `login correcto se esperaba 200, se obtuvo ${goodLogin.status}`);
    const cookie = extractCookie(goodLogin);
    assert.ok(cookie, 'se esperaba una cookie de sesión tras el login');

    const authed = await fetch(`${base}/api/config`, { headers: { Cookie: cookie } });
    assert.strictEqual(authed.status, 200, `con sesión válida se esperaba 200, se obtuvo ${authed.status}`);

    const logout = await fetch(`${base}/api/logout`, { method: 'POST', headers: { Cookie: cookie } });
    assert.strictEqual(logout.status, 204, `logout se esperaba 204, se obtuvo ${logout.status}`);

    const afterLogout = await fetch(`${base}/api/config`, { headers: { Cookie: cookie } });
    assert.strictEqual(afterLogout.status, 401, `tras logout se esperaba 401, se obtuvo ${afterLogout.status}`);

    console.log('auth.test.js: OK — los endpoints rechazan accesos sin sesión y aceptan sólo credenciales válidas');
  } catch (err) {
    console.error('auth.test.js: FALLÓ');
    console.error(err);
    process.exitCode = 1;
  } finally {
    await cleanup();
  }
})();
