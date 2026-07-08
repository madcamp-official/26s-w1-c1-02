// 끝말잇기(word_chain_game) 솔로 REST API — 자모게임과 동일하게 words 사전(../vowel_game) 재사용.
// 레벨(1~20)/턴·전체 타이머는 프론트(word-chain-game.js)가 관리하고, 서버는 단어 한 개씩만 검증한다.
const express = require("express");
const { pool } = require("../db");
const stdict = require("../vowel_game/stdict");
const puzzle = require("../vowel_game/puzzle");
const { CHO } = require("../vowel_game/jamo");
const { acceptableStarts } = require("./doeum");
const { createProgressRouter } = require("../progress/api");

const router = express.Router();
router.use(createProgressRouter("wordchain")); // /level-clear, /progress

// GET /start  → 서버가 랜덤으로 시작 단어를 하나 내려준다(플레이어가 매번 제일 쉬운 단어로
// 시작하는 걸 방지 — 자모게임 puzzle.pickSeed와 동일한 시드 풀/가중치 재사용).
router.get("/start", async (req, res) => {
  try {
    const seed = await puzzle.pickSeed(2, 3);
    if (!seed) return res.status(503).json({ error: "no_seed_words" });
    res.json({ word: seed.word });
  } catch (e) {
    console.error("wordchain/start error:", e.message);
    res.status(500).json({ error: "server_error" });
  }
});

function chars(word) {
  return Array.from(String(word || "").trim());
}

async function existsInDict(word) {
  const inDb = await pool.query(`SELECT 1 FROM words WHERE word = $1 AND is_answer_ok LIMIT 1`, [word]);
  if (inDb.rowCount > 0) return true;
  return await stdict.lookupAndCache(word);
}

// 첫 글자별 전체 단어 수 캐시 — 매 턴 count(*) 쿼리 대신 서버 기동 후 1회만 집계해 재사용.
let startCountsPromise = null;
function loadStartCounts() {
  if (!startCountsPromise) {
    startCountsPromise = pool
      .query(`SELECT substring(word from 1 for 1) AS ch, count(*)::int AS n FROM words WHERE is_answer_ok GROUP BY ch`)
      .then((r) => new Map(r.rows.map((row) => [row.ch, row.n])))
      .catch((e) => { startCountsPromise = null; throw e; });
  }
  return startCountsPromise;
}

// 다음 글자로 시작 가능한 단어 잔여 개수 = 전체 개수(캐시) - 이번 판에서 이미 쓴 해당 글자 시작 단어 수.
async function remainingCount(acceptableChars, usedWords) {
  const counts = await loadStartCounts();
  const total = acceptableChars.reduce((sum, c) => sum + (counts.get(c) || 0), 0);
  const used = (usedWords || []).filter((w) => acceptableChars.includes(chars(w)[0])).length;
  return Math.max(0, total - used);
}

// POST /check  { word, usedWords: string[], requiredChar: string|null, minLength?: number }
// 검증 순서: 사전 존재 → 체인(앞 단어 끝 글자로 시작) → 중복 사용 → (보스 턴이면) 글자 수.
router.post("/check", async (req, res) => {
  const { word, usedWords, requiredChar, minLength } = req.body || {};
  const w = chars(word).join("");
  const cs = chars(w);
  if (!cs.length) return res.json({ valid: false, reason: "EMPTY" });

  try {
    if (!(await existsInDict(w))) return res.json({ valid: false, reason: "NOT_IN_DICTIONARY" });

    if (requiredChar) {
      const starts = acceptableStarts(requiredChar);
      if (!starts.includes(cs[0])) {
        return res.json({ valid: false, reason: "CHAIN_MISMATCH", requiredChar, acceptable: starts });
      }
    }

    if (Array.isArray(usedWords) && usedWords.includes(w)) {
      return res.json({ valid: false, reason: "ALREADY_USED" });
    }

    if (minLength && cs.length < minLength) {
      return res.json({ valid: false, reason: "BOSS_TOO_SHORT", minLength });
    }

    const nextChar = cs[cs.length - 1];
    const acceptableNext = acceptableStarts(nextChar);
    const remaining = await remainingCount(acceptableNext, [...(usedWords || []), w]);
    res.json({ valid: true, nextChar, acceptableNext, remaining });
  } catch (e) {
    console.error("wordchain/check error:", e.message);
    res.status(500).json({ error: "server_error" });
  }
});

// 첫 글자(이미 화면에 나와있는 요구 글자라 힌트가 아님)만 그대로 두고, 나머지는 초성만 남긴다.
// 예: "사슴벌레" → "사ㅅㅂㄹ". 정답 전체를 그냥 알려주지 않기 위함.
function maskAsChosung(word) {
  const cs = Array.from(word);
  return cs
    .map((ch, i) => {
      if (i === 0) return ch;
      const code = ch.codePointAt(0);
      if (code < 0xac00 || code > 0xd7a3) return ch;
      const choIdx = Math.floor((code - 0xac00) / (21 * 28));
      return CHO[choIdx];
    })
    .join("");
}

// POST /hint  { requiredChar, usedWords, minLength? }  → 목숨 대가로 쓸 수 있는 초성 힌트 하나
// (정답 전체가 아니라 첫 글자+나머지 초성만 알려줌. 자주 쓰는 단어 우선,
// 보스 턴이면 글자 수 조건도 만족하는 것만).
router.post("/hint", async (req, res) => {
  const { requiredChar, usedWords, minLength } = req.body || {};
  if (!requiredChar) return res.status(400).json({ error: "bad_request" });
  try {
    const starts = acceptableStarts(requiredChar);
    const conds = starts.map((_, i) => `word LIKE $${i + 1}`).join(" OR ");
    const params = starts.map((c) => `${c}%`);
    // 글자 수 조건(보스 턴)을 먼저 SQL에서 걸러야 함 — 빈도 상위 N개만 뽑은 뒤 걸러내면
    // 흔한 글자는 상위권이 죄다 짧은 단어라 조건 맞는 게 하나도 안 걸릴 수 있음.
    let sql = `SELECT word FROM words WHERE is_answer_ok AND (${conds})`;
    if (minLength) sql += ` AND char_length(word) >= $${params.length + 1}`;
    sql += ` ORDER BY freq DESC LIMIT 50`;
    const { rows } = await pool.query(sql, minLength ? [...params, minLength] : params);
    const used = new Set(usedWords || []);
    const word = rows.map((r) => r.word).find((w) => !used.has(w)) || null;
    res.json({ hint: word ? maskAsChosung(word) : null });
  } catch (e) {
    console.error("wordchain/hint error:", e.message);
    res.status(500).json({ error: "server_error" });
  }
});

module.exports = router;
