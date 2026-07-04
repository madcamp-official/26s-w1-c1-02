// 한글 자모 분해/조합 유틸 (호환 자모 U+3130 블록 기준)
// 조각 단위 = 초성/중성/종성 자모 (겹받침·이중모음은 통으로 유지).
// 초성 ㄱ 과 종성 ㄱ 은 같은 조각("ㄱ")으로 취급 → 위치 무관 자모 조합.

const BASE = 0xac00;
const N_JUNG = 21;
const N_JONG = 28;

// 호환 자모 문자 배열
const CHO = ["ㄱ","ㄲ","ㄴ","ㄷ","ㄸ","ㄹ","ㅁ","ㅂ","ㅃ","ㅅ","ㅆ","ㅇ","ㅈ","ㅉ","ㅊ","ㅋ","ㅌ","ㅍ","ㅎ"];
const JUNG = ["ㅏ","ㅐ","ㅑ","ㅒ","ㅓ","ㅔ","ㅕ","ㅖ","ㅗ","ㅘ","ㅙ","ㅚ","ㅛ","ㅜ","ㅝ","ㅞ","ㅟ","ㅠ","ㅡ","ㅢ","ㅣ"];
const JONG = ["","ㄱ","ㄲ","ㄳ","ㄴ","ㄵ","ㄶ","ㄷ","ㄹ","ㄺ","ㄻ","ㄼ","ㄽ","ㄾ","ㄿ","ㅀ","ㅁ","ㅂ","ㅄ","ㅅ","ㅆ","ㅇ","ㅈ","ㅊ","ㅋ","ㅌ","ㅍ","ㅎ"];

const CHO_IDX = new Map(CHO.map((c, i) => [c, i]));
const JUNG_IDX = new Map(JUNG.map((c, i) => [c, i]));
const JONG_IDX = new Map(JONG.map((c, i) => [c, i]));

function isSyllable(code) { return code >= BASE && code <= 0xd7a3; }

// 단어 → 자모 조각 배열. 예: "학교" → ["ㅎ","ㅏ","ㄱ","ㄱ","ㅛ"]
function decompose(word) {
  const out = [];
  for (const ch of word) {
    const code = ch.codePointAt(0);
    if (isSyllable(code)) {
      const s = code - BASE;
      const cho = Math.floor(s / (N_JUNG * N_JONG));
      const jung = Math.floor((s % (N_JUNG * N_JONG)) / N_JONG);
      const jong = s % N_JONG;
      out.push(CHO[cho], JUNG[jung]);
      if (jong > 0) out.push(JONG[jong]);
    } else if (CHO_IDX.has(ch) || JUNG_IDX.has(ch) || JONG_IDX.has(ch)) {
      out.push(ch); // 이미 낱자 자모
    }
    // 그 외(공백/기호)는 무시
  }
  return out;
}

// 자모 멀티셋 정렬 키. 예: "학교" → "ㄱㄱㅎㅏㅛ"
function jamoKey(word) {
  return decompose(word).sort().join("");
}

// 자모 배열 두 개가 같은 멀티셋인지 (문제 자모 == 단어 자모)
function sameJamoSet(a, b) {
  if (a.length !== b.length) return false;
  return [...a].sort().join("") === [...b].sort().join("");
}

// 초/중/종 인덱스로 음절 하나 조합
function composeSyllable(cho, jung, jong = 0) {
  return String.fromCodePoint(BASE + (cho * N_JUNG + jung) * N_JONG + jong);
}

module.exports = { decompose, jamoKey, sameJamoSet, composeSyllable, CHO, JUNG, JONG, isSyllable };
