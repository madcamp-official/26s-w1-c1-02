// 시작용 단어 목록을 words 테이블에 적재.
// 사용: node src/vowel_game/seed.js [파일경로]  (기본: 같은 폴더의 words.txt)
const fs = require("fs");
const path = require("path");
const { pool, migrate } = require("../db");
const { decompose, jamoKey } = require("./jamo");

function syllableCount(word) {
  let n = 0;
  for (const ch of word) { const c = ch.codePointAt(0); if (c >= 0xac00 && c <= 0xd7a3) n++; }
  return n;
}

async function main() {
  const file = process.argv[2] || path.join(__dirname, "words.txt");
  const words = fs.readFileSync(file, "utf8").split(/\r?\n/).map((w) => w.trim()).filter(Boolean);

  await migrate();

  let inserted = 0, skipped = 0;
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const key = jamoKey(word);
    const sylls = syllableCount(word);
    const jamoCnt = decompose(word).length;
    // 출제용: 2~4음절만 (1음절은 애너그램이 너무 뻔함)
    const isSeed = sylls >= 2 && sylls <= 4;
    const res = await pool.query(
      `INSERT INTO words (word, jamo_key, syllable_count, jamo_count, pos, freq, is_puzzle_seed, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'seed')
       ON CONFLICT (word) DO NOTHING`,
      [word, key, sylls, jamoCnt, "명사", words.length - i, isSeed]
    );
    if (res.rowCount === 1) inserted++; else skipped++;
  }

  const { rows } = await pool.query("SELECT count(*)::int AS n, count(*) FILTER (WHERE is_puzzle_seed)::int AS seeds FROM words");
  console.log(`✅ 시드 완료: 신규 ${inserted}, 중복 ${skipped} | 총 단어 ${rows[0].n}, 출제후보 ${rows[0].seeds}`);
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
