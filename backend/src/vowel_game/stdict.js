// 국립국어원 표준국어대사전 Open API 폴백 검증.
// 로컬 DB에 없는 단어만 조회 → 결과를 words 에 캐시(source='stdict').
// STDICT_API_KEY 가 없으면 비활성(항상 false 반환) → 로컬 DB만으로 동작.
const { pool } = require("../db");
const { decompose, jamoKey } = require("./jamo");

const KEY = process.env.STDICT_API_KEY || "";
const ENDPOINT = "https://stdict.korean.go.kr/api/search.do";

// 부정 캐시: "사전에 없음"으로 확인된 단어의 재조회 방지.
// 긍정 결과는 words 테이블에 캐시되지만 부정 결과는 저장할 곳이 없어
// 같은 오답을 낼 때마다 외부 API 를 다시 때리게 됨 → 메모리 캐시로 차단.
const NEG_TTL_MS = 60 * 60 * 1000;
const NEG_MAX = 5000;
const negCache = new Map(); // word -> 만료 시각(ms)

function syllableCount(word) {
  let n = 0; for (const ch of word) { const c = ch.codePointAt(0); if (c >= 0xac00 && c <= 0xd7a3) n++; } return n;
}

// 표제어로 존재하는지 조회. 존재하면 words 에 캐시하고 true.
async function lookupAndCache(word) {
  if (!KEY) return false;
  const negUntil = negCache.get(word);
  if (negUntil) {
    if (negUntil > Date.now()) return false;
    negCache.delete(word);
  }
  const url = `${ENDPOINT}?key=${encodeURIComponent(KEY)}&type_search=search&req_type=json&q=${encodeURIComponent(word)}`;
  let found = false;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!r.ok) return false;
    const data = await r.json();
    const total = data?.channel?.total ?? 0;
    // 정확히 그 표제어가 있는지 확인 (item 은 단일 결과 시 객체일 수 있어 배열 정규화)
    const raw = data?.channel?.item;
    const items = Array.isArray(raw) ? raw : raw ? [raw] : [];
    found = total > 0 && items.some((it) => (it.word || "").replace(/[-^]/g, "") === word);
  } catch (e) {
    return false; // 네트워크/rate-limit 실패 시 조용히 폴백 안함 (일시 장애일 수 있어 부정 캐시도 안함)
  }
  if (found) {
    await pool.query(
      `INSERT INTO words (word, jamo_key, syllable_count, jamo_count, pos, freq, is_puzzle_seed, is_answer_ok, source)
       VALUES ($1,$2,$3,$4,NULL,0,FALSE,TRUE,'stdict')
       ON CONFLICT (word) DO NOTHING`,
      [word, jamoKey(word), syllableCount(word), decompose(word).length]
    );
  } else {
    if (negCache.size >= NEG_MAX) negCache.delete(negCache.keys().next().value);
    negCache.set(word, Date.now() + NEG_TTL_MS);
  }
  return found;
}

module.exports = { lookupAndCache, enabled: !!KEY };
