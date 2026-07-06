// 멀티플레이 자음·모음 조합 게임 end-to-end 검증 드라이버.
// 호스트+참가자 2 클라이언트로 방 생성→준비→시작, 각 라운드마다 DB에서 정답을 찾아 제출,
// vowel:round/progress/reveal/gameover 흐름과 순위 점수를 확인한다.
//   docker exec <server> node scripts/verify-vowel-mp.js
const { io } = require("socket.io-client");
const { Pool } = require("pg");

const URL = process.env.VERIFY_URL || "http://localhost:8080";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const ROUNDS = 3;

const log = (...a) => console.log(...a);
let failed = false;
const check = (cond, label) => { log(`${cond ? "✅" : "❌"} ${label}`); if (!cond) failed = true; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function answerFor(jamo) {
  const key = [...jamo].sort().join("");
  const { rows } = await pool.query(
    `SELECT word FROM words WHERE jamo_key=$1 AND is_answer_ok ORDER BY freq DESC LIMIT 1`, [key]);
  return rows[0] && rows[0].word;
}

function mkClient(name) {
  const s = io(URL, { path: "/socket.io", forceNew: true });
  const ev = { rounds: [], reveals: [], results: [], progress: [], gameover: null };
  s.on("vowel:round", (d) => ev.rounds.push(d));
  s.on("vowel:reveal", (d) => ev.reveals.push(d));
  s.on("vowel:result", (d) => ev.results.push(d));
  s.on("vowel:progress", (d) => ev.progress.push(d));
  s.on("vowel:gameover", (d) => { ev.gameover = d; });
  return new Promise((res) => s.on("connect", () => { s.emit("identify", name); res({ s, ev, name }); }));
}

(async () => {
  const host = await mkClient("호스트");
  const player = await mkClient("참가자");

  // 방 생성 (mode vowel, 난이도 보통, 3문제)
  const created = await new Promise((r) =>
    host.s.emit("room:create", { name: "검증방", mode: "vowel", difficulty: 2, rounds: ROUNDS, maxPlayers: 4 }, r));
  check(created.ok && created.room, "room:create ok");
  const roomId = created.room.id;
  check(created.room.difficulty === 2 && created.room.rounds === ROUNDS, "생성 방에 difficulty/rounds 반영");

  // 참가
  const joined = await new Promise((r) => player.s.emit("room:join", { roomId }, r));
  check(joined.ok, "room:join ok");

  // 준비 안 한 상태로 시작 시도 → 거절 (준비 게이트)
  let notice = null;
  host.s.once("room:notice", (t) => { notice = t; });
  host.s.emit("room:start");
  await wait(300);
  check(!!notice, `준비 전 시작 거절: "${notice || ""}"`);

  // 참가자 준비 후 시작
  player.s.emit("room:ready");
  await wait(200);
  host.s.emit("room:start");

  // 각 라운드: round 이벤트를 기다렸다가 양쪽 다 정답 제출 (host 먼저 → 1등)
  const seen = new Set();
  const handleRound = async (client, other) => {
    // client(host) 가 라운드 수신 시 정답을 찾아 host 먼저, 잠시 후 player 제출
    for (let guard = 0; guard < 200 && !host.ev.gameover; guard++) {
      const idx = host.ev.rounds.length;
      if (idx > seen.size && idx <= ROUNDS) {
        const rd = host.ev.rounds[idx - 1];
        seen.add(idx);
        const word = await answerFor(rd.jamo);
        if (!word) { log(`  (라운드 ${idx}: 정답 못 찾음, 스킵)`); continue; }
        // 오답 먼저 (host) → 정답 (host) → 정답 (player)
        host.s.emit("vowel:submit", { word: "없는단어없닭" });
        await wait(80);
        host.s.emit("vowel:submit", { word });
        await wait(150);
        player.s.emit("vowel:submit", { word });
      }
      await wait(100);
    }
  };
  await handleRound();

  // 게임 종료 대기
  for (let i = 0; i < 100 && !host.ev.gameover; i++) await wait(100);

  check(host.ev.rounds.length === ROUNDS, `라운드 ${ROUNDS}개 수신 (실제 ${host.ev.rounds.length})`);
  check(host.ev.reveals.length === ROUNDS, `공개 ${ROUNDS}개 수신 (실제 ${host.ev.reveals.length})`);
  check(host.ev.reveals.every((r) => r.answers && r.answers.length > 0), "각 공개에 정답 목록 포함");
  const hostWrong = host.ev.results.find((r) => r.correct === false);
  check(!!hostWrong, "오답 제출 시 correct:false 응답");
  const hostRight = host.ev.results.find((r) => r.correct === true);
  check(hostRight && hostRight.rank === 1, `호스트 정답 1등 (rank=${hostRight && hostRight.rank}, +${hostRight && hostRight.points})`);
  check(hostRight && hostRight.breakdown && hostRight.breakdown.rankBonus === 40,
    `1등 breakdown.rankBonus=40 (실제 ${hostRight && hostRight.breakdown && hostRight.breakdown.rankBonus})`);
  check(hostRight && hostRight.breakdown && hostRight.breakdown.total === hostRight.points,
    "breakdown.total == points 일관성");
  check(hostRight && hostRight.breakdown && hostRight.breakdown.difficultyBonus > 0,
    `단어 난이도(자모 개수) 보너스 반영 (+${hostRight && hostRight.breakdown && hostRight.breakdown.difficultyBonus})`);
  check(hostRight && hostRight.breakdown && hostRight.breakdown.speedBonus > 0,
    `절대 속도 보너스 반영 (+${hostRight && hostRight.breakdown && hostRight.breakdown.speedBonus})`);
  check(!!host.ev.gameover, "vowel:gameover 수신");
  if (host.ev.gameover) {
    const fs = host.ev.gameover.finalScores;
    check(fs.length === 2, `최종 점수 2명 (실제 ${fs.length})`);
    check(fs.every((p) => p.score > 0), `양쪽 다 득점 (${fs.map((p) => p.name + ":" + p.score).join(", ")})`);
    check(fs[0].score >= fs[1].score, "점수 내림차순 정렬");
  }

  log(failed ? "\n=== 실패 있음 ===" : "\n=== 전부 통과 ===");
  await pool.end();
  host.s.close(); player.s.close();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("드라이버 오류:", e); process.exit(2); });
