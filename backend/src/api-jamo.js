// 자음 모음 조합 게임 REST API
const express = require("express");
const { pool } = require("./db");
const { decompose, jamoKey } = require("./jamo");
const stdict = require("./stdict");

const router = express.Router();

// 난이도 → 음절 수 범위
const DIFF = { 1: [2, 2], 2: [2, 3], 3: [3, 4] };

// 배열 셔플 (Fisher–Yates)
function shuffle(a) {
  const r = a.slice();
  for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; }
  return r;
}

// GET /api/games/jamo/new?difficulty=2  → 새 문제 발급
router.get("/new", async (req, res) => {
  const difficulty = Math.min(3, Math.max(1, parseInt(req.query.difficulty, 10) || 1));
  const [minS, maxS] = DIFF[difficulty];
  try {
    // 출제 후보 중 하나를 가중 랜덤으로 선택 (흔한 단어일수록 잘 뽑히게 freq 가중)
    const pick = await pool.query(
      `SELECT id, word, jamo_key FROM words
       WHERE is_puzzle_seed AND syllable_count BETWEEN $1 AND $2
       ORDER BY random() * (1.0 / (freq + 1)) ASC
       LIMIT 1`,
      [minS, maxS]
    );
    if (pick.rowCount === 0) return res.status(503).json({ error: "no_seed_words" });
    const seed = pick.rows[0];

    // 같은 자모 키를 가진 정답 후보 수
    const sol = await pool.query(
      `SELECT count(*)::int AS n FROM words WHERE jamo_key = $1 AND is_answer_ok`,
      [seed.jamo_key]
    );

    const jamo = shuffle(decompose(seed.word));
    const ins = await pool.query(
      `INSERT INTO jamo_puzzles (jamo_key, jamo_display, difficulty, solution_count, source_word_id, expires_at)
       VALUES ($1,$2,$3,$4,$5, now() + interval '5 minutes')
       RETURNING id`,
      [seed.jamo_key, JSON.stringify(jamo), difficulty, sol.rows[0].n, seed.id]
    );

    res.json({
      puzzleId: ins.rows[0].id,
      jamo,
      difficulty,
      solutionCount: sol.rows[0].n,
      timeLimit: 60,
    });
  } catch (e) {
    console.error("jamo/new error:", e);
    res.status(500).json({ error: "server_error" });
  }
});

// POST /api/games/jamo/submit  { puzzleId, word, elapsedMs }
router.post("/submit", async (req, res) => {
  const { puzzleId, word, elapsedMs } = req.body || {};
  if (!puzzleId || !word) return res.status(400).json({ error: "bad_request" });
  try {
    const pz = await pool.query(
      `SELECT * FROM jamo_puzzles WHERE id = $1 AND (expires_at IS NULL OR expires_at > now())`,
      [puzzleId]
    );
    if (pz.rowCount === 0) return res.status(404).json({ error: "puzzle_not_found_or_expired" });
    const puzzle = pz.rows[0];

    let correct = false, reason = "ok";

    // (1) 자모가 문제와 정확히 일치하는가
    if (jamoKey(word) !== puzzle.jamo_key) {
      reason = "JAMO_MISMATCH";
    } else {
      // (2) 사전에 있는 단어인가 (로컬 → 없으면 국립국어원 폴백)
      const inDb = await pool.query(`SELECT 1 FROM words WHERE word = $1 AND is_answer_ok LIMIT 1`, [word]);
      if (inDb.rowCount > 0) correct = true;
      else if (await stdict.lookupAndCache(word)) correct = true;
      else reason = "NOT_IN_DICTIONARY";
    }

    // 점수: 기본 + 자모 개수 보너스 + 시간 보너스
    let score = 0;
    if (correct) {
      const jamoN = puzzle.jamo_display.length;
      const timeBonus = Math.max(0, 60 - Math.floor((elapsedMs || 0) / 1000)) * 2;
      score = 50 + jamoN * 10 + timeBonus + puzzle.difficulty * 10;
    }

    await pool.query(
      `INSERT INTO game_results (game, puzzle_id, submitted_word, is_correct, score, elapsed_ms, mode)
       VALUES ('jamo',$1,$2,$3,$4,$5,'solo')`,
      [puzzleId, word, correct, score, elapsedMs || null]
    );

    res.json({ correct, score, matched: correct ? word : null, reason });
  } catch (e) {
    console.error("jamo/submit error:", e);
    res.status(500).json({ error: "server_error" });
  }
});

// GET /api/games/jamo/puzzle/:id/solutions  → 가능한 정답 공개
router.get("/puzzle/:id/solutions", async (req, res) => {
  try {
    const pz = await pool.query(`SELECT jamo_key FROM jamo_puzzles WHERE id = $1`, [req.params.id]);
    if (pz.rowCount === 0) return res.status(404).json({ error: "not_found" });
    const ans = await pool.query(
      `SELECT word FROM words WHERE jamo_key = $1 AND is_answer_ok ORDER BY freq DESC`,
      [pz.rows[0].jamo_key]
    );
    res.json({ answers: ans.rows.map((r) => r.word) });
  } catch (e) {
    console.error("jamo/solutions error:", e);
    res.status(500).json({ error: "server_error" });
  }
});

module.exports = router;
