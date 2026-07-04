// 임시 부하 테스트: N개의 동시 웹소켓 연결 + 주기적 메시지 브로드캐스트
const WebSocket = require('ws');
const N = parseInt(process.argv[2] || '50', 10);
const URL = 'ws://localhost:8080/ws';
let open = 0, recv = 0;
const clients = [];

for (let i = 0; i < N; i++) {
  const ws = new WebSocket(URL);
  ws.on('open', () => {
    open++;
    setInterval(() => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ user: 'load' + i, text: 'msg ' + Date.now() }));
    }, 1000);
  });
  ws.on('message', () => { recv++; });
  ws.on('error', () => {});
  clients.push(ws);
}

setTimeout(() => {
  console.log(`connections_open=${open}/${N}  messages_received=${recv}`);
  process.exit(0);
}, 6000);
