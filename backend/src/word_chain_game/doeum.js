// 두음법칙(word-initial sound law) — 끝말잇기 다음 글자 판정에만 사용.
// ㄹ/ㄴ으로 시작하는 음절 중 특정 모음과 결합할 때만 적용되는 닫힌 규칙이라,
// 단어 목록을 외우는 대신 자모 조합으로 직접 계산한다.
//   ㄹ + (ㅣ,ㅑ,ㅕ,ㅛ,ㅠ,ㅖ,ㅒ) → ㅇ   예: 리→이, 량→양, 력→역
//   ㄹ + 그 외 모음            → ㄴ   예: 로→노, 루→누, 릉→능
//   ㄴ + (ㅣ,ㅑ,ㅕ,ㅛ,ㅠ,ㅖ,ㅒ) → ㅇ   예: 녀→여, 뇨→요, 니→이
const { CHO, JUNG } = require("../vowel_game/jamo");

const BASE = 0xac00;
const N_JUNG = 21;
const N_JONG = 28;
const Y_VOWELS = new Set(["ㅣ", "ㅑ", "ㅕ", "ㅛ", "ㅠ", "ㅖ", "ㅒ"]);

// 한 음절(글자 1개) → 두음법칙 변환형. 대상 아니면 null.
function doeumVariant(ch) {
  const code = ch.codePointAt(0);
  if (code < BASE || code > 0xd7a3) return null;
  const s = code - BASE;
  const choIdx = Math.floor(s / (N_JUNG * N_JONG));
  const jungIdx = Math.floor((s % (N_JUNG * N_JONG)) / N_JONG);
  const jong = s % N_JONG;
  const cho = CHO[choIdx];
  if (cho !== "ㄹ" && cho !== "ㄴ") return null;

  let newCho;
  if (cho === "ㄹ" && Y_VOWELS.has(JUNG[jungIdx])) newCho = "ㅇ";
  else if (cho === "ㄹ") newCho = "ㄴ";
  else if (cho === "ㄴ" && Y_VOWELS.has(JUNG[jungIdx])) newCho = "ㅇ";
  else return null;

  const newChoIdx = CHO.indexOf(newCho);
  const newCode = BASE + newChoIdx * N_JUNG * N_JONG + jungIdx * N_JONG + jong;
  return String.fromCodePoint(newCode);
}

// 다음 단어가 시작할 수 있는 글자 목록 (원본 + 두음법칙 변환형, 있으면).
function acceptableStarts(requiredChar) {
  const variant = doeumVariant(requiredChar);
  return variant ? [requiredChar, variant] : [requiredChar];
}

module.exports = { doeumVariant, acceptableStarts };
