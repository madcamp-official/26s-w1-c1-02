// 임시 부하 테스트: N개의 동시 socket.io 연결 + 주기적 로비 채팅 브로드캐스트
const { io } = require('socket.io-client');
const N = parseInt(process.argv[2] || '50', 10);
const URL = process.argv[3] || 'http://localhost:8080';
let open = 0, recv = 0;
const clients = [];

for (let i = 0; i < N; i++) {
  const socket = io(URL, { path: '/socket.io' });
  socket.on('connect', () => {
    open++;
    socket.emit('identify', 'load' + i);
    setInterval(() => {
      if (socket.connected) socket.emit('chat:message', 'msg ' + Date.now());
    }, 1000);
  });
  socket.on('chat:message', () => { recv++; });
  socket.on('connect_error', () => {});
  clients.push(socket);
}

setTimeout(() => {
  console.log(`connections_open=${open}/${N}  messages_received=${recv}`);
  process.exit(0);
}, 6000);
