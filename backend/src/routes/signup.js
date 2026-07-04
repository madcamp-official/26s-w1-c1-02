const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

const router = express.Router();

router.post('/signup', async (req, res) => {
  const { username, email, password, nickname } = req.body;
  if (!username || !email || !password || !nickname) {
    return res.status(400).json({ message: '아이디, 이메일, 비밀번호, 닉네임을 모두 입력해주세요.' });
  }

  const existing = await User.findOne({ username });
  if (existing) {
    return res.status(409).json({ message: '이미 사용 중인 아이디입니다.' });
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const user = await User.create({ username, email, password: hashedPassword, nickname });

  const token = jwt.sign(
    { userId: user._id, username: user.username, nickname: user.nickname },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );

  res.status(201).json({
    token,
    user: { id: user._id, username: user.username, email: user.email, nickname: user.nickname },
  });
});

module.exports = router;
