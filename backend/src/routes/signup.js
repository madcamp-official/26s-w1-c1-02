const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { pool } = require("../db");

const router = express.Router();

router.post("/signup", async (req, res) => {
  try {
    const { username, email, password, nickname } = req.body || {};
    if (!username || !email || !password || !nickname) {
      return res.status(400).json({ message: "아이디, 이메일, 비밀번호, 닉네임을 모두 입력해주세요." });
    }

    const dup = await pool.query("SELECT 1 FROM users WHERE username = $1", [username]);
    if (dup.rowCount > 0) {
      return res.status(409).json({ message: "이미 사용 중인 아이디입니다." });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    let user;
    try {
      const { rows } = await pool.query(
        `INSERT INTO users (username, email, password_hash, nickname)
         VALUES ($1, $2, $3, $4)
         RETURNING id, username, email, nickname`,
        [username, email, passwordHash, nickname]
      );
      user = rows[0];
    } catch (e) {
      if (e.code === "23505") return res.status(409).json({ message: "이미 사용 중인 아이디입니다." }); // unique violation (동시 가입 경합)
      throw e;
    }

    const token = jwt.sign(
      { userId: user.id, username: user.username, nickname: user.nickname },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.status(201).json({
      token,
      user: { id: user.id, username: user.username, email: user.email, nickname: user.nickname },
    });
  } catch (err) {
    console.error("signup 실패:", err.message);
    res.status(500).json({ message: "서버 오류로 회원가입에 실패했습니다." });
  }
});

module.exports = router;
