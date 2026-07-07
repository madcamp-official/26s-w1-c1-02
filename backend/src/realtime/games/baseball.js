// 멀티플레이 숫자야구 게임 엔진 (서버 권위, in-memory). 방 하나당 인스턴스 하나.
// vowel.js / spot.js 와 달리 "동시 채점 레이스"가 아니라 **2인 턴제 추리 대결**이다.
// rooms.js 가 room:start 시 생성하고 room.game 에 붙인다. 반드시 참가자 2명.
//
// 흐름: setup(양쪽이 비밀 숫자 설정) → play(번갈아 상대 숫자 추측, 서버가 S/B/Out 판정)
//       → over(홈런 or 기회 소진). 각 라운드는 양쪽이 한 번씩 추측하는 단위(공평성 보장).
// 판정: 스트라이크=값·자리 일치, 볼=값은 있으나 자리 다름, 아웃=정답에 없음. 홈런=전부 스트라이크.
// 승패: 같은 라운드에 둘 다 홈런이면 무승부, 한쪽만 홈런이면 그 사람 승. 아무도 못 맞히고
//       기회를 다 쓰면 무승부. 한쪽이 먼저 홈런해도 상대에게 그 라운드의 마지막 기회를 준다.

// difficulty(1~2) → 자릿수 / rounds → 기회(추측 횟수)
const DIGIT_BY_DIFF = { 1: 3, 2: 4 };
const clampDigits = (d) => DIGIT_BY_DIFF[d] || 3; // 기본 3자리
const clampGuesses = (n) => Math.min(15, Math.max(5, parseInt(n, 10) || 9)); // 기본 9회

const SETUP_MS = 60000; // 비밀 숫자 설정 제한(초과 시 무작위 배정)
const TURN_MS = 45000;  // 한 턴 제한시간(초과 시 그 라운드 기회 소진)
const OVER_MS = 400;    // gameover 직전 여유

const rand = (n) => Math.floor(Math.random() * n);

// 0~9 중 중복 없는 digits 자리 무작위 정답
function randomSecret(digits) {
  const pool = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  for (let i = pool.length - 1; i > 0; i--) { const j = rand(i + 1); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  return pool.slice(0, digits).join("");
}

// 입력 검증: 정확히 digits 자리, 숫자만, 중복 없음. 통과하면 정규화된 문자열, 아니면 null.
function normalizeNumber(raw, digits) {
  const s = String(raw == null ? "" : raw).trim();
  if (!/^\d+$/.test(s)) return null;
  if (s.length !== digits) return null;
  if (new Set(s).size !== s.length) return null; // 중복 자리
  return s;
}

// 스트라이크/볼/아웃 판정
function judge(secret, guess) {
  let strike = 0, ball = 0;
  for (let i = 0; i < secret.length; i++) {
    if (guess[i] === secret[i]) strike++;
    else if (secret.indexOf(guess[i]) !== -1) ball++;
  }
  return { strike, ball, out: secret.length - strike - ball, homerun: strike === secret.length };
}

function createBaseballGame(io, room, config) {
  const digits = clampDigits(config && config.difficulty);
  const maxGuesses = clampGuesses(config && config.rounds);

  // 참가자 2명 고정. order[0] 이 각 라운드 선공.
  const order = room.players.slice(0, 2).map((p) => p.id);
  const names = new Map(room.players.map((p) => [p.id, p.name]));

  const secrets = new Map(); // id -> 자기 비밀 숫자(상대가 맞혀야 함)
  const boards = new Map(order.map((id) => [id, []])); // id -> [{ number, strike, ball, out, homerun, timeout }]
  const solved = new Set(); // 이번 게임에서 홈런에 성공한 id

  let phase = "setup"; // setup | play | over
  let round = 1;       // 1..maxGuesses
  let half = 0;        // 0 = order[0] 차례, 1 = order[1] 차례
  let turnEndsAt = 0;
  let timers = { setup: null, turn: null, over: null };
  let disposed = false;

  const clearTimers = () => {
    for (const k of Object.keys(timers)) { if (timers[k]) clearTimeout(timers[k]); timers[k] = null; }
  };
  const nameOf = (id) => names.get(id) || "?";
  const boardsObj = () => Object.fromEntries(order.map((id) => [id, boards.get(id)]));
  const playersPub = () => order.map((id) => ({ id, name: nameOf(id) }));
  const curId = () => order[half];

  // ---------- setup ----------
  function start() {
    io.to(room.id).emit("baseball:setup", {
      digits,
      maxGuesses,
      players: playersPub(),
    });
    timers.setup = setTimeout(() => {
      // 미설정자에게 무작위 정답 배정 후 진행
      for (const id of order) if (!secrets.has(id)) secrets.set(id, randomSecret(digits));
      beginPlay();
    }, SETUP_MS);
  }

  function setSecret(socketId, raw) {
    if (disposed || phase !== "setup") return;
    if (!boards.has(socketId)) return;      // 이 방 참가자 아님
    if (secrets.has(socketId)) return;      // 이미 설정함(변경 불가)
    const num = normalizeNumber(raw, digits);
    if (!num) {
      io.to(socketId).emit("baseball:invalid", {
        message: `0~9 중 중복 없는 ${digits}자리 숫자를 입력하세요.`,
      });
      return;
    }
    secrets.set(socketId, num);
    io.to(socketId).emit("baseball:secretAck", { number: num });
    io.to(room.id).emit("baseball:setupProgress", {
      readyIds: [...secrets.keys()],
      total: order.length,
    });
    if (order.every((id) => secrets.has(id))) beginPlay();
  }

  // ---------- play ----------
  function beginPlay() {
    if (disposed || phase !== "setup") return;
    clearTimers();
    phase = "play";
    round = 1;
    half = 0;
    startTurn();
  }

  function state() {
    return {
      phase,
      digits,
      maxGuesses,
      round,
      turnId: curId(),
      turnName: nameOf(curId()),
      players: playersPub(),
      boards: boardsObj(),
      remainMs: Math.max(0, turnEndsAt - Date.now()),
    };
  }

  function startTurn() {
    if (disposed) return;
    turnEndsAt = Date.now() + TURN_MS;
    io.to(room.id).emit("baseball:state", state());
    if (timers.turn) clearTimeout(timers.turn);
    timers.turn = setTimeout(onTurnTimeout, TURN_MS);
  }

  function onTurnTimeout() {
    if (disposed || phase !== "play") return;
    const id = curId();
    boards.get(id).push({ number: "-".repeat(digits), strike: 0, ball: 0, out: digits, homerun: false, timeout: true });
    io.to(room.id).emit("baseball:guessResult", {
      by: id, byName: nameOf(id), number: "-".repeat(digits),
      strike: 0, ball: 0, out: digits, homerun: false, timeout: true, round,
    });
    advance();
  }

  function guess(socketId, raw) {
    if (disposed || phase !== "play") return;
    if (!boards.has(socketId)) return;
    if (socketId !== curId()) {
      io.to(socketId).emit("baseball:invalid", { message: "아직 상대 차례입니다." });
      return;
    }
    const num = normalizeNumber(raw, digits);
    if (!num) {
      io.to(socketId).emit("baseball:invalid", {
        message: `0~9 중 중복 없는 ${digits}자리 숫자를 입력하세요.`,
      });
      return;
    }
    const opponent = order[half === 0 ? 1 : 0];
    const res = judge(secrets.get(opponent), num);
    boards.get(socketId).push({ number: num, ...res });
    if (res.homerun) solved.add(socketId);

    if (timers.turn) { clearTimeout(timers.turn); timers.turn = null; }
    io.to(room.id).emit("baseball:guessResult", {
      by: socketId, byName: nameOf(socketId), number: num,
      strike: res.strike, ball: res.ball, out: res.out, homerun: res.homerun, round,
    });
    advance();
  }

  // 한 사람의 턴을 마친 뒤 다음 차례로 넘기거나(라운드 전반) 라운드를 판정한다(라운드 후반).
  function advance() {
    if (disposed || phase !== "play") return;
    if (half === 0) {
      half = 1;
      startTurn();
      return;
    }
    // 라운드 종료 판정 (양쪽 모두 이번 라운드 기회를 사용함)
    const a = order[0], b = order[1];
    const aWin = solved.has(a), bWin = solved.has(b);
    if (aWin && bWin) return finish(null);      // 같은 라운드 동반 홈런 → 무승부
    if (aWin) return finish(a);
    if (bWin) return finish(b);
    if (round >= maxGuesses) return finish(null); // 기회 소진, 아무도 못 맞힘 → 무승부
    round++;
    half = 0;
    startTurn();
  }

  // ---------- over ----------
  function finish(winnerId, result) {
    if (disposed || phase === "over") return;
    phase = "over";
    clearTimers();
    const res = result || (winnerId ? "win" : "draw");
    io.to(room.id).emit("baseball:gameover", {
      result: res,
      winnerId: winnerId || null,
      winnerName: winnerId ? nameOf(winnerId) : null,
      secrets: Object.fromEntries(order.map((id) => [id, secrets.get(id) || null])),
      boards: boardsObj(),
      players: playersPub(),
    });
    timers.over = setTimeout(() => {
      if (typeof room.onGameEnd === "function") room.onGameEnd();
    }, OVER_MS);
  }

  // 한 명이 나가면 남은 사람 부전승(설정/진행 중 무관), 게임 종료
  function onPlayerLeave(socketId) {
    if (disposed || phase === "over") return;
    const remaining = order.find((id) => id !== socketId);
    finish(remaining || null, "forfeit");
  }

  function dispose() {
    disposed = true;
    clearTimers();
  }

  return { start, setSecret, guess, onPlayerLeave, dispose, digits, maxGuesses, totalRounds: maxGuesses };
}

module.exports = { createBaseballGame, judge, normalizeNumber, clampDigits, clampGuesses };
