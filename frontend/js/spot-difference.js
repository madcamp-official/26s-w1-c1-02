/* 다른 그림 찾기 (Spot the Difference) — 레벨제 싱글플레이.
   레벨 = 두 그림에서 '단 하나' 다른 칸을 제한 시간 안에 찾으면 클리어(→ 다음 레벨 해금).
   오답 클릭은 남은 시간을 깎는 페널티. 시간이 0이 되면 게임오버. 진행도는 localStorage 저장.
   레벨이 오를수록 격자가 커지고, 같은 크기 구간에서는 제한 시간이 줄어든다.
   window.SpotDifference.mount(container, { onExit }) => cleanup */
(function () {
  const POOL = ["🍎", "🍊", "🍋", "🍓", "🍇", "🍉", "🍑", "🥝", "🍒", "🥕", "🌽", "🍄", "🌸", "🌻", "🍀", "⭐", "🐱", "🐶", "🐰", "🐸", "🦊", "🐼", "🐵", "🐷"];

  const rand = (n) => Math.floor(Math.random() * n);
  function pick(arr, not) {
    let v;
    do { v = arr[rand(arr.length)]; } while (v === not);
    return v;
  }

  // ---------- 레벨 설정 (조정 쉬움) ----------
  const MAX_LEVEL = 20;
  const LS_KEY = "mgh.spot.cleared";
  const getCleared = () => Math.min(MAX_LEVEL, Math.max(0, parseInt(localStorage.getItem(LS_KEY), 10) || 0));
  const setCleared = (n) => localStorage.setItem(LS_KEY, String(Math.min(MAX_LEVEL, n)));

  // 3레벨마다 격자를 한 단계 키운다(4×4→10×10). 같은 크기 구간에서는 레벨마다 제한 시간이 줄고,
  // 격자가 커질수록 기본 시간과 오답 페널티가 함께 커진다. 그래서 난이도는 레벨마다 단조 증가.
  function levelConfig(n) {
    const band = Math.min(6, Math.floor((n - 1) / 3)); // 0..6 (격자 확대 단계)
    const size = 4 + band;                             // 4..10 (한 변 칸 수)
    const posInBand = (n - 1) % 3;                     // 같은 격자 크기 안에서의 순번(0,1,2)
    const baseSeconds = 22 + band * 5;                 // 격자가 클수록 스캔 시간 더 부여
    const seconds = baseSeconds - posInBand * 5;       // 같은 크기면 레벨마다 5초씩 감소
    const penalty = 3 + band;                          // 오답 감점(초): 3..9
    return { rows: size, cols: size, seconds, penalty };
  }

  function buildRound(rows, cols) {
    const total = rows * cols;
    const base = Array.from({ length: total }, () => POOL[rand(POOL.length)]);
    const right = base.slice();
    const diff = rand(total);          // 단 하나의 다른 칸
    right[diff] = pick(POOL, base[diff]);
    return { base, right, diff };
  }

  const fmt = (s) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.max(0, s) % 60).padStart(2, "0")}`;

  window.SpotDifference = {
    mount(container, opts = {}) {
      const onExit = typeof opts.onExit === "function" ? opts.onExit : () => {};

      let timer = null;
      let level = 1, cfg = null, round = null, seconds = 0, misses = 0, ended = true;

      const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
      const $ = (sel) => container.querySelector(sel);

      // ================= 레벨 선택 =================
      function showLevelSelect() {
        stop(); ended = true; round = null;
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
            <div class="vg-hint">제한 시간 안에 <b>단 하나</b> 다른 칸을 찾으면 클리어 · 오답은 시간 감점! 다음 레벨이 열려요</div>
          </div>`;
        container.querySelectorAll("[data-lvl]").forEach((b) =>
          b.addEventListener("click", () => startLevel(+b.dataset.lvl)));
      }

      // ================= 레벨 플레이 =================
      function startLevel(n) {
        level = n; cfg = levelConfig(n);
        round = buildRound(cfg.rows, cfg.cols);
        seconds = cfg.seconds; misses = 0; ended = false;
        render();
        stop(); timer = setInterval(tick, 1000);
      }

      function grid(side) {
        const data = side === "L" ? round.base : round.right;
        const cells = data.map((emo, i) =>
          `<div class="sd-cell" data-i="${i}" data-side="${side}">${emo}</div>`).join("");
        return `<div class="sd-grid" style="grid-template-columns:repeat(${cfg.cols},1fr)">${cells}</div>`;
      }

      function render() {
        container.innerHTML = `
          <div class="sd-wrap">
            <div class="sd-hud">
              <div class="sd-pill accent"><div class="l">남은 시간</div><div class="v" id="sd-time">${fmt(seconds)}</div></div>
              <div class="sd-pill"><div class="l">레벨</div><div class="v">${level}</div></div>
              <div class="sd-pill"><div class="l">실수</div><div class="v" id="sd-miss">${misses}</div></div>
              <div style="flex:1"></div>
              <button class="btn" id="sd-quit">레벨 선택</button>
            </div>
            <div class="sd-boards">
              <div class="sd-board"><div class="cap">원본</div>${grid("L")}</div>
              <div class="sd-board"><div class="cap">바뀐 그림</div>${grid("R")}</div>
            </div>
            <div class="sd-hint">두 그림에서 서로 <b>다른 한 칸</b>을 찾아 클릭하세요. 아무 쪽이나 눌러도 됩니다. 오답 시 ${cfg.penalty}초 감점!</div>
          </div>`;
        container.querySelectorAll(".sd-cell").forEach((el) =>
          el.addEventListener("click", () => onCell(Number(el.dataset.i))));
        $("#sd-quit").addEventListener("click", showLevelSelect);
      }

      function onCell(i) {
        if (ended || !round) return;
        if (i === round.diff) {
          container.querySelectorAll(`.sd-cell[data-i="${i}"]`).forEach((el) => el.classList.add("found"));
          levelClear();
        } else {
          misses++;
          seconds = Math.max(0, seconds - cfg.penalty); // 오답 감점
          const m = $("#sd-miss"); if (m) m.textContent = misses;
          const t = $("#sd-time"); if (t) t.textContent = fmt(seconds);
          container.querySelectorAll(`.sd-cell[data-i="${i}"]`).forEach((el) => {
            el.classList.add("miss");
            setTimeout(() => el.classList.remove("miss"), 320);
          });
          if (seconds <= 0) gameOver();
        }
      }

      function tick() {
        if (ended) return;
        seconds--;
        const t = $("#sd-time"); if (t) t.textContent = fmt(seconds);
        if (seconds <= 0) gameOver();
      }

      function levelClear() {
        ended = true; stop();
        const used = cfg.seconds - seconds;
        const wasNewUnlock = level > getCleared() && level < MAX_LEVEL;
        setCleared(Math.max(getCleared(), level));
        overlay(`
          <div class="big">🎉</div>
          <h2>레벨 ${level} 클리어!</h2>
          <p>${fmt(used)} 만에 성공 · 실수 ${misses}회</p>
          <p class="sd-sub">${level === MAX_LEVEL ? "마지막 레벨까지 정복했어요!" : wasNewUnlock ? `레벨 ${level + 1} 해금!` : "다음 레벨로 계속!"}</p>
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
        // 못 찾았을 때 정답 위치를 알려준다
        container.querySelectorAll(`.sd-cell[data-i="${round.diff}"]`).forEach((el) => el.classList.add("found"));
        overlay(`
          <div class="big">⏱️</div>
          <h2>시간 종료</h2>
          <p>레벨 ${level} · 실수 ${misses}회</p>
          <p class="sd-sub">정답은 표시된 칸이었어요.</p>
          <div class="row">
            <button class="btn primary" id="ov-retry">다시 도전</button>
            <button class="btn" id="ov-select">레벨 선택</button>
          </div>`);
        bind("#ov-retry", () => startLevel(level));
        bind("#ov-select", showLevelSelect);
      }

      function overlay(html) {
        const prev = container.querySelector(".overlay"); if (prev) prev.remove();
        const o = document.createElement("div");
        o.className = "overlay";
        o.innerHTML = `<div class="modal">${html}</div>`;
        container.appendChild(o);
      }
      function bind(sel, fn) {
        const el = $(sel);
        if (el) el.addEventListener("click", () => { const o = container.querySelector(".overlay"); if (o) o.remove(); fn(); });
      }

      showLevelSelect();
      return () => stop();
    },
  };
})();
