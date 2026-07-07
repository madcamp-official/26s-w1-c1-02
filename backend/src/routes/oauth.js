const express = require("express");
const jwt = require("jsonwebtoken");
const { pool } = require("../db");
const kakao = require("../oauth/kakao");
const google = require("../oauth/google");
const naver = require("../oauth/naver");

const router = express.Router();

async function findOrCreateSocialUser(provider, profile) {
  const { rows } = await pool.query(
    "SELECT id, username, email, nickname FROM users WHERE provider = $1 AND provider_id = $2",
    [provider, profile.providerId]
  );
  if (rows[0]) return { user: rows[0], isNew: false };

  const username = `${provider}_${profile.providerId}`;
  const nickname = profile.nickname || `${provider}유저`;
  const { rows: inserted } = await pool.query(
    `INSERT INTO users (username, email, nickname, provider, provider_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, username, email, nickname`,
    [username, profile.email, nickname, provider, profile.providerId]
  );
  return { user: inserted[0], isNew: true };
}

function issueTokenAndRedirect(res, user, isNew) {
  const token = jwt.sign(
    { userId: user.id, username: user.username, nickname: user.nickname },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
  const query = new URLSearchParams({ token, username: user.username, nickname: user.nickname }).toString();
  res.redirect(`/?${query}#${isNew ? "nickname-setup" : "lobby"}`);
}

router.get("/kakao", (req, res) => {
  res.redirect(kakao.getAuthUrl());
});

router.get("/kakao/callback", async (req, res) => {
  try {
    const { code } = req.query;
    if (!code) return res.status(400).send("인가 코드가 없습니다.");

    const accessToken = await kakao.getAccessToken(code);
    const profile = await kakao.getProfile(accessToken);
    const { user, isNew } = await findOrCreateSocialUser("kakao", profile);

    issueTokenAndRedirect(res, user, isNew);
  } catch (err) {
    console.error("kakao 로그인 실패:", err.message);
    res.redirect("/?social_error=1#login");
  }
});

router.get("/google", (req, res) => {
  res.redirect(google.getAuthUrl());
});

router.get("/google/callback", async (req, res) => {
  try {
    const { code } = req.query;
    if (!code) return res.status(400).send("인가 코드가 없습니다.");

    const accessToken = await google.getAccessToken(code);
    const profile = await google.getProfile(accessToken);
    const { user, isNew } = await findOrCreateSocialUser("google", profile);

    issueTokenAndRedirect(res, user, isNew);
  } catch (err) {
    console.error("google 로그인 실패:", err.message);
    res.redirect("/?social_error=1#login");
  }
});

router.get("/naver", (req, res) => {
  res.redirect(naver.getAuthUrl());
});

router.get("/naver/callback", async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!code) return res.status(400).send("인가 코드가 없습니다.");
    if (state !== naver.STATE) return res.status(400).send("잘못된 요청입니다.");

    const accessToken = await naver.getAccessToken(code, state);
    const profile = await naver.getProfile(accessToken);
    const { user, isNew } = await findOrCreateSocialUser("naver", profile);

    issueTokenAndRedirect(res, user, isNew);
  } catch (err) {
    console.error("naver 로그인 실패:", err.message);
    res.redirect("/?social_error=1#login");
  }
});

module.exports = router;
