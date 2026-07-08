/* 다른 그림 찾기 (Spot the Difference) — 레벨제 싱글플레이.
   레벨 = 3라운드 연속. 각 라운드에서 두 그림 중 '단 하나' 다른 칸을 찾아야 하고,
   제한 시간(레벨 전체 공용, 라운드 사이에도 계속 흐름) 안에 3라운드를 모두 통과하면 클리어(→ 다음 레벨 해금).
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
  const ROUNDS = 3;                                    // 레벨당 통과해야 하는 라운드 수
  // 진행도(깬 레벨)의 단일 출처는 서버 DB(user_game_progress). 로그인 상태면 localStorage는 진행도에 관여하지 않는다.
  // 비로그인(손님)은 DB 행이 없으므로 이 브라우저에만 임시 저장한다.
  const LS_KEY = "mgh.spot.cleared";
  const isLoggedIn = () => !!localStorage.getItem("mgh.token");
  // 진행도 = 깬 레벨 수. 0이면 아직 못 깸 → 레벨 1만 열림(기본 0).
  const getGuestCleared = () => Math.min(MAX_LEVEL, Math.max(0, parseInt(localStorage.getItem(LS_KEY), 10) || 0));
  const setGuestCleared = (n) => localStorage.setItem(LS_KEY, String(Math.min(MAX_LEVEL, Math.max(0, n))));

  // 3레벨마다 격자를 한 단계 키운다(4×4→10×10). 같은 크기 구간에서는 레벨마다 제한 시간이 줄고,
  // 격자가 커질수록 기본 시간과 오답 페널티가 함께 커진다. 그래서 난이도는 레벨마다 단조 증가.
  // 시간은 '라운드 1개당' 기준으로 잡고 ROUNDS배 해서 레벨 전체 공용 예산으로 쓴다.
  // 라운드당 예산을 예전 단판 제한 시간보다 빡빡하게 잡아, 3라운드를 다 통과하려면 더 빨리 찾아야 한다.
  function levelConfig(n) {
    const band = Math.min(6, Math.floor((n - 1) / 3)); // 0..6 (격자 확대 단계)
    const size = 4 + band;                             // 4..10 (한 변 칸 수)
    const posInBand = (n - 1) % 3;                     // 같은 격자 크기 안에서의 순번(0,1,2)
    const perRound = (18 + band * 4) - posInBand * 4;  // 라운드 1개당 스캔 시간(초): 격자 클수록↑, 같은 크기면 레벨마다↓
    const seconds = perRound * ROUNDS;                 // 레벨 전체(=ROUNDS라운드) 공용 제한 시간
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
      let roundIndex = 0, transitioning = false; // roundIndex: 현재 라운드(0-based), transitioning: 라운드 전환 중 클릭 잠금
      // 화면 표시용 진행도(깬 레벨 수). 로그인 유저는 서버 DB에서 채운다. 손님은 이 브라우저 저장값으로 시작.
      let cleared = isLoggedIn() ? 0 : getGuestCleared();

      const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
      const $ = (sel) => container.querySelector(sel);

      // 로그인 유저의 클리어 레벨을 서버에 반영(로컬→서버). 실패해도 로컬 진행은 그대로 유지.
      function reportLevelClear(n) {
        const token = localStorage.getItem("mgh.token");
        if (!token) return;
        fetch("/api/games/spot/level-clear", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ level: n }),
        }).catch(() => {});
      }

      // 로그인 유저의 진행도는 서버 DB가 유일한 출처. 표시값(cleared)을 서버 값으로 그대로 덮어쓴다
      // (로컬 캐시가 더 높아도 서버 값으로 맞춘다 — 다른 기기/브라우저 간 일관성 보장).
      async function syncFromServer() {
        const token = localStorage.getItem("mgh.token");
        if (!token) return;
        try {
          const r = await fetch("/api/games/spot/progress", { headers: { Authorization: `Bearer ${token}` } });
          if (!r.ok) return;
          const data = await r.json();
          // 종목별 싱글 레벨 진행도는 서버가 내려주는 soloLevel(= meta[spot].level = 깬 레벨 수).
          const soloLevel = data.soloLevel ?? data.meta?.spot?.level;
          if (typeof soloLevel === "number") {
            cleared = Math.min(MAX_LEVEL, Math.max(0, soloLevel));
            if (ended) showLevelSelect(); // 레벨 선택 화면이면 갱신, 플레이 중이면 다음 방문 때 반영
          }
        } catch (e) { /* 네트워크 오류 시 기존 표시값 유지 */ }
      }

      // ================= 레벨 선택 =================
      function showLevelSelect() {
        stop(); ended = true; round = null;
        // 표시는 현재 진행도 상태(cleared)만 사용. 로컬 값을 서버로 밀어올리지 않는다.
        let cells = "";
        for (let n = 1; n <= MAX_LEVEL; n++) {
          const st = n <= cleared ? "cleared" : n === cleared + 1 ? "current" : "locked";
          cells += `<button class="vg-lvl ${st}" ${st === "locked" ? "disabled" : ""} data-lvl="${n}">${st === "locked" ? "🔒" : n}</button>`;
        }
        container.innerHTML = `
          <div class="vg-levels">
            <div class="vg-levels-head">레벨 선택 <span class="vg-levels-sub">깬 레벨 ${cleared} / ${MAX_LEVEL}</span></div>
            <div class="vg-level-grid">${cells}</div>
            <div class="vg-hint">제한 시간 안에 <b>${ROUNDS}라운드</b>를 모두 통과하면 클리어 · 오답은 시간 감점! 다음 레벨이 열려요</div>
          </div>`;
        container.querySelectorAll("[data-lvl]").forEach((b) =>
          b.addEventListener("click", () => startLevel(+b.dataset.lvl)));
      }

      // ================= 레벨 플레이 =================
      function startLevel(n) {
        level = n; cfg = levelConfig(n);
        roundIndex = 0; transitioning = false;
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
              <div class="sd-pill"><div class="l">라운드</div><div class="v">${roundIndex + 1} / ${ROUNDS}</div></div>
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
        if (ended || transitioning || !round) return;
        if (i === round.diff) {
          container.querySelectorAll(`.sd-cell[data-i="${i}"]`).forEach((el) => el.classList.add("found"));
          if (roundIndex < ROUNDS - 1) {
            // 아직 남은 라운드가 있으면: 정답을 잠깐 보여준 뒤 다음 라운드로(타이머는 계속 흐름)
            transitioning = true;
            setTimeout(() => {
              if (ended) return;               // 전환 대기 중 시간 종료된 경우 무시
              roundIndex++;
              round = buildRound(cfg.rows, cfg.cols);
              transitioning = false;
              render();
            }, 550);
          } else {
            levelClear();                       // 마지막 라운드까지 통과 → 레벨 클리어
          }
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
        const wasNewUnlock = level > cleared && level < MAX_LEVEL;
        cleared = Math.max(cleared, level);
        if (isLoggedIn()) reportLevelClear(level);  // 로그인: 서버 DB에 기록(깬 레벨 수 저장)
        else setGuestCleared(cleared);              // 손님: 이 브라우저에만 임시 저장
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
      syncFromServer();
      return () => stop();
    },
  };
})();
