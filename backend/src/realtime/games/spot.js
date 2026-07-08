// 멀티플레이 다른 그림 찾기 게임 엔진 (서버 권위, in-memory).
// 방 하나당 인스턴스 하나. rooms.js 가 room:start 시 생성하고 room.game 에 붙인다.
// vowel.js 와 동일한 라이프사이클: start → (제출 채점) → endRound(전원정답 or 타임아웃) → reveal → 다음/종료
//
// 각 라운드: 두 격자(base/right)에 단 하나 다른 칸이 존재. 클라이언트는 다른 칸 인덱스를 찾아 클릭 제출.
// 점수: 등수 + 격자 난이도(한 변 크기) + 절대 속도(남은 시간) 합산. 맞힌 사람 전원 득점.
// 오답 클릭에는 짧은 쿨다운을 걸어 무작위 연타(브루트포스)를 방지한다.
const { clampDiff, clampRounds } = require("./vowel");
const { awardScoresToSockets } = require("../../progress/api");

// 자산 없이 이모지 격자로 구성 (프론트 spot-difference.js 와 동일 계열)
const POOL = ["🍎", "🍊", "🍋", "🍓", "🍇", "🍉", "🍑", "🥝", "🍒", "🥕", "🌽", "🍄", "🌸", "🌻", "🍀", "⭐", "🐱", "🐶", "🐰", "🐸", "🦊", "🐼", "🐵", "🐷"];

// 난이도(4단계) → 격자 한 변 크기 / 제한 시간(초)
const SPOT_DIFF = {
  1: { label: "쉬움",     size: 5,  time: 22 },
  2: { label: "보통",     size: 7,  time: 26 },
  3: { label: "어려움",   size: 9,  time: 32 },
  4: { label: "인간프린터", size: 11, time: 38 },
};
const REVEAL_MS = 4000;        // 정답 공개 후 다음 라운드까지 대기
const WRONG_COOLDOWN_MS = 2000; // 오답 후 재클릭 잠금(연타 방지)

// ---- 점수 공식: 기본 + 등수 보너스 + 격자 난이도 보너스 + 절대 속도 보너스 ----
const BASE_POINTS = 20;
const RANK_BONUS = [40, 25, 15, 10]; // 1~4등, 5등+ 는 0
const POINTS_PER_SIZE = 4;    // 격자 한 변 크기 × 4 (난이도)
const POINTS_PER_SEC_LEFT = 2; // 라운드 시작 후 남은 시간(초) × 2

const rand = (n) => Math.floor(Math.random() * n);

function scoreBreakdown({ rank, size, elapsedSec, timeLimit }) {
  const rankBonus = rank <= RANK_BONUS.length ? RANK_BONUS[rank - 1] : 0;
  const difficultyBonus = size * POINTS_PER_SIZE;
  const secLeft = Math.max(0, timeLimit - elapsedSec);
  const speedBonus = Math.round(secLeft * POINTS_PER_SEC_LEFT);
  const total = BASE_POINTS + rankBonus + difficultyBonus + speedBonus;
  return { base: BASE_POINTS, rankBonus, difficultyBonus, speedBonus, total };
}

function buildBoard(size) {
  const total = size * size;
  const base = Array.from({ length: total }, () => POOL[rand(POOL.length)]);
  const right = base.slice();
  const diff = rand(total);
  let v; do { v = POOL[rand(POOL.length)]; } while (v === base[diff]);
  right[diff] = v;
  return { base, right, diff };
}

function createSpotGame(io, room, config) {
  const difficulty = clampDiff(config && config.difficulty);
  const totalRounds = clampRounds(config && config.rounds);

  // scores: socketId -> { name, score }
  const scores = new Map();
  for (const p of room.players) scores.set(p.id, { name: p.name, score: 0 });

  let roundIndex = 0; // 1-based once a round starts
  let cur = null;     // 현재 라운드 상태
  let timers = { end: null, next: null };
  let disposed = false;

  const clearTimers = () => {
    for (const k of Object.keys(timers)) { if (timers[k]) clearTimeout(timers[k]); timers[k] = null; }
  };

  const scoreboard = () =>
    [...scores.entries()]
      .map(([id, s]) => ({ id, name: s.name, score: s.score }))
      .sort((a, b) => b.score - a.score);

  const activeCount = () => room.players.length;

  function nextRound() {
    if (disposed) return;
    roundIndex++;
    if (roundIndex > totalRounds) return finish();

    const conf = SPOT_DIFF[difficulty];
    const board = buildBoard(conf.size);
    cur = {
      size: conf.size,
      base: board.base,
      right: board.right,
      diff: board.diff,
      timeLimit: conf.time,
      startedAt: Date.now(),
      solvers: [],          // [{ id, name, rank, points, breakdown }]
      cooldown: new Map(),  // socketId -> 재클릭 가능 시각(ms)
      ended: false,
    };

    // 정답 위치(diff)는 클라이언트에 보내지 않는다 — 찾아야 하므로.
    io.to(room.id).emit("spot:round", {
      index: roundIndex,
      total: totalRounds,
      size: conf.size,
      base: board.base,
      right: board.right,
      timeLimit: conf.time,
      difficulty,
      difficultyLabel: conf.label,
      scores: scoreboard(),
    });

    timers.end = setTimeout(() => endRound("timeout"), conf.time * 1000);
  }

  function submit(socketId, cell) {
    if (disposed || !cur || cur.ended) return;
    if (!scores.has(socketId)) return;                       // 방 참가자 아님
    if (cur.solvers.some((s) => s.id === socketId)) return;  // 이미 정답 처리됨(잠금)

    const now = Date.now();
    if (now < (cur.cooldown.get(socketId) || 0)) return;     // 오답 쿨다운 중

    const idx = parseInt(cell, 10);
    if (!Number.isInteger(idx) || idx < 0 || idx >= cur.size * cur.size) return;

    if (idx !== cur.diff) {
      cur.cooldown.set(socketId, now + WRONG_COOLDOWN_MS);
      io.to(socketId).emit("spot:result", { correct: false, cooldownMs: WRONG_COOLDOWN_MS });
      return;
    }

    const rank = cur.solvers.length + 1;
    const elapsedSec = (now - cur.startedAt) / 1000;
    const breakdown = scoreBreakdown({ rank, size: cur.size, elapsedSec, timeLimit: cur.timeLimit });
    const points = breakdown.total;
    const entry = scores.get(socketId);
    entry.score += points;
    cur.solvers.push({ id: socketId, name: entry.name, rank, points, breakdown });

    io.to(socketId).emit("spot:result", { correct: true, cell: idx, rank, points, breakdown });
    io.to(room.id).emit("spot:progress", {
      solvedCount: cur.solvers.length,
      total: activeCount(),
      solvers: cur.solvers.map((s) => ({ id: s.id, name: s.name, rank: s.rank, points: s.points })),
      scores: scoreboard(),
    });

    if (cur.solvers.length >= activeCount()) endRound("allSolved");
  }

  function endRound(reason) {
    if (disposed || !cur || cur.ended) return;
    cur.ended = true;
    clearTimers();

    io.to(room.id).emit("spot:reveal", {
      index: roundIndex,
      total: totalRounds,
      reason,
      diff: cur.diff, // 정답 위치 공개
      roundScores: cur.solvers.map((s) => ({ name: s.name, rank: s.rank, points: s.points, breakdown: s.breakdown })),
      scores: scoreboard(),
    });

    timers.next = setTimeout(nextRound, REVEAL_MS);
  }

  function finish() {
    clearTimers();
    const finalScores = scoreboard();
    io.to(room.id).emit("spot:gameover", { finalScores });
    // 최종 점수를 각 로그인 유저의 종합 exp로 적립(게스트는 무시) → 레벨 갱신 시 로비 반영
    awardScoresToSockets(io, finalScores).then(() => {
      if (typeof room.refreshPresence === "function") room.refreshPresence();
    });
    if (typeof room.onGameEnd === "function") room.onGameEnd();
  }

  // 참가자 퇴장: 점수판/전원정답 대상에서 제외 후 재판정
  function onPlayerLeave(socketId) {
    scores.delete(socketId);
    if (cur && !cur.ended) {
      cur.solvers = cur.solvers.filter((s) => s.id !== socketId);
      cur.cooldown.delete(socketId);
      if (activeCount() > 0 && cur.solvers.length >= activeCount()) endRound("allSolved");
    }
  }

  function dispose() {
    disposed = true;
    clearTimers();
    cur = null;
  }

  function start() { nextRound(); }

  return { start, submit, endRound, onPlayerLeave, dispose, difficulty, totalRounds };
}

module.exports = { createSpotGame, SPOT_DIFF };
