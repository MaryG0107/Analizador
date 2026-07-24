require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const http = require('http');
const session = require('express-session');
const { Server } = require('socket.io');
const db = require('./db');
const asyncHandler = require('./asyncHandler');
const { checkCredentials, requireAuth } = require('./auth');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 12 } // 12h
});

app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(sessionMiddleware);
app.use(express.static(path.join(__dirname, '..', 'public')));

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!checkCredentials(username, password)) return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
  req.session.authenticated = true;
  res.json({ authenticated: true });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.status(204).end());
});

app.get('/api/session', (req, res) => {
  res.json({ authenticated: !!(req.session && req.session.authenticated) });
});

app.use('/api/questions', requireAuth, require('./routes/questions')(io));
app.use('/api/responses', requireAuth, require('./routes/responses')(io));
app.use('/api/import', requireAuth, require('./routes/import')());
app.use('/api/export', requireAuth, require('./routes/export')());

app.get('/api/config', requireAuth, asyncHandler(async (req, res) => {
  res.json({ target: await db.getConfig('target', 100) });
}));

app.put('/api/config', requireAuth, asyncHandler(async (req, res) => {
  if (typeof req.body.target === 'number') await db.setConfig('target', req.body.target);
  io.emit('config:changed');
  res.json({ target: await db.getConfig('target', 100) });
}));

io.engine.use(sessionMiddleware);
io.on('connection', socket => {
  if (!socket.request.session || !socket.request.session.authenticated) {
    socket.disconnect(true);
    return;
  }
  socket.emit('connected', { message: 'Conectado al servidor de encuestas en tiempo real' });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Analizador de encuestas escuchando en http://localhost:${PORT}`);
});
