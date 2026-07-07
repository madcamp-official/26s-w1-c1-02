// 자음·모음 조합 게임 공용 헬퍼 — 출제 시드 선택 / 정답 검증 / 정답 목록.
// 솔로 REST(api.js)와 멀티플레이 엔진(realtime/games/vowel.js) 양쪽에서 재사용.
const { pool } = require("../db");
const { decompose, jamoKey } = require("./jamo");
const stdict = require("./stdict");

// 배열 셔플 (Fisher–Yates) — 원본 불변
function shuffle(a) {
  const r = a.slice();
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

// 출제 시드 캐시 — 시드 단어는 seed 스크립트로만 바뀌므로(변경 시 서버 재시작) 기동 후 1회만 로드.
// 매 요청마다 words 전체를 random() 정렬하던 것을 메모리 추첨으로 대체.
let seedsPromise = null;
function loadSeeds() {
  if (!seedsPromise) {
    seedsPromise = pool
      .query(`SELECT id, word, jamo_key, syllable_count, freq FROM words WHERE is_puzzle_seed`)
      .then((r) => r.rows)
      .catch((e) => { seedsPromise = null; throw e; });
  }
  return seedsPromise;
}

// 출제 시드 1개를 freq 가중 랜덤으로 선택 (음절 수 [minSyl,maxSyl] 범위).
// 흔한 단어일수록 잘 뽑히게 (freq+1) 가중. 없으면 null.
async function pickSeed(minSyl, maxSyl) {
  const seeds = await loadSeeds();
  const candidates = seeds.filter((s) => s.syllable_count >= minSyl && s.syllable_count <= maxSyl);
  if (!candidates.length) return null;
  let total = 0;
  for (const s of candidates) total += s.freq + 1;
  let r = Math.random() * total;
  for (const s of candidates) {
    r -= s.freq + 1;
    if (r <= 0) return s;
  }
  return candidates[candidates.length - 1];
}

// 같은 자모 키를 가진 정답 후보 수 + 최다 빈도 정답 1개 (쿼리 한 번)
async function solutionStats(key) {
  const { rows } = await pool.query(
    `SELECT word, count(*) OVER ()::int AS n FROM words
     WHERE jamo_key = $1 AND is_answer_ok
     ORDER BY freq DESC LIMIT 1`,
    [key]
  );
  return rows[0] ? { count: rows[0].n, top: rows[0].word } : { count: 0, top: null };
}

// 제출 단어 검증: (1) 자모가 문제와 정확히 일치 (2) 사전(로컬→국립국어원 폴백)에 존재.
// { correct, reason } 반환. reason: "ok" | "JAMO_MISMATCH" | "NOT_IN_DICTIONARY"
async function validateWord(word, key) {
  if (jamoKey(word) !== key) return { correct: false, reason: "JAMO_MISMATCH" };
  const inDb = await pool.query(
    `SELECT 1 FROM words WHERE word = $1 AND is_answer_ok LIMIT 1`,
    [word]
  );
  if (inDb.rowCount > 0) return { correct: true, reason: "ok" };
  if (await stdict.lookupAndCache(word)) return { correct: true, reason: "ok" };
  return { correct: false, reason: "NOT_IN_DICTIONARY" };
}

// 가능한 정답 단어 목록 (freq 높은 순). limit 없으면 전부.
async function getSolutions(key, limit) {
  const { rows } = await pool.query(
    `SELECT word FROM words WHERE jamo_key = $1 AND is_answer_ok
     ORDER BY freq DESC${limit ? ` LIMIT ${parseInt(limit, 10)}` : ""}`,
    [key]
  );
  return rows.map((r) => r.word);
}

// 만료된 발급 문제 삭제 — 주기 호출하지 않으면 jamo_puzzles 가 무한 증식
async function cleanupExpiredPuzzles() {
  await pool.query(`DELETE FROM jamo_puzzles WHERE expires_at < now()`);
}

module.exports = { shuffle, pickSeed, solutionStats, validateWord, getSolutions, cleanupExpiredPuzzles, decompose };
