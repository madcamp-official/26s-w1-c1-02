// 대량 명사 사전 적재 (CC0, 국립국어원 표준국어대사전 명사 목록 기반)
//   dict/nouns-common.txt → 출제용 seed(2~4음절) + 정답 인정
//   dict/nouns-all.txt    → 정답 인정용(broad)
// 사용: node src/vowel_game/seed-nouns.js
const fs = require("fs");
const path = require("path");
const { pool, migrate } = require("../db");
const { decompose, jamoKey } = require("./jamo");

const sylCount = (w) => { let n = 0; for (const ch of w) { const c = ch.codePointAt(0); if (c >= 0xac00 && c <= 0xd7a3) n++; } return n; };
const isPureHangul = (w) => { if (!w) return false; for (const ch of w) { const c = ch.codePointAt(0); if (c < 0xac00 || c > 0xd7a3) return false; } return true; };

const COLS = 9;
async function insertBatch(rows) {
  const values = [], params = [];
  rows.forEach((r, i) => {
    const b = i * COLS;
    values.push(`($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7},$${b+8},$${b+9})`);
    params.push(...r);
  });
  await pool.query(
    `INSERT INTO words (word,jamo_key,syllable_count,jamo_count,pos,freq,is_puzzle_seed,is_answer_ok,source)
     VALUES ${values.join(",")} ON CONFLICT (word) DO NOTHING`, params);
}

async function seedFile(file, { seed, source, freqBase }) {
  const words = fs.readFileSync(file, "utf8").split(/\r?\n/).map((w) => w.trim()).filter(isPureHangul);
  let batch = [], total = 0;
  for (const w of words) {
    const syl = sylCount(w);
    const isSeed = seed && syl >= 2 && syl <= 4;
    batch.push([w, jamoKey(w), syl, decompose(w).length, "명사", freqBase, isSeed, true, source]);
    if (batch.length >= 1000) { await insertBatch(batch); total += batch.length; batch = []; }
  }
  if (batch.length) { await insertBatch(batch); total += batch.length; }
  return total;
}

async function main() {
  await migrate();
  const dir = path.join(__dirname, "dict");
  console.log("common 적재…");
  const c = await seedFile(path.join(dir, "nouns-common.txt"), { seed: true, source: "common", freqBase: 100 });
  console.log(`  common ${c}건 처리`);
  console.log("all 적재… (시간 걸릴 수 있음)");
  const a = await seedFile(path.join(dir, "nouns-all.txt"), { seed: false, source: "stdict-noun", freqBase: 0 });
  console.log(`  all ${a}건 처리`);
  const { rows } = await pool.query("SELECT count(*)::int n, count(*) FILTER(WHERE is_puzzle_seed)::int seeds FROM words");
  console.log(`✅ 완료: 총 ${rows[0].n} 단어, 출제후보 ${rows[0].seeds}`);
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
