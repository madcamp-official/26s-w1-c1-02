// 멀티플레이 자음·모음 조합 게임 엔진 (서버 권위, in-memory).
// 방 하나당 인스턴스 하나. rooms.js 가 room:start 시 생성하고 room.game 에 붙인다.
//
// 흐름: nextRound → (제출 검증·채점) → endRound(전원정답 or 타임아웃) → reveal → 다음/종료
// 점수: 등수 + 그 단어의 난이도(자모 개수) + 절대 속도(남은 시간) 세 축을 합산.
//   맞힌 사람 전원 득점. 힌트: 제한시간 2/3 경과 시 정답 첫 음절 공개.
const puzzle = require("../../vowel_game/puzzle");
const { awardScoresToSockets } = require("../../progress/api");

// 난이도(4단계) → 출제 음절 수 범위
const MP_DIFF = {
  1: { label: "쉬움", syl: [2, 2] },
  2: { label: "보통", syl: [2, 3] },
  3: { label: "어려움", syl: [3, 4] },
  4: { label: "세종대왕", syl: [4, 4] },
};
const REVEAL_MS = 4000; // 정답 공개 후 다음 라운드까지 대기

// ---- 점수 공식: 기본 + 등수 보너스 + 난이도 보너스 + 절대 속도 보너스 ----
const BASE_POINTS = 20;
const RANK_BONUS = [40, 25, 15, 10]; // 1~4등, 5등+ 는 0 (그래도 아래 두 보너스는 그대로 받음)
const POINTS_PER_JAMO = 4;   // 그 단어를 이루는 자모 개수(=경우의 수/난이도) × 4
const POINTS_PER_SEC_LEFT = 2; // 라운드 시작 후 남은 시간(초, 등수와 무관) × 2

const clampDiff = (d) => (MP_DIFF[d] ? d : 2);
const clampRounds = (n) => Math.min(20, Math.max(3, parseInt(n, 10) || 8));
const timeLimitFor = (syl) => 12 + syl * 6; // 초. 2음절=24, 3=30, 4=36

// 등수·자모 개수(단어별 난이도)·절대 경과시간을 합산해 점수 산출. 클라이언트 표시용 breakdown 동봉.
function scoreBreakdown({ rank, jamoCount, elapsedSec, timeLimit }) {
  const rankBonus = rank <= RANK_BONUS.length ? RANK_BONUS[rank - 1] : 0;
  const difficultyBonus = jamoCount * POINTS_PER_JAMO;
  const secLeft = Math.max(0, timeLimit - elapsedSec);
  const speedBonus = Math.round(secLeft * POINTS_PER_SEC_LEFT);
  const total = BASE_POINTS + rankBonus + difficultyBonus + speedBonus;
  return { base: BASE_POINTS, rankBonus, difficultyBonus, speedBonus, total };
}

// 단어 첫 음절만 남기고 나머지는 ○ 로 가리는 힌트 문자열. 예: "도서관" → "도○○"
function maskHint(word) {
  const chars = [...word];
  return chars.map((c, i) => (i === 0 ? c : "○")).join("");
}

function createVowelGame(io, room, config) {
  const difficulty = clampDiff(config && config.difficulty);
  const totalRounds = clampRounds(config && config.rounds);

  // scores: socketId -> { name, score }
  const scores = new Map();
  for (const p of room.players) scores.set(p.id, { name: p.name, score: 0 });

  let roundIndex = 0; // 1-based once a round starts
  let cur = null; // 현재 라운드 상태
  let timers = { hint: null, end: null, next: null };
  let disposed = false;

  const clearTimers = () => {
    for (const k of Object.keys(timers)) { if (timers[k]) clearTimeout(timers[k]); timers[k] = null; }
  };

  const scoreboard = () =>
    [...scores.entries()]
      .map(([id, s]) => ({ id, name: s.name, score: s.score }))
      .sort((a, b) => b.score - a.score);

  const activeCount = () => room.players.length;

  async function nextRound() {
    if (disposed) return;
    roundIndex++;
    if (roundIndex > totalRounds) return finish();

    const [minS, maxS] = MP_DIFF[difficulty].syl;
    const seed = await puzzle.pickSeed(minS, maxS);
    if (disposed) return;
    if (!seed) {
      // 출제 실패 — 라운드 스킵(무한루프 방지 위해 인덱스는 이미 증가함)
      io.to(room.id).emit("vowel:notice", "문제를 불러오지 못해 다음으로 넘어갑니다.");
      timers.next = setTimeout(nextRound, 600);
      return;
    }

    const key = seed.jamo_key;
    const jamo = puzzle.shuffle(puzzle.decompose(seed.word));
    const { count: solutionCount, top: topAnswer } = await puzzle.solutionStats(key);
    if (disposed) return;

    const timeLimit = timeLimitFor(seed.syllable_count);
    cur = {
      key,
      jamo,
      word: seed.word,
      timeLimit,
      startedAt: Date.now(),
      solvers: [], // [{ id, name, rank, points }]
      hintWord: topAnswer || seed.word,
      ended: false,
    };

    io.to(room.id).emit("vowel:round", {
      index: roundIndex,
      total: totalRounds,
      jamo,
      difficulty,
      difficultyLabel: MP_DIFF[difficulty].label,
      solutionCount,
      timeLimit,
      scores: scoreboard(),
    });

    const hintDelay = Math.floor((timeLimit * 2) / 3) * 1000;
    timers.hint = setTimeout(() => {
      if (disposed || !cur || cur.ended) return;
      io.to(room.id).emit("vowel:hint", { hint: maskHint(cur.hintWord) });
    }, hintDelay);
    timers.end = setTimeout(() => endRound("timeout"), timeLimit * 1000);
  }

  async function submit(socketId, word) {
    if (disposed || !cur || cur.ended) return;
    if (!scores.has(socketId)) return; // 방 참가자 아님
    if (cur.solvers.some((s) => s.id === socketId)) return; // 이미 정답 처리됨(잠금)

    const clean = String(word == null ? "" : word).trim();
    if (!clean) return;

    const { correct, reason } = await puzzle.validateWord(clean, cur.key);
    if (disposed || !cur || cur.ended) return;
    // 검증 도중 이 소켓이 다른 요청으로 이미 정답 처리됐을 수 있음
    if (cur.solvers.some((s) => s.id === socketId)) return;

    if (!correct) {
      io.to(socketId).emit("vowel:result", { correct: false, reason });
      return;
    }

    const rank = cur.solvers.length + 1;
    const elapsedSec = (Date.now() - cur.startedAt) / 1000;
    const breakdown = scoreBreakdown({ rank, jamoCount: cur.jamo.length, elapsedSec, timeLimit: cur.timeLimit });
    const points = breakdown.total;
    const entry = scores.get(socketId);
    entry.score += points;
    cur.solvers.push({ id: socketId, name: entry.name, rank, points, breakdown });

    io.to(socketId).emit("vowel:result", { correct: true, word: clean, rank, points, breakdown });
    io.to(room.id).emit("vowel:progress", {
      solvedCount: cur.solvers.length,
      total: activeCount(),
      solvers: cur.solvers.map((s) => ({ id: s.id, name: s.name, rank: s.rank, points: s.points })),
      scores: scoreboard(),
    });

    if (cur.solvers.length >= activeCount()) endRound("allSolved");
  }

  async function endRound(reason) {
    if (disposed || !cur || cur.ended) return;
    cur.ended = true;
    clearTimers();

    const answers = await puzzle.getSolutions(cur.key, 8);
    if (disposed) return;

    io.to(room.id).emit("vowel:reveal", {
      index: roundIndex,
      total: totalRounds,
      reason,
      answers: answers.length ? answers : [cur.word],
      roundScores: cur.solvers.map((s) => ({ name: s.name, rank: s.rank, points: s.points, breakdown: s.breakdown })),
      scores: scoreboard(),
    });

    timers.next = setTimeout(nextRound, REVEAL_MS);
  }

  function finish() {
    clearTimers();
    const finalScores = scoreboard();
    io.to(room.id).emit("vowel:gameover", { finalScores });
    // 최종 점수를 각 로그인 유저의 종합 exp로 적립(게스트는 무시) → 레벨 갱신 시 로비 반영
    awardScoresToSockets(io, finalScores).then(() => {
      if (typeof room.refreshPresence === "function") room.refreshPresence();
    });
    // 방을 대기실로 되돌림 — rooms.js 가 room.game 정리를 맡음
    if (typeof room.onGameEnd === "function") room.onGameEnd();
  }

  // 참가자 퇴장: 점수판/전원정답 대상에서 제외 후 재판정
  function onPlayerLeave(socketId) {
    scores.delete(socketId);
    if (cur && !cur.ended) {
      cur.solvers = cur.solvers.filter((s) => s.id !== socketId);
      // 남은 전원이 이미 맞혔으면 라운드 즉시 종료
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

module.exports = { createVowelGame, MP_DIFF, clampDiff, clampRounds };
