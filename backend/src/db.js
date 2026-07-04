const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgres://mgh:mgh_dev_pw@localhost:5432/minigameheaven",
});

// 스키마 적용 (idempotent). 공유 코어 → 각 게임 모듈 순서로 실행.
// 새 기능(로그인 등)을 추가하면 여기에 해당 모듈의 schema.sql 경로만 덧붙이면 됨.
const SCHEMA_FILES = [
  path.join(__dirname, "schema.sql"),
  path.join(__dirname, "vowel_game", "schema.sql"),
];

async function migrate() {
  for (const file of SCHEMA_FILES) {
    await pool.query(fs.readFileSync(file, "utf8"));
  }
}

module.exports = { pool, migrate };
