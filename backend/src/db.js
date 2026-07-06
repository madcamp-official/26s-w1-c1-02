const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

// 단일 DB: PostgreSQL. 계정(users) + 게임 데이터(words / jamo_puzzles / game_results 등) 모두 여기에 저장.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgres://mgh:mgh_dev_pw@localhost:5432/minigameheaven",
});

// 스키마 적용 (idempotent). 공유 코어(계정 포함) → 각 게임 모듈 순서로 실행.
// 새 게임 모듈을 추가하면 여기에 해당 모듈의 schema.sql 경로만 덧붙이면 됨.
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
