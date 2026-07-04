require("dotenv").config();
const http = require("http");
const express = require("express");
const { WebSocketServer } = require("ws");
const { connectDB, migrate } = require("./db");
const signupRouter = require("./routes/signup");
const loginRouter = require("./routes/login");
const jamoApi = require("./vowel_game/api");

const PORT = process.env.PORT || 8080;

const app = express();
app.use(express.json());

app.get("/health", (req, res) => res.type("text").send("ok"));

// 로그인/회원가입 API (MongoDB)
app.use("/api", signupRouter);
app.use("/api", loginRouter);

// 게임 API — 자음 모음 조합 (PostgreSQL)
app.use("/api/games/jamo", jamoApi);

const server = http.createServer(app);

// 실시간 채팅/멀티 (기존 브로드캐스트 유지)
const wss = new WebSocketServer({ server, path: "/ws" });
wss.on("connection", (ws) => {
  ws.on("message", (data) => {
    for (const client of wss.clients) {
      if (client.readyState === client.OPEN) client.send(data.toString());
    }
  });
});

async function start() {
  // MongoDB (계정) — 실패해도 게임 기능은 계속 동작하도록 비치명적 처리
  connectDB().catch((err) => console.error("MongoDB 연결 실패:", err.message));

  // PostgreSQL (게임) — 스키마 준비
  try {
    await migrate();
    console.log("db schema ready");
  } catch (e) {
    console.error("migrate failed (Postgres 연결 확인):", e.message);
  }

  server.listen(PORT, () => console.log(`server listening on ${PORT} (http api + ws)`));
}

start();
