const http = require("http");
const express = require("express");
const { WebSocketServer } = require("ws");
const { migrate } = require("./db");
const jamoApi = require("./api-jamo");

const PORT = process.env.PORT || 8080;

const app = express();
app.use(express.json());

app.get("/health", (req, res) => res.type("text").send("ok"));

// 게임 API
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
  try {
    await migrate();
    console.log("db schema ready");
  } catch (e) {
    console.error("migrate failed (DB 연결 확인):", e.message);
  }
  server.listen(PORT, () => console.log(`server listening on ${PORT} (http api + ws)`));
}

start();
