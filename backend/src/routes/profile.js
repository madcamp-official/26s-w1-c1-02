const express = require("express");
const { pool } = require("../db");

const router = express.Router();

// PATCH /api/profile/nickname  { nickname }  → 소셜 로그인 직후 실명 노출 방지용 닉네임 설정/변경
router.patch("/profile/nickname", async (req, res) => {
  if (!req.userId) return res.status(401).json({ message: "로그인이 필요합니다." });
  const nickname = (req.body && req.body.nickname || "").trim();
  if (!nickname || nickname.length > 20) {
    return res.status(400).json({ message: "닉네임은 1자 이상 20자 이하로 입력해주세요." });
  }
  try {
    const { rows } = await pool.query(
      "UPDATE users SET nickname = $1 WHERE id = $2 RETURNING nickname",
      [nickname, req.userId]
    );
    if (!rows[0]) return res.status(401).json({ message: "계정을 찾을 수 없습니다. 다시 로그인해주세요." });
    res.json({ nickname: rows[0].nickname });
  } catch (e) {
    console.error("profile/nickname error:", e.message);
    res.status(500).json({ message: "서버 오류로 닉네임을 저장하지 못했습니다." });
  }
});

module.exports = router;
