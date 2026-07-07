/* 멀티플레이 자음·모음 조합 — 실시간 대전 화면.
   서버(realtime/games/vowel.js)가 라운드/힌트/채점/공개를 주도. 이 모듈은 표시 + 제출만 담당.
   window.VowelMulti.mount(container, { socket, onExit, onFinish }) => cleanup */
(function () {
  // 타일 하이라이트용 자모 분해 (백엔드 jamo.js SPLIT 과 동일 규칙)
  const SPLIT = {
    "ㄲ":["ㄱ","ㄱ"],"ㄸ":["ㄷ","ㄷ"],"ㅃ":["ㅂ","ㅂ"],"ㅆ":["ㅅ","ㅅ"],"ㅉ":["ㅈ","ㅈ"],
    "ㄳ":["ㄱ","ㅅ"],"ㄵ":["ㄴ","ㅈ"],"ㄶ":["ㄴ","ㅎ"],"ㄺ":["ㄹ","ㄱ"],"ㄻ":["ㄹ","ㅁ"],
    "ㄼ":["ㄹ","ㅂ"],"ㄽ":["ㄹ","ㅅ"],"ㄾ":["ㄹ","ㅌ"],"ㄿ":["ㄹ","ㅍ"],"ㅀ":["ㄹ","ㅎ"],"ㅄ":["ㅂ","ㅅ"],
    "ㅘ":["ㅗ","ㅏ"],"ㅙ":["ㅗ","ㅐ"],"ㅚ":["ㅗ","ㅣ"],"ㅝ":["ㅜ","ㅓ"],"ㅞ":["ㅜ","ㅔ"],"ㅟ":["ㅜ","ㅣ"],"ㅢ":["ㅡ","ㅣ"],
  };
  const CHO = ["ㄱ","ㄲ","ㄴ","ㄷ","ㄸ","ㄹ","ㅁ","ㅂ","ㅃ","ㅅ","ㅆ","ㅇ","ㅈ","ㅉ","ㅊ","ㅋ","ㅌ","ㅍ","ㅎ"];
  const JUNG = ["ㅏ","ㅐ","ㅑ","ㅒ","ㅓ","ㅔ","ㅕ","ㅖ","ㅗ","ㅘ","ㅙ","ㅚ","ㅛ","ㅜ","ㅝ","ㅞ","ㅟ","ㅠ","ㅡ","ㅢ","ㅣ"];
  const JONG = ["","ㄱ","ㄲ","ㄳ","ㄴ","ㄵ","ㄶ","ㄷ","ㄹ","ㄺ","ㄻ","ㄼ","ㄽ","ㄾ","ㄿ","ㅀ","ㅁ","ㅂ","ㅄ","ㅅ","ㅆ","ㅇ","ㅈ","ㅊ","ㅋ","ㅌ","ㅍ","ㅎ"];
  const push = (out, ch) => { if (SPLIT[ch]) out.push(...SPLIT[ch]); else out.push(ch); };
  function decompose(word) {
    const out = [];
    for (const ch of word) {
      const c = ch.codePointAt(0);
      if (c >= 0xac00 && c <= 0xd7a3) {
        const s = c - 0xac00;
        push(out, CHO[Math.floor(s / 588)]);
        push(out, JUNG[Math.floor((s % 588) / 28)]);
        const jong = s % 28; if (jong > 0) push(out, JONG[jong]);
      } else if (/[ㄱ-ㅎㅏ-ㅣ]/.test(ch)) push(out, ch);
    }
    return out;
  }
  const escape = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = (s) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.max(0, s) % 60).padStart(2, "0")}`;
  const medal = (i) => (i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`);

  window.VowelMulti = {
    mount(container, opts = {}) {
      const socket = opts.socket;
      const onExit = typeof opts.onExit === "function" ? opts.onExit : () => {};
      const onFinish = typeof opts.onFinish === "function" ? opts.onFinish : () => {};

      let round = null;       // { index, total, jamo, difficultyLabel, solutionCount, timeLimit }
      let remain = 0, ticker = null, mySolved = false, scores = [];
      let solvedIds = new Set(); // 이번 라운드에서 이미 정답을 맞힌 플레이어 id

      const stopTicker = () => { if (ticker) { clearInterval(ticker); ticker = null; } };
      const $ = (sel) => container.querySelector(sel);

      // ---------- 라운드 화면 ----------
      function renderRound() {
        mySolved = false;
        container.innerHTML = `
          <div class="vm-wrap">
            <div class="vm-top">
              <div class="sd-pill accent"><div class="l">남은 시간</div><div class="v" id="vm-time">${fmt(remain)}</div></div>
              <div class="sd-pill"><div class="l">문제</div><div class="v"><span id="vm-idx">${round.index}</span> / ${round.total}</div></div>
              <div class="sd-pill"><div class="l">난이도</div><div class="v">${escape(round.difficultyLabel)}</div></div>
              <div style="flex:1"></div>
              <div class="vm-solvedbar">맞힌 사람 <b id="vm-solved">0</b> / <span id="vm-total">${scores.length || "?"}</span></div>
            </div>
            <div class="vm-main">
              <div class="vg-board">
                <div class="vg-caption">이 자음·모음을 <b>모두 사용</b>해 단어를 만드세요 · 정답 후보 ${round.solutionCount}개</div>
                <div class="vg-tiles" id="vm-tiles">${round.jamo.map((j) => `<div class="vg-tile">${escape(j)}</div>`).join("")}</div>
                <div class="vm-hint" id="vm-hint" hidden></div>
                <div class="vg-inputrow">
                  <input class="vg-input" id="vm-input" placeholder="단어 입력 (한글)" autocomplete="off" autocapitalize="off" />
                  <button class="btn primary" id="vm-submit">제출</button>
                </div>
                <div class="vg-result" id="vm-result"></div>
                <div class="vm-reveal" id="vm-reveal" hidden></div>
              </div>
              <aside class="vm-score" id="vm-score"></aside>
            </div>
          </div>`;
        const input = $("#vm-input");
        input.addEventListener("input", updateTiles);
        input.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
        $("#vm-submit").addEventListener("click", submit);
        input.focus();
        paintScores();
      }

      function updateTiles() {
        const input = $("#vm-input");
        if (!input || !round) return;
        const have = decompose(input.value).reduce((m, x) => ((m[x] = (m[x] || 0) + 1), m), {});
        container.querySelectorAll("#vm-tiles .vg-tile").forEach((el) => {
          const j = el.textContent;
          if (have[j] > 0) { el.classList.add("used"); have[j]--; } else el.classList.remove("used");
        });
        const extra = Object.values(have).some((n) => n > 0);
        input.classList.toggle("bad", extra);
      }

      function paintScores() {
        const box = $("#vm-score");
        if (!box) return;
        const header = `
          <div class="vm-score-h-row">
            <span class="vm-rank"></span>
            <span class="vm-name">참가자</span>
            <span class="vm-pts">점수</span>
          </div>`;
        box.innerHTML = header + scores.map((s, i) => {
          const solved = solvedIds.has(s.id);
          return `
            <div class="vm-score-row ${solved ? "solved" : "pending"}">
              <span class="vm-rank">${medal(i)}</span>
              <span class="vm-name">${escape(s.name)}</span>
              <span class="vm-pts">${s.score}</span>
            </div>`;
        }).join("");
      }

      function submit() {
        const input = $("#vm-input");
        if (!input || mySolved || !round) return;
        const word = input.value.trim();
        if (!word) return;
        socket.emit("vowel:submit", { word });
      }

      function setResult(html) { const b = $("#vm-result"); if (b) b.innerHTML = html; }

      function startTicker() {
        stopTicker();
        ticker = setInterval(() => {
          remain--;
          const t = $("#vm-time"); if (t) t.textContent = fmt(remain);
          if (remain <= 0) stopTicker();
        }, 1000);
      }

      // ---------- 오버레이 (공개 / 최종) ----------
      function overlay(html) {
        const prev = container.querySelector(".overlay"); if (prev) prev.remove();
        const o = document.createElement("div");
        o.className = "overlay";
        o.innerHTML = `<div class="modal vm-modal">${html}</div>`;
        container.appendChild(o);
        return o;
      }

      // ---------- 소켓 이벤트 ----------
      const onRound = (data) => {
        round = data;
        scores = data.scores || scores;
        solvedIds = new Set();
        remain = data.timeLimit;
        renderRound();
        startTicker();
      };
      const onHint = (data) => {
        const el = $("#vm-hint");
        if (el) { el.hidden = false; el.innerHTML = `💡 힌트: <b>${escape(data.hint)}</b>`; }
      };
      const onProgress = (data) => {
        scores = data.scores || scores;
        solvedIds = new Set((data.solvers || []).map((s) => s.id));
        const s = $("#vm-solved"); if (s) s.textContent = data.solvedCount;
        const t = $("#vm-total"); if (t) t.textContent = data.total;
        paintScores();
      };
      const onResult = (data) => {
        if (data.correct) {
          mySolved = true;
          const input = $("#vm-input"); if (input) { input.disabled = true; input.classList.remove("bad"); }
          const btn = $("#vm-submit"); if (btn) btn.disabled = true;
          setResult(`<span class="ok-msg">✓ 정답!</span>`);
        } else {
          const msg = data.reason === "JAMO_MISMATCH" ? "제시된 자모를 정확히 다 써야 해요."
            : data.reason === "NOT_IN_DICTIONARY" ? "사전에 없는 단어예요."
            : "다시 시도해 주세요.";
          setResult(`<span class="bad-msg">✕ ${msg}</span>`);
        }
      };
      const onReveal = (data) => {
        stopTicker();
        scores = data.scores || scores;
        // 라운드 종료 — 아직 제출 안 한 사람도 더 이상 입력 불가
        const input = $("#vm-input"); if (input) input.disabled = true;
        const btn = $("#vm-submit"); if (btn) btn.disabled = true;

        const answers = (data.answers || []).slice(0, 8).map((w) => `<span class="vm-ans">${escape(w)}</span>`).join("");
        const rs = (data.roundScores || []);
        const rsHtml = rs.length
          ? rs.map((r) => `<div class="vm-rs-row"><span>${r.rank}등 ${escape(r.name)}</span><span>+${r.points}</span></div>`).join("")
          : `<div class="vm-rs-row"><span class="sys">아무도 못 맞혔어요</span></div>`;

        const el = $("#vm-reveal");
        if (el) {
          el.hidden = false;
          el.innerHTML = `
            <div class="vm-reveal-head">${data.reason === "allSolved" ? "✅ 모두 정답!" : "⏱️ 시간 종료"} · 정답 공개</div>
            <div class="vm-answers">${answers}</div>
            <div class="vm-rs">${rsHtml}</div>
            <div class="vm-next">${data.index >= data.total ? "결과 집계 중…" : "다음 문제로 넘어갑니다…"}</div>`;
        }
      };
      const onGameover = (data) => {
        stopTicker();
        onFinish(); // roomView 에 "정상 종료" 알림 → 대기 상태여도 오버레이 유지
        const list = (data.finalScores || []).map((s, i) =>
          `<div class="vm-final-row ${i === 0 ? "win" : ""}"><span class="vm-rank">${medal(i)}</span><span class="vm-name">${escape(s.name)}</span><span class="vm-pts">${s.score}점</span></div>`
        ).join("");
        const o = overlay(`
          <div class="big">🏆</div>
          <h2>게임 종료!</h2>
          <div class="vm-final">${list}</div>
          <div class="row"><button class="btn primary" id="vm-exit">대기실로</button></div>`);
        o.querySelector("#vm-exit").addEventListener("click", onExit);
      };
      const onNotice = (data) => setResult(`<span class="bad-msg">${escape(data && data.text ? data.text : data)}</span>`);

      socket.on("vowel:round", onRound);
      socket.on("vowel:hint", onHint);
      socket.on("vowel:progress", onProgress);
      socket.on("vowel:result", onResult);
      socket.on("vowel:reveal", onReveal);
      socket.on("vowel:gameover", onGameover);
      socket.on("vowel:notice", onNotice);

      container.innerHTML = `<div class="vm-wrap"><div class="vm-waiting">첫 문제를 준비 중입니다…</div></div>`;

      return () => {
        stopTicker();
        socket.off("vowel:round", onRound);
        socket.off("vowel:hint", onHint);
        socket.off("vowel:progress", onProgress);
        socket.off("vowel:result", onResult);
        socket.off("vowel:reveal", onReveal);
        socket.off("vowel:gameover", onGameover);
        socket.off("vowel:notice", onNotice);
      };
    },
  };
})();
