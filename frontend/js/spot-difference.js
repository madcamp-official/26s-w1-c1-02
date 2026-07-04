/* 다른 그림 찾기 (Spot the Difference) — asset-free, emoji-grid based.
   Exposes window.SpotDifference.mount(container, { onExit }) => cleanup fn. */
(function () {
  const POOL = ["🍎", "🍊", "🍋", "🍓", "🍇", "🍉", "🍑", "🥝", "🍒", "🥕", "🌽", "🍄", "🌸", "🌻", "🍀", "⭐", "🐱", "🐶", "🐰", "🐸"];
  const ROWS = 5, COLS = 5, DIFFS = 4, START_SECONDS = 90;

  function pick(arr, not) {
    let v;
    do { v = arr[Math.floor(Math.random() * arr.length)]; } while (v === not);
    return v;
  }

  function buildRound() {
    const total = ROWS * COLS;
    const base = Array.from({ length: total }, () => POOL[Math.floor(Math.random() * POOL.length)]);
    const right = base.slice();
    const diffIdx = new Set();
    while (diffIdx.size < DIFFS) diffIdx.add(Math.floor(Math.random() * total));
    diffIdx.forEach((i) => { right[i] = pick(POOL, base[i]); });
    return { base, right, diffs: diffIdx };
  }

  window.SpotDifference = {
    mount(container, opts = {}) {
      const onExit = opts.onExit || (() => {});
      let round = buildRound();
      let found = new Set();
      let seconds = START_SECONDS;
      let misses = 0;
      let timer = null;
      let ended = false;

      function fmt(s) {
        const m = Math.floor(s / 60), r = s % 60;
        return `${m}:${String(r).padStart(2, "0")}`;
      }

      function render() {
        container.innerHTML = `
          <div class="sd-wrap">
            <div class="sd-hud">
              <div class="sd-pill accent"><div class="l">남은 시간</div><div class="v" id="sd-time">${fmt(seconds)}</div></div>
              <div class="sd-pill"><div class="l">찾은 개수</div><div class="v"><span id="sd-found">${found.size}</span> / ${DIFFS}</div></div>
              <div class="sd-pill"><div class="l">실수</div><div class="v" id="sd-miss">${misses}</div></div>
              <div style="flex:1"></div>
              <button class="btn" id="sd-restart">🔄 새 문제</button>
            </div>
            <div class="sd-boards">
              <div class="sd-board"><div class="cap">원본</div>${grid("L")}</div>
              <div class="sd-board"><div class="cap">바뀐 그림</div>${grid("R")}</div>
            </div>
            <div class="sd-hint">두 그림에서 서로 <b>다른 칸</b>을 찾아 클릭하세요. 아무 쪽이나 눌러도 됩니다.</div>
          </div>`;

        container.querySelectorAll(".sd-cell").forEach((el) => {
          el.addEventListener("click", () => onCell(Number(el.dataset.i)));
        });
        container.querySelector("#sd-restart").addEventListener("click", restart);
      }

      function grid(side) {
        const data = side === "L" ? round.base : round.right;
        const cells = data.map((emo, i) => {
          const isFound = found.has(i);
          return `<div class="sd-cell${isFound ? " found" : ""}" data-i="${i}" data-side="${side}">${emo}</div>`;
        }).join("");
        return `<div class="sd-grid" style="grid-template-columns:repeat(${COLS},1fr)">${cells}</div>`;
      }

      function onCell(i) {
        if (ended) return;
        if (found.has(i)) return;
        if (round.diffs.has(i)) {
          found.add(i);
          container.querySelectorAll(`.sd-cell[data-i="${i}"]`).forEach((el) => el.classList.add("found"));
          container.querySelector("#sd-found").textContent = found.size;
          if (found.size === DIFFS) win();
        } else {
          misses++;
          seconds = Math.max(0, seconds - 3); // 오답 3초 감점
          container.querySelector("#sd-miss").textContent = misses;
          container.querySelector("#sd-time").textContent = fmt(seconds);
          container.querySelectorAll(`.sd-cell[data-i="${i}"]`).forEach((el) => {
            el.classList.add("miss");
            setTimeout(() => el.classList.remove("miss"), 320);
          });
          if (seconds === 0) lose();
        }
      }

      function tick() {
        if (ended) return;
        seconds--;
        const t = container.querySelector("#sd-time");
        if (t) t.textContent = fmt(seconds);
        if (seconds <= 0) lose();
      }

      function overlay(html) {
        const o = document.createElement("div");
        o.className = "overlay";
        o.innerHTML = `<div class="modal">${html}</div>`;
        container.appendChild(o);
        o.querySelector("#again")?.addEventListener("click", () => { o.remove(); restart(); });
        o.querySelector("#exit")?.addEventListener("click", () => { o.remove(); cleanup(); onExit(); });
      }

      function win() {
        ended = true; clearInterval(timer);
        const used = START_SECONDS - seconds;
        overlay(`
          <div class="big">🎉</div>
          <h2>클리어!</h2>
          <p>${fmt(used)} 만에 성공 · 실수 ${misses}회</p>
          <div class="row">
            <button class="btn primary" id="again">다시하기</button>
            <button class="btn" id="exit">목록으로</button>
          </div>`);
      }

      function lose() {
        if (ended) return;
        ended = true; clearInterval(timer);
        overlay(`
          <div class="big">⏱️</div>
          <h2>시간 종료</h2>
          <p>${found.size} / ${DIFFS} 개를 찾았어요</p>
          <div class="row">
            <button class="btn primary" id="again">다시하기</button>
            <button class="btn" id="exit">목록으로</button>
          </div>`);
      }

      function restart() {
        clearInterval(timer);
        round = buildRound(); found = new Set(); seconds = START_SECONDS; misses = 0; ended = false;
        render();
        timer = setInterval(tick, 1000);
      }

      function cleanup() { clearInterval(timer); }

      render();
      timer = setInterval(tick, 1000);
      return cleanup;
    },
  };
})();
