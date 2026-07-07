require("dotenv").config();
const http = require("http");
const express = require("express");
const { migrate } = require("./db");
const { attachRealtime } = require("./realtime/rooms");
const signupRouter = require("./routes/signup");
const loginRouter = require("./routes/login");
const { optionalAuth } = require("./middleware/auth");
const oauthRouter = require("./routes/oauth");
const jamoApi = require("./vowel_game/api");
const { cleanupExpiredPuzzles } = require("./vowel_game/puzzle");

const PORT = process.env.PORT || 8080;

const app = express();
app.use(express.json());

app.get("/health", (req, res) => res.type("text").send("ok"));

// 로그인/회원가입 API (PostgreSQL)
app.use("/api", signupRouter);
app.use("/api", loginRouter);

// 소셜 로그인 (카카오/구글/네이버)
app.use("/auth", oauthRouter);

// 게임 API — 자음 모음 조합 (PostgreSQL)
app.use("/api/games/jamo", optionalAuth, jamoApi);

const server = http.createServer(app);

// 실시간 채팅 + 멀티플레이 방(생성/참가/비밀방/방장 모드변경) — Socket.IO
attachRealtime(server);

async function start() {
  // PostgreSQL — 계정 + 게임 스키마 준비
  try {
    await migrate();
    console.log("db schema ready");
  } catch (e) {
    console.error("migrate failed (Postgres 연결 확인):", e.message);
  }

  // 만료된 발급 문제 주기 삭제 (jamo_puzzles 무한 증식 방지)
  const sweep = () => cleanupExpiredPuzzles().catch((e) => console.error("puzzle cleanup failed:", e.message));
  sweep();
  setInterval(sweep, 10 * 60 * 1000);

  server.listen(PORT, () => console.log(`server listening on ${PORT} (http api + ws)`));
}

start();
