const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 4173;
const dbPath = path.join(os.tmpdir(), `analizador-test-server-${process.pid}.sqlite`);
for (const ext of ['', '-shm', '-wal']) {
  try { fs.unlinkSync(dbPath + ext); } catch {}
}

const serverEntry = path.join(__dirname, '..', 'server', 'index.js');
const child = spawn(process.execPath, [serverEntry], {
  cwd: path.join(__dirname, '..'),
  env: { ...process.env, PORT: String(PORT), DB_PATH: dbPath },
  stdio: ['ignore', 'pipe', 'pipe']
});

let serverOutput = '';
child.stdout.on('data', chunk => { serverOutput += chunk; });
child.stderr.on('data', chunk => { serverOutput += chunk; });

function cleanup() {
  child.kill();
  for (const ext of ['', '-shm', '-wal']) {
    try { fs.unlinkSync(dbPath + ext); } catch {}
  }
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
    const res = await waitForServer(`http://localhost:${PORT}/api/config`);
    assert.strictEqual(res.status, 200, `se esperaba status 200, se obtuvo ${res.status}`);

    const body = await res.json();
    assert.ok(typeof body.target === 'number', 'la respuesta de /api/config debe incluir "target" numérico');

    console.log('server.test.js: OK — el servidor arranca y responde en /api/config');
  } catch (err) {
    console.error('server.test.js: FALLÓ');
    console.error(err);
    process.exitCode = 1;
  } finally {
    cleanup();
  }
})();
