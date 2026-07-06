// 멀티플레이 로비: 방 생성/참가/비밀방/방장 모드 변경 (in-memory, DB 미사용 — 휘발성 상태)
const { Server } = require("socket.io");

const MODES = [
  { id: "spot", label: "다른그림찾기" },
  { id: "speed", label: "스피드타자" },
  { id: "word", label: "끝말잇기" },
  { id: "quiz", label: "상식퀴즈" },
];
const MODE_IDS = new Set(MODES.map((m) => m.id));
const DEFAULT_MODE = MODES[0].id;

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 8;
const NAME_MAX_LEN = 24;
const ROOM_NAME_MAX_LEN = 40;
const CHAT_MAX_LEN = 300;
const CHAT_HISTORY_LIMIT = 200;

function sanitize(s, maxLen) {
  return String(s == null ? "" : s).trim().slice(0, maxLen);
}

function makeRoomId() {
  return Math.random().toString(36).slice(2, 8);
}

function attachRealtime(server) {
  const io = new Server(server, { path: "/socket.io" });

  /** roomId -> room */
  const rooms = new Map();
  const chatHistory = [];

  const publicRoom = (room) => ({
    id: room.id,
    name: room.name,
    mode: room.mode,
    hostName: room.hostName,
    locked: !!room.password,
    cur: room.players.length,
    max: room.maxPlayers,
    state: room.state,
  });

  const roomState = (room) => ({
    id: room.id,
    name: room.name,
    mode: room.mode,
    locked: !!room.password,
    maxPlayers: room.maxPlayers,
    state: room.state,
    hostId: room.hostId,
    players: room.players.map((p) => ({ id: p.id, name: p.name, ready: !!p.ready })),
  });

  const broadcastRoomList = () => io.emit("rooms:update", Array.from(rooms.values()).map(publicRoom));
  const broadcastRoomState = (room) => io.to(room.id).emit("room:state", roomState(room));
  const roomSystemMessage = (room, text) => io.to(room.id).emit("room:chat", { sys: true, text, ts: Date.now() });

  function leaveRoom(socket) {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    const room = rooms.get(roomId);
    socket.data.roomId = null;
    socket.leave(roomId);
    if (!room) return;

    room.players = room.players.filter((p) => p.id !== socket.id);
    if (room.players.length === 0) {
      rooms.delete(roomId);
      broadcastRoomList();
      return;
    }
    if (room.hostId === socket.id) {
      room.hostId = room.players[0].id;
      room.hostName = room.players[0].name;
      roomSystemMessage(room, `${room.players[0].name}님이 방장이 되었습니다.`);
    }
    roomSystemMessage(room, `${socket.data.name}님이 퇴장했습니다.`);
    broadcastRoomState(room);
    broadcastRoomList();
  }

  io.on("connection", (socket) => {
    socket.data.name = "손님" + Math.floor(1000 + Math.random() * 9000);
    socket.data.roomId = null;

    socket.emit("modes", MODES);
    socket.emit("chat:history", chatHistory.slice(-50));
    socket.emit("rooms:update", Array.from(rooms.values()).map(publicRoom));

    socket.on("identify", (name) => {
      socket.data.name = sanitize(name, NAME_MAX_LEN) || socket.data.name;
    });

    socket.on("chat:message", (text) => {
      const clean = sanitize(text, CHAT_MAX_LEN);
      if (!clean) return;
      const msg = { user: socket.data.name, text: clean, ts: Date.now() };
      chatHistory.push(msg);
      if (chatHistory.length > CHAT_HISTORY_LIMIT) chatHistory.shift();
      io.emit("chat:message", msg);
    });

    socket.on("room:create", (payload, cb) => {
      cb = typeof cb === "function" ? cb : () => {};
      const name = sanitize(payload && payload.name, ROOM_NAME_MAX_LEN);
      if (!name) return cb({ ok: false, message: "방 이름을 입력해주세요." });

      const mode = MODE_IDS.has(payload && payload.mode) ? payload.mode : DEFAULT_MODE;
      const maxPlayers = Math.min(MAX_PLAYERS, Math.max(MIN_PLAYERS, parseInt(payload && payload.maxPlayers, 10) || 6));
      const isPrivate = !!(payload && payload.private);
      const password = isPrivate ? sanitize(payload && payload.password, 32) : "";
      if (isPrivate && !password) return cb({ ok: false, message: "비밀방은 비밀번호를 입력해주세요." });

      leaveRoom(socket);

      const room = {
        id: makeRoomId(),
        name,
        mode,
        password,
        maxPlayers,
        state: "wait",
        hostId: socket.id,
        hostName: socket.data.name,
        players: [{ id: socket.id, name: socket.data.name, ready: true }],
      };
      rooms.set(room.id, room);
      socket.join(room.id);
      socket.data.roomId = room.id;

      broadcastRoomList();
      cb({ ok: true, room: roomState(room) });
    });

    socket.on("room:join", (payload, cb) => {
      cb = typeof cb === "function" ? cb : () => {};
      const room = rooms.get(payload && payload.roomId);
      if (!room) return cb({ ok: false, message: "존재하지 않는 방입니다." });
      if (room.players.length >= room.maxPlayers) return cb({ ok: false, message: "방 인원이 가득 찼습니다." });
      if (room.password && room.password !== sanitize(payload && payload.password, 32)) {
        return cb({ ok: false, message: "비밀번호가 올바르지 않습니다." });
      }

      leaveRoom(socket);

      room.players.push({ id: socket.id, name: socket.data.name, ready: false });
      socket.join(room.id);
      socket.data.roomId = room.id;

      roomSystemMessage(room, `${socket.data.name}님이 입장했습니다.`);
      broadcastRoomState(room);
      broadcastRoomList();
      cb({ ok: true, room: roomState(room) });
    });

    socket.on("room:leave", (cb) => {
      leaveRoom(socket);
      if (typeof cb === "function") cb({ ok: true });
    });

    socket.on("room:setMode", (mode) => {
      const room = rooms.get(socket.data.roomId);
      if (!room || room.hostId !== socket.id || !MODE_IDS.has(mode)) return;
      room.mode = mode;
      const label = MODES.find((m) => m.id === mode).label;
      roomSystemMessage(room, `방장이 게임 모드를 "${label}"(으)로 변경했습니다.`);
      broadcastRoomState(room);
      broadcastRoomList();
    });

    socket.on("room:ready", () => {
      const room = rooms.get(socket.data.roomId);
      if (!room || room.hostId === socket.id) return; // 방장은 준비 토글 없음
      const me = room.players.find((p) => p.id === socket.id);
      if (!me) return;
      me.ready = !me.ready;
      broadcastRoomState(room);
    });

    socket.on("room:start", () => {
      const room = rooms.get(socket.data.roomId);
      if (!room || room.hostId !== socket.id) return;
      if (room.state === "wait") {
        const allReady = room.players.every((p) => p.id === room.hostId || p.ready);
        if (!allReady) {
          socket.emit("room:notice", "아직 준비하지 않은 참가자가 있습니다.");
          return;
        }
        room.state = "play";
      } else {
        room.state = "wait";
      }
      roomSystemMessage(room, room.state === "play" ? "게임이 시작되었습니다." : "대기실로 돌아왔습니다.");
      broadcastRoomState(room);
      broadcastRoomList();
    });

    socket.on("room:chat", (text) => {
      const room = rooms.get(socket.data.roomId);
      if (!room) return;
      const clean = sanitize(text, CHAT_MAX_LEN);
      if (!clean) return;
      io.to(room.id).emit("room:chat", { user: socket.data.name, text: clean, ts: Date.now() });
    });

    socket.on("disconnect", () => leaveRoom(socket));
  });

  return io;
}

module.exports = { attachRealtime, MODES };
