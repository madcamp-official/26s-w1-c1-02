// 끝말잇기(word_chain_game) 솔로 REST API — 자모게임과 동일하게 words 사전(../vowel_game) 재사용.
// 레벨(1~20)/턴·전체 타이머는 프론트(word-chain-game.js)가 관리하고, 서버는 단어 한 개씩만 검증한다.
const express = require("express");
const { pool } = require("../db");
const stdict = require("../vowel_game/stdict");
const { acceptableStarts } = require("./doeum");
const { createProgressRouter } = require("../progress/api");

const router = express.Router();
router.use(createProgressRouter("wordchain")); // /level-clear, /progress

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

module.exports = router;
