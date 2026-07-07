// 게임별 레벨 진행도(레벨/클리어수) 공용 API — user_game_progress 테이블 하나를 여러 게임이 공유.
// game 이름만 다르게 넘겨 마운트하면 재사용 가능(예: jamo, spot). 라우터를 쓰는 쪽에서
// req.userId를 채워주는 인증 미들웨어(예: optionalAuth)를 먼저 태워야 한다.
const express = require("express");
const { pool } = require("../db");

function createProgressRouter(game) {
  const router = express.Router();

  // POST /level-clear { level }  → 프론트 레벨제에서 실제 클리어한 레벨 반영
  router.post("/level-clear", async (req, res) => {
    if (!req.userId) return res.status(401).json({ error: "login_required" });
    const level = parseInt(req.body && req.body.level, 10);
    if (!level || level < 1) return res.status(400).json({ error: "bad_request" });
    try {
      await pool.query(
        `INSERT INTO user_game_progress (user_id, game, level, exp, cleared_count, best_score, updated_at)
         VALUES ($1, $2, $3, 0, 0, 0, now())
         ON CONFLICT (user_id, game) DO UPDATE SET
           level      = GREATEST(user_game_progress.level, $3),
           updated_at = now()`,
        [req.userId, game, level]
      );
      res.json({ ok: true });
    } catch (e) {
      console.error(`${game}/level-clear error:`, e);
      res.status(500).json({ error: "server_error" });
    }
  });

  // GET /progress  → 로그인한 유저의 현재 레벨/클리어 수
  router.get("/progress", async (req, res) => {
    if (!req.userId) return res.status(401).json({ error: "login_required" });
    try {
      const { rows } = await pool.query(
        `SELECT level, cleared_count FROM user_game_progress WHERE user_id = $1 AND game = $2`,
        [req.userId, game]
      );
      res.json(rows[0] || { level: 1, cleared_count: 0 });
    } catch (e) {
      console.error(`${game}/progress error:`, e);
      res.status(500).json({ error: "server_error" });
    }
  });

  return router;
}

module.exports = { createProgressRouter };
