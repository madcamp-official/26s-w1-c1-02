/* 자음 모음 조합 (vowel-game) — 백엔드 /api/games/jamo 연동.
   제시된 자모를 모두 사용해 실제 단어를 만들어 입력. 검증/채점은 서버.
   window.VowelGame.mount(container, { onExit }) => cleanup */
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

  // 단어/자모 → 기본 자모 조각 배열 (서버 jamo.js 와 동일 규칙)
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

  window.VowelGame = {
    mount(container, opts = {}) {
      const onExit = opts.onExit || (() => {});
      let puzzle = null, timer = null, remain = 0, ended = false, difficulty = 2, score = 0;

      const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

      async function loadPuzzle() {
        clearInterval(timer);
        renderLoading();
        try {
          const r = await fetch(`/api/games/jamo/new?difficulty=${difficulty}`);
          if (!r.ok) throw new Error("서버 응답 오류");
          puzzle = await r.json();
          remain = puzzle.timeLimit || 60; ended = false;
          render();
          timer = setInterval(tick, 1000);
        } catch (e) {
          container.innerHTML = `<div class="vg-wrap"><div class="vg-error">문제를 불러오지 못했어요 😢<br><button class="btn" id="vg-retry">다시 시도</button></div></div>`;
          container.querySelector("#vg-retry").addEventListener("click", loadPuzzle);
        }
      }

      function renderLoading() {
        container.innerHTML = `<div class="vg-wrap"><div class="vg-error">문제 준비 중…</div></div>`;
      }

      function render() {
        const diffBtn = (d, label) =>
          `<button class="vg-diff${difficulty === d ? " active" : ""}" data-diff="${d}">${label}</button>`;
        container.innerHTML = `
          <div class="vg-wrap">
            <div class="vg-hud">
              <div class="sd-pill accent"><div class="l">남은 시간</div><div class="v" id="vg-time">${fmt(remain)}</div></div>
              <div class="sd-pill"><div class="l">점수</div><div class="v" id="vg-score">${score}</div></div>
              <div style="flex:1"></div>
              <div class="vg-diffseg">${diffBtn(1, "초급")}${diffBtn(2, "중급")}${diffBtn(3, "고급")}</div>
              <button class="btn" id="vg-new">🔄 새 문제</button>
            </div>

            <div class="vg-board">
              <div class="vg-caption">이 자음·모음을 <b>모두 사용</b>해 단어를 만드세요</div>
              <div class="vg-tiles" id="vg-tiles">
                ${puzzle.jamo.map((j, i) => `<div class="vg-tile" data-i="${i}">${j}</div>`).join("")}
              </div>
              <div class="vg-inputrow">
                <input class="vg-input" id="vg-input" placeholder="단어 입력 (한글)" autocomplete="off" autocapitalize="off" />
                <button class="btn primary" id="vg-submit">제출</button>
              </div>
              <div class="vg-result" id="vg-result"></div>
            </div>

            <div class="vg-hint">제시된 자모를 모두 써서 실제 단어를 입력하세요 · 정답 후보 ${puzzle.solutionCount}개</div>
          </div>`;

        const input = container.querySelector("#vg-input");
        input.addEventListener("input", updateTiles);
        input.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
        container.querySelector("#vg-submit").addEventListener("click", submit);
        container.querySelector("#vg-new").addEventListener("click", loadPuzzle);
        container.querySelectorAll("[data-diff]").forEach((b) =>
          b.addEventListener("click", () => { difficulty = +b.dataset.diff; loadPuzzle(); }));
        input.focus();
        updateTiles();
      }

      function updateTiles() {
        if (ended) return;
        const input = container.querySelector("#vg-input");
        const typed = decompose(input.value);
        const have = countMap(typed);
        const tiles = container.querySelectorAll(".vg-tile");
        const remainCount = { ...have };
        tiles.forEach((el) => {
          const j = el.textContent;
          if (remainCount[j] > 0) { el.classList.add("used"); remainCount[j]--; }
          else el.classList.remove("used");
        });
        // 남은 자모(입력에 있으나 타일에 없는 것) → 잘못된 자모
        const extra = Object.values(remainCount).some((n) => n > 0);
        const exact = sameMultiset(typed, puzzle.jamo);
        input.classList.toggle("bad", extra);
        input.classList.toggle("ready", exact && !extra);
      }

      function tick() {
        if (ended) return;
        remain--;
        const t = container.querySelector("#vg-time");
        if (t) t.textContent = fmt(remain);
        if (remain <= 0) timeUp();
      }

      async function submit() {
        if (ended || !puzzle) return;
        const input = container.querySelector("#vg-input");
        const word = input.value.trim();
        if (!word) return;
        const elapsedMs = ((puzzle.timeLimit || 60) - remain) * 1000;
        try {
          const r = await fetch("/api/games/jamo/submit", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ puzzleId: puzzle.puzzleId, word, elapsedMs }),
          });
          const data = await r.json();
          if (data.correct) { win(data); }
          else { showWrong(data.reason); }
        } catch (e) {
          showResult(`<span class="bad-msg">네트워크 오류로 제출 실패</span>`);
        }
      }

      function win(data) {
        ended = true; clearInterval(timer);
        score += data.score;
        const sc = container.querySelector("#vg-score"); if (sc) sc.textContent = score;
        showResult(`
          <div class="vg-win">🎉 정답! <b>${data.matched}</b> <span class="plus">+${data.score}점</span></div>
          <button class="btn primary" id="vg-next">다음 문제 →</button>`);
        container.querySelector("#vg-next").addEventListener("click", loadPuzzle);
        container.querySelector("#vg-submit").disabled = true;
      }

      function showWrong(reason) {
        const msg = reason === "JAMO_MISMATCH" ? "제시된 자모를 정확히 다 써야 해요."
          : reason === "NOT_IN_DICTIONARY" ? "사전에 없는 단어예요."
          : reason === "puzzle_not_found_or_expired" ? "문제가 만료됐어요. 새 문제를 받으세요."
          : "다시 시도해 주세요.";
        showResult(`<span class="bad-msg">✕ ${msg}</span>`);
      }

      async function timeUp() {
        ended = true; clearInterval(timer);
        let answers = [];
        try {
          const r = await fetch(`/api/games/jamo/puzzle/${puzzle.puzzleId}/solutions`);
          answers = (await r.json()).answers || [];
        } catch (e) {}
        showResult(`
          <div class="vg-lose">⏱ 시간 종료! 정답: <b>${answers.join(", ") || "-"}</b></div>
          <button class="btn primary" id="vg-next">새 문제 →</button>`);
        container.querySelector("#vg-next").addEventListener("click", loadPuzzle);
        container.querySelector("#vg-submit").disabled = true;
      }

      function showResult(html) {
        const box = container.querySelector("#vg-result");
        if (box) box.innerHTML = html;
      }

      loadPuzzle();
      return () => clearInterval(timer);
    },
  };
})();
