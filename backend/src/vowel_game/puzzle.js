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

// 출제 시드 1개를 freq 가중 랜덤으로 선택 (음절 수 [minSyl,maxSyl] 범위).
// 흔한 단어일수록 잘 뽑히게 1/(freq+1) 가중. 없으면 null.
async function pickSeed(minSyl, maxSyl) {
  const { rows } = await pool.query(
    `SELECT id, word, jamo_key, syllable_count FROM words
     WHERE is_puzzle_seed AND syllable_count BETWEEN $1 AND $2
     ORDER BY random() * (1.0 / (freq + 1)) ASC
     LIMIT 1`,
    [minSyl, maxSyl]
  );
  return rows[0] || null;
}

// 같은 자모 키를 가진 정답 후보 수
async function countSolutions(key) {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n FROM words WHERE jamo_key = $1 AND is_answer_ok`,
    [key]
  );
  return rows[0].n;
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

module.exports = { shuffle, pickSeed, countSolutions, validateWord, getSolutions, decompose };
