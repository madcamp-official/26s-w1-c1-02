require('dotenv').config();
const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');
const connectDB = require('./db');
const signupRouter = require('./routes/signup');
const loginRouter = require('./routes/login');

const PORT = process.env.PORT || 8080;

connectDB().catch((err) => {
  console.error('MongoDB 연결 실패:', err.message);
});

const app = express();
app.use(express.json());
app.use('/api', signupRouter);
app.use('/api', loginRouter);
app.get('/health', (req, res) => res.status(200).send('ok'));

const server = http.createServer(app);

const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  ws.on('message', (data) => {
    for (const client of wss.clients) {
      if (client.readyState === client.OPEN) {
        client.send(data.toString());
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`websocket server listening on ${PORT}`);
});
