/* 자음 모음 조합 (vowel-game) — 레벨제 + 연속 타이머.
   레벨 = 제한 시간 안에 목표 단어 수를 모두 맞추면 클리어(→ 다음 레벨 해금).
   시간이 0이 되면 게임오버. 점수 없음. 진행도는 localStorage 저장.
   검증/문제는 백엔드 /api/games/jamo. window.VowelGame.mount(container,{onExit})=>cleanup */
(function () {
  const CHO = ["ㄱ","ㄲ","ㄴ","ㄷ","ㄸ","ㄹ","ㅁ","ㅂ","ㅃ","ㅅ","ㅆ","ㅇ","ㅈ","ㅉ","ㅊ","ㅋ","ㅌ","ㅍ","ㅎ"];
  const JUNG = ["ㅏ","ㅐ","ㅑ","ㅒ","ㅓ","ㅔ","ㅕ","ㅖ","ㅗ","ㅘ","ㅙ","ㅚ","ㅛ","ㅜ","ㅝ","ㅞ","ㅟ","ㅠ","ㅡ","ㅢ","ㅣ"];
  const JONG = ["","ㄱ","ㄲ","ㄳ","ㄴ","ㄵ","ㄶ","ㄷ","ㄹ","ㄺ","ㄻ","ㄼ","ㄽ","ㄾ","ㄿ","ㅀ","ㅁ","ㅂ","ㅄ","ㅅ","ㅆ","ㅇ","ㅈ","ㅊ","ㅋ","ㅌ","ㅍ","ㅎ"];

  // 합성 자모 → 기본 자모 (서버 jamo.js 의 SPLIT 과 동일해야 함)
  const SPLIT = {
    "ㄲ":["ㄱ","ㄱ"],"ㄸ":["ㄷ","ㄷ"],"ㅃ":["ㅂ","ㅂ"],"ㅆ":["ㅅ","ㅅ"],"ㅉ":["ㅈ","ㅈ"],
    "ㄳ":["ㄱ","ㅅ"],"ㄵ":["ㄴ","ㅈ"],"ㄶ":["ㄴ","ㅎ"],"ㄺ":["ㄹ","ㄱ"],"ㄻ":["ㄹ","ㅁ"],
    "ㄼ":["ㄹ","ㅂ"],"ㄽ":["ㄹ","ㅅ"],"ㄾ":["ㄹ","ㅌ"],"ㄿ":["ㄹ","ㅍ"],"ㅀ":["ㄹ","ㅎ"],"ㅄ":["ㅂ","ㅅ"],
    "ㅘ":["ㅗ","ㅏ"],"ㅙ":["ㅗ","ㅐ"],"ㅚ":["ㅗ","ㅣ"],"ㅝ":["ㅜ","ㅓ"],"ㅞ":["ㅜ","ㅔ"],"ㅟ":["ㅜ","ㅣ"],"ㅢ":["ㅡ","ㅣ"],
  };
  const pushJamo = (out, ch) => { if (SPLIT[ch]) out.push(...SPLIT[ch]); else out.push(ch); };

  function decompose(word) {
    const out = [];
    for (const ch of word) {
      const c = ch.codePointAt(0);
      if (c >= 0xac00 && c <= 0xd7a3) {
        const s = c - 0xac00;
        pushJamo(out, CHO[Math.floor(s / 588)]);
        pushJamo(out, JUNG[Math.floor((s % 588) / 28)]);
        const jong = s % 28; if (jong > 0) pushJamo(out, JONG[jong]);
      } else if (/[ㄱ-ㅎㅏ-ㅣ]/.test(ch)) {
        pushJamo(out, ch);
      }
    }
    return out;
  }
  const countMap = (arr) => arr.reduce((m, x) => ((m[x] = (m[x] || 0) + 1), m), {});
  const sameMultiset = (a, b) => {
    if (a.length !== b.length) return false;
    const ma = countMap(a), mb = countMap(b);
    return Object.keys(ma).every((k) => ma[k] === mb[k]) && Object.keys(mb).length === Object.keys(ma).length;
  };

  // ---------- 레벨 설정 (조정 쉬움) ----------
  const MAX_LEVEL = 20;
  const LS_KEY = "mgh.vowel.cleared";
  const getCleared = () => Math.min(MAX_LEVEL, Math.max(0, parseInt(localStorage.getItem(LS_KEY), 10) || 0));
  const setCleared = (n) => localStorage.setItem(LS_KEY, String(Math.min(MAX_LEVEL, n)));

  function levelConfig(n) {
    const difficulty = n <= 7 ? 1 : n <= 14 ? 2 : 3; // 음절 수: 2 / 2~3 / 3~4
    const goal = 2 + Math.ceil(n / 4);               // 목표 단어 수 3~7
    const timeLimit = 50 + goal * 8;                 // 연속 제한시간(초)
    return { difficulty, goal, timeLimit };
  }
  const fmt = (s) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.max(0, s) % 60).padStart(2, "0")}`;

  window.VowelGame = {
    mount(container, opts = {}) {
      let timer = null;
      let level = 1, cfg = null, remain = 0, solved = 0, ended = true, puzzle = null;

      const stop = () => { clearInterval(timer); timer = null; };

      // ================= 레벨 선택 =================
      function showLevelSelect() {
        stop(); ended = true;
        const cleared = getCleared();
        let cells = "";
        for (let n = 1; n <= MAX_LEVEL; n++) {
          const st = n <= cleared ? "cleared" : n === cleared + 1 ? "current" : "locked";
          cells += `<button class="vg-lvl ${st}" ${st === "locked" ? "disabled" : ""} data-lvl="${n}">${st === "locked" ? "🔒" : n}</button>`;
        }
        container.innerHTML = `
          <div class="vg-levels">
            <div class="vg-levels-head">레벨 선택 <span class="vg-levels-sub">깬 레벨 ${cleared} / ${MAX_LEVEL}</span></div>
            <div class="vg-level-grid">${cells}</div>
            <div class="vg-hint">제한 시간 안에 목표 단어를 모두 맞추면 클리어 · 다음 레벨이 열려요</div>
          </div>`;
        container.querySelectorAll("[data-lvl]").forEach((b) =>
          b.addEventListener("click", () => startLevel(+b.dataset.lvl)));
      }

      // ================= 레벨 플레이 =================
      function startLevel(n) {
        level = n; cfg = levelConfig(n); remain = cfg.timeLimit; solved = 0; ended = false; puzzle = null;
        stop(); timer = setInterval(tick, 1000);
        loadWord();
      }

      function tick() {
        if (ended) return;
        remain--;
        const t = container.querySelector("#vg-time"); if (t) t.textContent = fmt(remain);
        if (remain <= 0) gameOver();
      }

      async function loadWord() {
        if (ended) return;
        try {
          const r = await fetch(`/api/games/jamo/new?difficulty=${cfg.difficulty}`);
          if (!r.ok) throw new Error();
          puzzle = await r.json();
          if (!ended) renderPlay();
        } catch (e) {
          const box = container.querySelector("#vg-result");
          if (box) box.innerHTML = `<span class="bad-msg">문제 로드 실패, 재시도…</span>`;
          setTimeout(() => { if (!ended) loadWord(); }, 800);
        }
      }

      function renderPlay() {
        container.innerHTML = `
          <div class="vg-wrap">
            <div class="vg-hud">
              <div class="sd-pill accent"><div class="l">남은 시간</div><div class="v" id="vg-time">${fmt(remain)}</div></div>
              <div class="sd-pill"><div class="l">레벨</div><div class="v">${level}</div></div>
              <div class="sd-pill"><div class="l">진행</div><div class="v"><span id="vg-solved">${solved}</span> / ${cfg.goal}</div></div>
              <div style="flex:1"></div>
              <button class="btn" id="vg-quit">레벨 선택</button>
            </div>
            <div class="vg-board">
              <div class="vg-caption">이 자음·모음을 <b>모두 사용</b>해 단어를 만드세요</div>
              <div class="vg-tiles" id="vg-tiles">${puzzle.jamo.map((j, i) => `<div class="vg-tile" data-i="${i}">${j}</div>`).join("")}</div>
              <div class="vg-inputrow">
                <input class="vg-input" id="vg-input" placeholder="단어 입력 (한글)" autocomplete="off" autocapitalize="off" />
                <button class="btn primary" id="vg-submit">제출</button>
              </div>
              <div class="vg-result" id="vg-result"></div>
            </div>
            <div class="vg-hint">정답 후보 ${puzzle.solutionCount}개 · 목표 ${cfg.goal}단어를 시간 안에!</div>
          </div>`;
        const input = container.querySelector("#vg-input");
        input.addEventListener("input", updateTiles);
        input.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
        container.querySelector("#vg-submit").addEventListener("click", submit);
        container.querySelector("#vg-quit").addEventListener("click", showLevelSelect);
        input.focus();
      }

      function updateTiles() {
        if (ended) return;
        const input = container.querySelector("#vg-input");
        const typed = decompose(input.value);
        const have = countMap(typed);
        const remainCount = { ...have };
        container.querySelectorAll(".vg-tile").forEach((el) => {
          const j = el.textContent;
          if (remainCount[j] > 0) { el.classList.add("used"); remainCount[j]--; }
          else el.classList.remove("used");
        });
        const extra = Object.values(remainCount).some((n) => n > 0);
        const exact = sameMultiset(typed, puzzle.jamo);
        input.classList.toggle("bad", extra);
        input.classList.toggle("ready", exact && !extra);
      }

      async function submit() {
        if (ended || !puzzle) return;
        const input = container.querySelector("#vg-input");
        const word = input.value.trim(); if (!word) return;
        const elapsedMs = (cfg.timeLimit - remain) * 1000;
        try {
          const r = await fetch("/api/games/jamo/submit", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ puzzleId: puzzle.puzzleId, word, elapsedMs }),
          });
          const data = await r.json();
          if (data.correct) onCorrect(data);
          else showWrong(data.reason);
        } catch (e) { showResult(`<span class="bad-msg">네트워크 오류</span>`); }
      }

      function onCorrect(data) {
        if (ended) return;
        solved++;
        const s = container.querySelector("#vg-solved"); if (s) s.textContent = solved;
        if (solved >= cfg.goal) { levelClear(); return; }
        showResult(`<span class="ok-msg">✓ ${data.matched}</span>`);
        const inp = container.querySelector("#vg-input"); if (inp) { inp.value = ""; inp.disabled = true; }
        setTimeout(() => { if (!ended) loadWord(); }, 550); // 다음 단어 (타이머 유지)
      }

      function showWrong(reason) {
        const msg = reason === "JAMO_MISMATCH" ? "제시된 자모를 정확히 다 써야 해요."
          : reason === "NOT_IN_DICTIONARY" ? "사전에 없는 단어예요."
          : reason === "puzzle_not_found_or_expired" ? "문제가 만료됐어요."
          : "다시 시도해 주세요.";
        showResult(`<span class="bad-msg">✕ ${msg}</span>`);
      }

      function levelClear() {
        ended = true; stop();
        const wasNewUnlock = level > getCleared() && level < MAX_LEVEL;
        setCleared(Math.max(getCleared(), level));
        overlay(`
          <div class="big">🏆</div>
          <h2>레벨 ${level} 클리어!</h2>
          <p>${level === MAX_LEVEL ? "마지막 레벨까지 정복했어요!" : wasNewUnlock ? `레벨 ${level + 1} 해금!` : "다음 레벨로 계속!"}</p>
          <div class="row">
            ${level < MAX_LEVEL ? `<button class="btn primary" id="ov-next">레벨 ${level + 1} →</button>` : ""}
            <button class="btn" id="ov-select">레벨 선택</button>
          </div>`);
        bind("#ov-next", () => startLevel(level + 1));
        bind("#ov-select", showLevelSelect);
      }

      function gameOver() {
        if (ended) return;
        ended = true; stop();
        overlay(`
          <div class="big">⏱️</div>
          <h2>시간 종료!</h2>
          <p>레벨 ${level} · ${solved} / ${cfg.goal} 단어 완성</p>
          <div class="row">
            <button class="btn primary" id="ov-retry">다시 도전</button>
            <button class="btn" id="ov-select">레벨 선택</button>
          </div>`);
        bind("#ov-retry", () => startLevel(level));
        bind("#ov-select", showLevelSelect);
      }

      function overlay(html) {
        const o = document.createElement("div");
        o.className = "overlay";
        o.innerHTML = `<div class="modal">${html}</div>`;
        container.appendChild(o);
      }
      function bind(sel, fn) {
        const el = container.querySelector(sel);
        if (el) el.addEventListener("click", () => { const o = container.querySelector(".overlay"); if (o) o.remove(); fn(); });
      }
      function showResult(html) { const b = container.querySelector("#vg-result"); if (b) b.innerHTML = html; }

      showLevelSelect();
      return () => stop();
    },
  };
})();
