// 자음 모음 조합 게임 REST API — 조회/검증 로직은 puzzle.js 공용 헬퍼 사용 (멀티플레이 엔진과 공유)
const express = require("express");
const { pool } = require("../db");
const puzzle = require("./puzzle");
const { createProgressRouter } = require("../progress/api");

const router = express.Router();
router.use(createProgressRouter("jamo")); // /level-clear, /progress (공용 레벨 진행도 API)

// 난이도 → 음절 수 범위
const DIFF = { 1: [2, 2], 2: [2, 3], 3: [3, 4] };

// GET /api/games/jamo/new?difficulty=2  → 새 문제 발급
router.get("/new", async (req, res) => {
  const difficulty = Math.min(3, Math.max(1, parseInt(req.query.difficulty, 10) || 1));
  const [minS, maxS] = DIFF[difficulty];
  try {
    const seed = await puzzle.pickSeed(minS, maxS);
    if (!seed) return res.status(503).json({ error: "no_seed_words" });

    const { count: solutionCount } = await puzzle.solutionStats(seed.jamo_key);
    const jamo = puzzle.shuffle(puzzle.decompose(seed.word));
    const ins = await pool.query(
      `INSERT INTO jamo_puzzles (jamo_key, jamo_display, difficulty, solution_count, source_word_id, expires_at)
       VALUES ($1,$2,$3,$4,$5, now() + interval '5 minutes')
       RETURNING id`,
      [seed.jamo_key, JSON.stringify(jamo), difficulty, solutionCount, seed.id]
    );

    res.json({
      puzzleId: ins.rows[0].id,
      jamo,
      difficulty,
      solutionCount,
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
    const pzRow = pz.rows[0];

    const { correct, reason } = await puzzle.validateWord(String(word).trim(), pzRow.jamo_key);

    // 점수: 기본 + 자모 개수 보너스 + 시간 보너스
    let score = 0;
    if (correct) {
      const jamoN = pzRow.jamo_display.length;
      const timeBonus = Math.max(0, 60 - Math.floor((elapsedMs || 0) / 1000)) * 2;
      score = 50 + jamoN * 10 + timeBonus + pzRow.difficulty * 10;
    }

    await pool.query(
      `INSERT INTO game_results (game, user_id, puzzle_id, submitted_word, is_correct, score, elapsed_ms, mode)
       VALUES ('jamo',$1,$2,$3,$4,$5,$6,'solo')`,
      [req.userId || null, puzzleId, word, correct, score, elapsedMs || null]
    );

    if (correct && req.userId) {
      await pool.query(
        `INSERT INTO user_game_progress (user_id, game, level, exp, cleared_count, best_score, updated_at)
         VALUES ($1, 'jamo', 1, $2, 1, $2, now())
         ON CONFLICT (user_id, game) DO UPDATE SET
           exp           = user_game_progress.exp + $2,
           cleared_count = user_game_progress.cleared_count + 1,
           best_score     = GREATEST(user_game_progress.best_score, $2),
           updated_at     = now()`,
        [req.userId, score]
      );
    }

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
    const answers = await puzzle.getSolutions(pz.rows[0].jamo_key);
    res.json({ answers });
  } catch (e) {
    console.error("jamo/solutions error:", e);
    res.status(500).json({ error: "server_error" });
  }
});

module.exports = router;
