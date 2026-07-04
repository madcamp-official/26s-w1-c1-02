// 국립국어원 표준국어대사전 Open API 폴백 검증.
// 로컬 DB에 없는 단어만 조회 → 결과를 words 에 캐시(source='stdict').
// STDICT_API_KEY 가 없으면 비활성(항상 false 반환) → 로컬 DB만으로 동작.
const { pool } = require("../db");
const { decompose, jamoKey } = require("./jamo");

const KEY = process.env.STDICT_API_KEY || "";
const ENDPOINT = "https://stdict.korean.go.kr/api/search.do";

function syllableCount(word) {
  let n = 0; for (const ch of word) { const c = ch.codePointAt(0); if (c >= 0xac00 && c <= 0xd7a3) n++; } return n;
}

// 표제어로 존재하는지 조회. 존재하면 words 에 캐시하고 true.
async function lookupAndCache(word) {
  if (!KEY) return false;
  const url = `${ENDPOINT}?key=${encodeURIComponent(KEY)}&type_search=search&req_type=json&q=${encodeURIComponent(word)}`;
  let found = false;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!r.ok) return false;
    const data = await r.json();
    const total = data?.channel?.total ?? 0;
    // 정확히 그 표제어가 있는지 확인
    const items = data?.channel?.item || [];
    found = total > 0 && items.some((it) => (it.word || "").replace(/-/g, "") === word);
  } catch (e) {
    return false; // 네트워크/rate-limit 실패 시 조용히 폴백 안함
  }
  if (found) {
    await pool.query(
      `INSERT INTO words (word, jamo_key, syllable_count, jamo_count, pos, freq, is_puzzle_seed, is_answer_ok, source)
       VALUES ($1,$2,$3,$4,NULL,0,FALSE,TRUE,'stdict')
       ON CONFLICT (word) DO NOTHING`,
      [word, jamoKey(word), syllableCount(word), decompose(word).length]
    );
  }
  return found;
}

module.exports = { lookupAndCache, enabled: !!KEY };
