// 멀티플레이 로비: 방 생성/참가/비밀방/방장 모드 변경 (in-memory, DB 미사용 — 휘발성 상태)
const jwt = require("jsonwebtoken");
const { Server } = require("socket.io");
const { createVowelGame, clampDiff, clampRounds } = require("./games/vowel");
const { createSpotGame } = require("./games/spot");
const { createBaseballGame } = require("./games/baseball");
const { AVATARS } = require("../avatars");
const { getUserLevel } = require("../progress/api");

// identify 시 클라가 보낸 JWT 를 서버에서 검증해 userId 를 얻는다(클라가 보낸 userId 값을 믿지 않음).
// 게스트/만료/위조 토큰은 null → exp 미적립, 레벨 1 로 표시.
function userIdFromToken(token) {
  if (!token) return null;
  try {
    return jwt.verify(token, process.env.JWT_SECRET).userId;
  } catch (e) {
    return null;
  }
}

const DEFAULT_AVATAR = AVATARS[0];

// 실시간 게임 엔진을 구동하는 모드(그 외 모드는 상태 토글만)
const ENGINE_MODES = new Set(["vowel", "spot", "baseball"]);
// 1대1 전용 모드 — 방 인원을 2명으로 고정한다.
const DUEL_MODES = new Set(["baseball"]);

const MODES = [
  { id: "spot", label: "다른그림찾기" },
  { id: "vowel", label: "자음 모음 조합하기" },
  { id: "baseball", label: "숫자야구" },
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

// 방 코드용 문자셋: 생김새가 헷갈리는 0/O, 1/I/L 을 제외
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
function makeRoomId() {
  let id = "";
  for (let i = 0; i < 6; i++) id += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return id;
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
    difficulty: room.difficulty,
    rounds: room.rounds,
  });

  const roomState = (room) => ({
    id: room.id,
    name: room.name,
    mode: room.mode,
    locked: !!room.password,
    maxPlayers: room.maxPlayers,
    state: room.state,
    hostId: room.hostId,
    difficulty: room.difficulty,
    rounds: room.rounds,
    players: room.players.map((p) => ({ id: p.id, name: p.name, avatar: p.avatar, ready: !!p.ready })),
  });

  // 게임 종료 → 방을 대기실로 되돌리고 게임 인스턴스 정리
  function endGame(room) {
    if (room.game) { room.game.dispose(); room.game = null; }
    if (room.state === "play") {
      room.state = "wait";
      broadcastRoomState(room);
      broadcastRoomList();
    }
  }

  // 서버에 실시간 접속 중인 전체 플레이어 목록 (방 참여 여부 무관). level = 종합 레벨(게스트/비로그인은 1)
  const broadcastPresence = () => {
    const users = [];
    for (const s of io.of("/").sockets.values())
      users.push({ id: s.id, name: s.data.name, avatar: s.data.avatar, level: s.data.level || 1 });
    io.emit("presence", users);
  };

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
    if (room.game) room.game.onPlayerLeave(socket.id);
    if (room.players.length === 0) {
      if (room.game) { room.game.dispose(); room.game = null; }
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
    socket.data.avatar = DEFAULT_AVATAR;
    socket.data.roomId = null;
    socket.data.userId = null; // identify(토큰) 전까지는 게스트
    socket.data.level = 1;     // 종합 레벨(로비 접속자 목록 표시용)

    socket.emit("modes", MODES);
    socket.emit("chat:history", chatHistory.slice(-50));
    socket.emit("rooms:update", Array.from(rooms.values()).map(publicRoom));
    broadcastPresence();

    socket.on("identify", async (payload) => {
      const name = typeof payload === "string" ? payload : payload && payload.name;
      const avatar = payload && typeof payload === "object" ? payload.avatar : null;
      const token = payload && typeof payload === "object" ? payload.token : null;
      socket.data.name = sanitize(name, NAME_MAX_LEN) || socket.data.name;
      socket.data.avatar = AVATARS.includes(avatar) ? avatar : socket.data.avatar;
      // 로그인 유저면 종합 레벨을 불러와 접속자 목록에 표시(비로그인/게스트는 1)
      const userId = userIdFromToken(token);
      socket.data.userId = userId;
      socket.data.level = userId ? await getUserLevel(userId) : 1;
      broadcastPresence();
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
      const maxPlayers = DUEL_MODES.has(mode)
        ? 2 // 1대1 전용 모드는 항상 2명 고정
        : Math.min(MAX_PLAYERS, Math.max(MIN_PLAYERS, parseInt(payload && payload.maxPlayers, 10) || 6));
      const isPrivate = !!(payload && payload.private);
      const password = isPrivate ? sanitize(payload && payload.password, 32) : "";
      if (isPrivate && !password) return cb({ ok: false, message: "비밀방은 비밀번호를 입력해주세요." });

      const difficulty = clampDiff(payload && payload.difficulty);
      const rounds = clampRounds(payload && payload.rounds);

      leaveRoom(socket);

      const room = {
        id: makeRoomId(),
        name,
        mode,
        password,
        maxPlayers,
        difficulty,
        rounds,
        state: "wait",
        hostId: socket.id,
        hostName: socket.data.name,
        game: null,
        players: [{ id: socket.id, name: socket.data.name, avatar: socket.data.avatar, ready: true }],
      };
      rooms.set(room.id, room);
      socket.join(room.id);
      socket.data.roomId = room.id;

      broadcastRoomList();
      cb({ ok: true, room: roomState(room) });
    });

    socket.on("room:join", (payload, cb) => {
      cb = typeof cb === "function" ? cb : () => {};
      const roomId = sanitize(payload && payload.roomId, 12).toUpperCase();
      const room = rooms.get(roomId);
      if (!room) return cb({ ok: false, message: "존재하지 않는 방입니다." });
      if (room.state === "play") return cb({ ok: false, message: "게임이 진행 중입니다." });
      if (room.players.length >= room.maxPlayers) return cb({ ok: false, message: "방 인원이 가득 찼습니다." });
      if (room.password && room.password !== sanitize(payload && payload.password, 32)) {
        return cb({ ok: false, message: "비밀번호가 올바르지 않습니다." });
      }

      leaveRoom(socket);

      room.players.push({ id: socket.id, name: socket.data.name, avatar: socket.data.avatar, ready: false });
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
      // 1대1 전용 모드로 바꾸면 정원을 2명으로 고정(추가 입장 차단), 아니면 기존 인원 유지
      if (DUEL_MODES.has(mode)) room.maxPlayers = 2;
      const label = MODES.find((m) => m.id === mode).label;
      roomSystemMessage(room, `방장이 게임 모드를 "${label}"(으)로 변경했습니다.`);
      broadcastRoomState(room);
      broadcastRoomList();
    });

    // 방장 전용: 난이도(1~4) / 문제 수(3~20) 변경 — 대기 상태에서만
    socket.on("room:setConfig", (payload) => {
      const room = rooms.get(socket.data.roomId);
      if (!room || room.hostId !== socket.id || room.state !== "wait") return;
      room.difficulty = clampDiff(payload && payload.difficulty);
      room.rounds = clampRounds(payload && payload.rounds);
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
        // 전원 준비 완료 필수 (방장 제외)
        const allReady = room.players.every((p) => p.id === room.hostId || p.ready);
        if (!allReady) {
          socket.emit("room:notice", "아직 준비하지 않은 참가자가 있습니다.");
          return;
        }
        if (DUEL_MODES.has(room.mode) && room.players.length !== 2) {
          socket.emit("room:notice", "이 게임은 정확히 2명이 있어야 시작할 수 있습니다.");
          return;
        }
        if (ENGINE_MODES.has(room.mode) && room.players.length < 2) {
          socket.emit("room:notice", "2명 이상이 있어야 시작할 수 있습니다.");
          return;
        }
        room.state = "play";
        roomSystemMessage(room, "게임이 시작되었습니다.");
        broadcastRoomState(room);
        broadcastRoomList();
        // 실시간 게임 엔진 구동 (그 외 모드는 상태 토글만)
        if (ENGINE_MODES.has(room.mode)) {
          const opts = { difficulty: room.difficulty, rounds: room.rounds };
          room.onGameEnd = () => endGame(room);
          // 게임오버 시 exp 적립으로 레벨이 바뀌면 접속자 목록을 즉시 갱신하기 위한 훅
          room.refreshPresence = broadcastPresence;
          room.game = room.mode === "spot"
            ? createSpotGame(io, room, opts)
            : room.mode === "baseball"
              ? createBaseballGame(io, room, opts)
              : createVowelGame(io, room, opts);
          room.game.start();
        }
      } else {
        endGame(room); // play → wait: 게임 정리 후 대기실로
        roomSystemMessage(room, "대기실로 돌아왔습니다.");
      }
    });

    // 자음·모음 조합 멀티플레이: 단어 제출
    socket.on("vowel:submit", (payload) => {
      const room = rooms.get(socket.data.roomId);
      if (!room || !room.game) return;
      room.game.submit(socket.id, payload && payload.word);
    });

    // 다른 그림 찾기 멀티플레이: 다른 칸 클릭 제출
    socket.on("spot:submit", (payload) => {
      const room = rooms.get(socket.data.roomId);
      if (!room || !room.game) return;
      room.game.submit(socket.id, payload && payload.cell);
    });

    // 숫자야구 멀티플레이: 비밀 숫자 설정 / 추측
    socket.on("baseball:secret", (payload) => {
      const room = rooms.get(socket.data.roomId);
      if (!room || !room.game || typeof room.game.setSecret !== "function") return;
      room.game.setSecret(socket.id, payload && payload.number);
    });
    socket.on("baseball:guess", (payload) => {
      const room = rooms.get(socket.data.roomId);
      if (!room || !room.game || typeof room.game.guess !== "function") return;
      room.game.guess(socket.id, payload && payload.number);
    });

    socket.on("room:chat", (text) => {
      const room = rooms.get(socket.data.roomId);
      if (!room) return;
      const clean = sanitize(text, CHAT_MAX_LEN);
      if (!clean) return;
      io.to(room.id).emit("room:chat", { user: socket.data.name, text: clean, ts: Date.now() });
    });

    socket.on("disconnect", () => { leaveRoom(socket); broadcastPresence(); });
  });

  return io;
}

module.exports = { attachRealtime, MODES };
