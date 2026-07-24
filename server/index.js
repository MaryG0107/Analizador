require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const db = require('./db');
const asyncHandler = require('./asyncHandler');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/api/questions', require('./routes/questions')(io));
app.use('/api/responses', require('./routes/responses')(io));
app.use('/api/import', require('./routes/import')());
app.use('/api/export', require('./routes/export')());

app.get('/api/config', asyncHandler(async (req, res) => {
  res.json({ target: await db.getConfig('target', 100) });
}));

app.put('/api/config', asyncHandler(async (req, res) => {
  if (typeof req.body.target === 'number') await db.setConfig('target', req.body.target);
  io.emit('config:changed');
  res.json({ target: await db.getConfig('target', 100) });
}));

io.on('connection', socket => {
  socket.emit('connected', { message: 'Conectado al servidor de encuestas en tiempo real' });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Analizador de encuestas escuchando en http://localhost:${PORT}`);
});
