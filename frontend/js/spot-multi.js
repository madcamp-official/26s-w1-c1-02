/* 멀티플레이 다른 그림 찾기 — 실시간 대전 화면.
   서버(realtime/games/spot.js)가 라운드/채점/공개를 주도. 이 모듈은 표시 + 클릭 제출만 담당.
   두 격자에서 단 하나 다른 칸을 먼저 찾아 클릭하면 득점. 오답은 짧은 쿨다운.
   window.SpotMulti.mount(container, { socket, onExit, onFinish }) => cleanup */
(function () {
  const escape = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = (s) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.max(0, s) % 60).padStart(2, "0")}`;
  const medal = (i) => (i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`);

  window.SpotMulti = {
    mount(container, opts = {}) {
      const socket = opts.socket;
      const onExit = typeof opts.onExit === "function" ? opts.onExit : () => {};
      const onFinish = typeof opts.onFinish === "function" ? opts.onFinish : () => {};

      let round = null;        // { index, total, size, base, right, difficultyLabel, timeLimit }
      let remain = 0, ticker = null, mySolved = false, locked = false, scores = [];
      let solvedIds = new Set(); // 이번 라운드에서 이미 정답을 맞힌 플레이어 id

      const stopTicker = () => { if (ticker) { clearInterval(ticker); ticker = null; } };
      const $ = (sel) => container.querySelector(sel);

      function boardHtml(side) {
        const data = side === "L" ? round.base : round.right;
        const cells = data.map((emo, i) =>
          `<div class="sd-cell" data-i="${i}" data-side="${side}">${escape(emo)}</div>`).join("");
        return `<div class="sd-grid" style="grid-template-columns:repeat(${round.size},1fr)">${cells}</div>`;
      }

      // ---------- 라운드 화면 ----------
      function renderRound() {
        mySolved = false; locked = false;
        container.innerHTML = `
          <div class="vm-wrap">
            <div class="vm-top">
              <div class="sd-pill accent"><div class="l">남은 시간</div><div class="v" id="sm-time">${fmt(remain)}</div></div>
              <div class="sd-pill"><div class="l">문제</div><div class="v"><span id="sm-idx">${round.index}</span> / ${round.total}</div></div>
              <div class="sd-pill"><div class="l">난이도</div><div class="v">${escape(round.difficultyLabel)}</div></div>
              <div style="flex:1"></div>
              <div class="vm-solvedbar">찾은 사람 <b id="sm-solved">0</b> / <span id="sm-total">${scores.length || "?"}</span></div>
            </div>
            <div class="vm-main">
              <div class="sd-wrap">
                <div class="vg-caption">두 그림에서 <b>단 하나</b> 다른 칸을 먼저 찾아 클릭하세요!</div>
                <div class="sd-boards">
                  <div class="sd-board"><div class="cap">원본</div>${boardHtml("L")}</div>
                  <div class="sd-board"><div class="cap">바뀐 그림</div>${boardHtml("R")}</div>
                </div>
                <div class="vg-result" id="sm-result"></div>
              </div>
              <aside class="vm-score" id="sm-score"></aside>
            </div>
          </div>`;
        container.querySelectorAll(".sd-cell").forEach((el) =>
          el.addEventListener("click", () => onCell(Number(el.dataset.i))));
        paintScores();
      }

      function onCell(i) {
        if (!round || mySolved || locked) return;
        locked = true; // 응답 오기 전까지 잠금(연타 방지)
        socket.emit("spot:submit", { cell: i });
      }

      function markCell(i, cls) {
        container.querySelectorAll(`.sd-cell[data-i="${i}"]`).forEach((el) => el.classList.add(cls));
      }
      function flashMiss(i) {
        container.querySelectorAll(`.sd-cell[data-i="${i}"]`).forEach((el) => {
          el.classList.add("miss");
          setTimeout(() => el.classList.remove("miss"), 320);
        });
      }

      function paintScores() {
        const box = $("#sm-score");
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

      function setResult(html) { const b = $("#sm-result"); if (b) b.innerHTML = html; }

      function startTicker() {
        stopTicker();
        ticker = setInterval(() => {
          remain--;
          const t = $("#sm-time"); if (t) t.textContent = fmt(remain);
          if (remain <= 0) stopTicker();
        }, 1000);
      }

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
      const onProgress = (data) => {
        scores = data.scores || scores;
        solvedIds = new Set((data.solvers || []).map((s) => s.id));
        const s = $("#sm-solved"); if (s) s.textContent = data.solvedCount;
        const t = $("#sm-total"); if (t) t.textContent = data.total;
        paintScores();
      };
      const onResult = (data) => {
        if (data.correct) {
          mySolved = true; locked = true;
          if (typeof data.cell === "number") markCell(data.cell, "found");
          setResult(`<span class="ok-msg">✓ 정답! +${data.points}점</span>`);
        } else {
          // 오답: 쿨다운 동안 클릭 잠금
          const cd = Math.max(0, Number(data.cooldownMs) || 0);
          setResult(`<span class="bad-msg">✕ 틀렸어요 · ${(cd / 1000).toFixed(0)}초 후 다시 시도</span>`);
          setTimeout(() => { if (!mySolved) { locked = false; setResult(""); } }, cd || 0);
        }
      };
      const onReveal = (data) => {
        stopTicker();
        locked = true;
        scores = data.scores || scores;
        if (typeof data.diff === "number") markCell(data.diff, "found");

        const rs = (data.roundScores || []);
        const rsHtml = rs.length
          ? rs.map((r) => `<div class="vm-rs-row"><span>${r.rank}등 ${escape(r.name)}</span><span>+${r.points}</span></div>`).join("")
          : `<div class="vm-rs-row"><span class="sys">아무도 못 찾았어요</span></div>`;

        const head = data.reason === "allSolved" ? "✅ 모두 정답!" : "⏱️ 시간 종료";
        const el = $("#sm-result");
        if (el) {
          el.innerHTML = `
            <div class="vm-reveal-head">${head} · 정답 공개</div>
            <div class="vm-rs">${rsHtml}</div>
            <div class="vm-next">${data.index >= data.total ? "결과 집계 중…" : "다음 문제로 넘어갑니다…"}</div>`;
        }
        paintScores();
      };
      const onGameover = (data) => {
        stopTicker();
        onFinish();
        const list = (data.finalScores || []).map((s, i) =>
          `<div class="vm-final-row ${i === 0 ? "win" : ""}"><span class="vm-rank">${medal(i)}</span><span class="vm-name">${escape(s.name)}</span><span class="vm-pts">${s.score}점</span></div>`
        ).join("");
        const o = overlay(`
          <div class="big">🏆</div>
          <h2>게임 종료!</h2>
          <div class="vm-final">${list}</div>
          <div class="row"><button class="btn primary" id="sm-exit">대기실로</button></div>`);
        o.querySelector("#sm-exit").addEventListener("click", onExit);
      };
      const onNotice = (data) => setResult(`<span class="bad-msg">${escape(data && data.text ? data.text : data)}</span>`);

      socket.on("spot:round", onRound);
      socket.on("spot:progress", onProgress);
      socket.on("spot:result", onResult);
      socket.on("spot:reveal", onReveal);
      socket.on("spot:gameover", onGameover);
      socket.on("spot:notice", onNotice);

      container.innerHTML = `<div class="vm-wrap"><div class="vm-waiting">첫 문제를 준비 중입니다…</div></div>`;

      return () => {
        stopTicker();
        socket.off("spot:round", onRound);
        socket.off("spot:progress", onProgress);
        socket.off("spot:result", onResult);
        socket.off("spot:reveal", onReveal);
        socket.off("spot:gameover", onGameover);
        socket.off("spot:notice", onNotice);
      };
    },
  };
})();
