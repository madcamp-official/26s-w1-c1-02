const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { pool } = require("../db");

const router = express.Router();

router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ message: "아이디와 비밀번호를 입력해주세요." });
    }

    const { rows } = await pool.query(
      "SELECT id, username, email, nickname, avatar, password_hash FROM users WHERE username = $1",
      [username]
    );
    const user = rows[0];
    if (!user) {
      return res.status(401).json({ message: "아이디 또는 비밀번호가 올바르지 않습니다." });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ message: "아이디 또는 비밀번호가 올바르지 않습니다." });
    }

    const token = jwt.sign(
      { userId: user.id, username: user.username, nickname: user.nickname },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      token,
      user: { id: user.id, username: user.username, email: user.email, nickname: user.nickname, avatar: user.avatar },
    });
  } catch (err) {
    console.error("login 실패:", err.message);
    res.status(500).json({ message: "서버 오류로 로그인에 실패했습니다." });
  }
});

module.exports = router;
