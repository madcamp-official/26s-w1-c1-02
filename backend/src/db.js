const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgres://mgh:mgh_dev_pw@localhost:5432/minigameheaven",
});

// 스키마 적용 (idempotent)
async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, "..", "db", "schema.sql"), "utf8");
  await pool.query(sql);
}

module.exports = { pool, migrate };
