require("dotenv").config();
const http = require("http");
const express = require("express");
const { migrate } = require("./db");
const { attachRealtime } = require("./realtime/rooms");
const signupRouter = require("./routes/signup");
const loginRouter = require("./routes/login");
const jamoApi = require("./vowel_game/api");

const PORT = process.env.PORT || 8080;

const app = express();
app.use(express.json());

app.get("/health", (req, res) => res.type("text").send("ok"));

// 로그인/회원가입 API (PostgreSQL)
app.use("/api", signupRouter);
app.use("/api", loginRouter);

// 게임 API — 자음 모음 조합 (PostgreSQL)
app.use("/api/games/jamo", jamoApi);

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

  server.listen(PORT, () => console.log(`server listening on ${PORT} (http api + ws)`));
}

start();
