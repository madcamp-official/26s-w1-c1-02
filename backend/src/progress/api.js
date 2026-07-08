// 게임별 레벨 진행도(레벨/클리어수) 공용 API — user_game_progress 테이블 하나를 여러 게임이 공유.
// game 이름만 다르게 넘겨 마운트하면 재사용 가능(예: jamo, spot). 라우터를 쓰는 쪽에서
// req.userId를 채워주는 인증 미들웨어(예: optionalAuth)를 먼저 태워야 한다.
const express = require("express");
const { pool } = require("../db");

// 싱글모드(레벨제) 게임 목록 — 유저 생성 시 이 게임들의 레벨 진행도를 0으로 초기화한다.
// 새 싱글 게임을 추가하면 여기에 식별자만 덧붙이면 됨(프론트 PROGRESS_GAMES 와 동일하게 유지).
const SOLO_GAMES = ["jamo", "spot", "wordchain"];

// ── 종합 레벨 시스템 ──────────────────────────────────────────────
// 싱글/멀티 게임에서 얻은 점수를 그대로 exp로 적립하고, exp EXP_PER_LEVEL 마다 레벨이 1 오른다.
// (레벨 1 = 0~4999 exp, 레벨 2 = 5000~9999 exp, ...)  user_game_progress.level/exp 컬럼이 종합값.
const EXP_PER_LEVEL = 5000;
const levelForExp = (exp) => Math.floor(Math.max(0, exp) / EXP_PER_LEVEL) + 1;

// 점수(gained)를 로그인 유저의 exp로 적립하고 종합 레벨을 재계산한다.
// userId 가 없으면(게스트) 아무것도 안 하고 null 반환 → 호출부에서 게스트 분기 불필요.
// opts.bestScore: 프로필 최고점수 비교용(기본은 gained; 숫자야구처럼 점수 개념이 없으면 0을 넘겨 미갱신).
// 갱신된 { level, exp } 반환.
async function awardExp(userId, amount, opts = {}) {
  const gained = Math.round(Number(amount) || 0);
  if (!userId || gained <= 0) return null;
  const best = opts.bestScore != null ? Math.round(Number(opts.bestScore) || 0) : gained;
  try {
    const { rows } = await pool.query(
      `INSERT INTO user_game_progress (user_id, exp, level, best_score, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (user_id) DO UPDATE SET
         exp        = user_game_progress.exp + $2,
         level      = floor((user_game_progress.exp + $2) / $5) + 1,
         best_score = GREATEST(user_game_progress.best_score, $4),
         updated_at = now()
       RETURNING level, exp`,
      [userId, gained, levelForExp(gained), best, EXP_PER_LEVEL]
    );
    return rows[0] || null;
  } catch (e) {
    console.error("awardExp error:", e.message);
    return null;
  }
}

// 멀티플레이 게임오버용: 각 소켓의 최종 점수를 로그인 유저 exp로 적립.
// entries: [{ id: socketId, score, bestScore? }]. userId 는 서버가 JWT 로 확인한
// sock.data.userId 만 신뢰(클라가 보낸 값이 아님). 적립 후 sock.data.level 을 갱신해
// 로비 접속자 목록에 바로 반영되게 한다(호출부에서 presence 재브로드캐스트).
async function awardScoresToSockets(io, entries) {
  for (const e of entries || []) {
    const sock = io.of("/").sockets.get(e && e.id);
    const userId = sock && sock.data && sock.data.userId;
    if (!userId) continue;
    const prog = await awardExp(userId, e.score, e.bestScore != null ? { bestScore: e.bestScore } : {});
    if (prog) sock.data.level = prog.level;
  }
}

// 유저의 현재 종합 레벨 조회(로비 표시용). 행이 없거나 오류면 1.
async function getUserLevel(userId) {
  if (!userId) return 1;
  try {
    const { rows } = await pool.query(`SELECT level FROM user_game_progress WHERE user_id = $1`, [userId]);
    return (rows[0] && rows[0].level) || 1;
  } catch (e) {
    console.error("getUserLevel error:", e.message);
    return 1;
  }
}

// 유저 생성 직후 호출. 모든 싱글 게임의 깬 레벨 수를 0(아직 못 깸 → 레벨 1만 열림)으로 초기화.
// 이미 행이 있으면 건드리지 않는다(idempotent).
async function initUserProgress(userId) {
  const meta = {};
  for (const g of SOLO_GAMES) meta[g] = { level: 0 };
  await pool.query(
    `INSERT INTO user_game_progress (user_id, meta, updated_at)
     VALUES ($1, $2::jsonb, now())
     ON CONFLICT (user_id) DO NOTHING`,
    [userId, JSON.stringify(meta)]
  );
}

function createProgressRouter(game) {
  const router = express.Router();

  // POST /level-clear { level }  → 프론트 레벨제에서 실제 클리어한 레벨 반영
  router.post("/level-clear", async (req, res) => {
    if (!req.userId) return res.status(401).json({ error: "login_required" });
    const level = parseInt(req.body && req.body.level, 10);
    if (!level || level < 1) return res.status(400).json({ error: "bad_request" });
    try {
      // meta[game].level = 깬(클리어한) 최고 레벨 = 깬 레벨 수. 0이면 아직 못 깸(레벨 1만 열림).
      // 레벨 n 클리어 → 값 n 저장 → 프론트에서 레벨 n+1 이 열린다.
      // 종합 경험치인 level/exp 컬럼은 여기서 건드리지 않는다(별도 시스템).
      await pool.query(
        `INSERT INTO user_game_progress (user_id, meta, updated_at)
         VALUES ($1, jsonb_build_object($2::text, jsonb_build_object('level', $3::int)), now())
         ON CONFLICT (user_id) DO UPDATE SET
           meta = COALESCE(user_game_progress.meta, '{}'::jsonb)
                  || jsonb_build_object($2::text, jsonb_build_object(
                       'level',
                       GREATEST(COALESCE((user_game_progress.meta #>> ARRAY[$2::text, 'level'])::int, 0), $3::int)
                     )),
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
        `SELECT level, exp, best_score, meta FROM user_game_progress WHERE user_id = $1`,
        [req.userId]
      );
      const row = rows[0];
      const gm = row && row.meta && row.meta[game];
      // soloLevel: 이 게임(=game)의 깬 레벨 수(0=아직 못 깸). level/exp/best_score 는 유저 단위 종합값.
      res.json({
        soloLevel: gm && gm.level != null ? gm.level : 0,
        level: (row && row.level) || 1,
        exp: (row && row.exp) || 0,
        best_score: (row && row.best_score) || 0,
        meta: (row && row.meta) || {},
      });
    } catch (e) {
      console.error(`${game}/progress error:`, e);
      res.status(500).json({ error: "server_error" });
    }
  });

  return router;
}

module.exports = {
  createProgressRouter,
  initUserProgress,
  SOLO_GAMES,
  EXP_PER_LEVEL,
  levelForExp,
  awardExp,
  awardScoresToSockets,
  getUserLevel,
};
