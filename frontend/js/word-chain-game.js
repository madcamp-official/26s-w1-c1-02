/* 끝말잇기 (word-chain-game) — 레벨제(vowel-game.js와 동일 20레벨 패턴) + 혼자 타임어택.
   레벨 클리어 = 전체 게임시간 안에 목표 체인 개수 도달. 시간/목표 개수는 레벨마다
   매끄럽게(레벨1=90초·8개 → 레벨20=52초·14개) 빡빡해짐. 보스 글자 수(4→5)만 레벨16에서
   한 번 크게 올라감. 시계는 전체 시간 하나뿐 — "턴"은 시간이 아니라 개수(성공한 단어 수)로만 센다.
   오답/중복/보스조건 미달이면 목숨 1개 차감(같은 턴 재도전), 목숨이 다 떨어지면 종료.
   5번째 턴마다 보스 턴. 단, 그 턴의 시작 글자로 만들 수 있는 조건 충족(글자 수) 단어가 하나도
   없으면 보스를 다음 턴으로 미루고 이번 턴은 일반 턴으로 진행한다(막다른 보스로 인한 강제 종료 방지).
   미뤄둔 보스가 남은 채 목표 개수를 채우면 클리어 대신 한 라운드 더 진행해 그 보스를 치른다.
   검증/두음법칙/사전 조회는 백엔드 /api/games/wordchain.
   window.WordChainGame.mount(container,{onExit})=>cleanup */
(function () {
  const MAX_LEVEL = 20;
  const LIVES_START = 3;       // 목숨 — 레벨 무관 고정
  const BOSS_EVERY = 5;        // 보스 턴 주기(턴 카운트 5의 배수) — 레벨 무관 고정
  const BOSS_MIN_LEN = 4;      // 보스 턴 최소 글자 수 (기본값, 고레벨은 levelConfig에서 +1)
  const RISK_THRESHOLD = 5;    // 게이지가 이 이하일 때 성공하면 위험 보너스(게이지 경고 기준과 동일)
  const RISK_BONUS = 50;       // 위험 보너스 점수
  const LS_KEY = "mgh.wordchain.cleared";
  const isLoggedIn = () => !!localStorage.getItem("mgh.token");
  const getGuestCleared = () => Math.min(MAX_LEVEL, Math.max(0, parseInt(localStorage.getItem(LS_KEY), 10) || 0));
  const setGuestCleared = (n) => localStorage.setItem(LS_KEY, String(Math.min(MAX_LEVEL, n)));

  // 전체 게임 시간(초)·목표 체인 개수: 레벨마다 매끄럽게 스케일링 (1=90초/8개 → 20=52초/14개).
  // 보스 턴 글자 수만 레벨16에서 한 번 크게 점프(4→5)하는 랜드마크로 남김.
  function levelConfig(n) {
    const totalTime = Math.round(90 - (n - 1) * (90 - 52) / (MAX_LEVEL - 1));
    const goal = Math.round(8 + (n - 1) * (14 - 8) / (MAX_LEVEL - 1));
    const bossMinLength = n > 15 ? BOSS_MIN_LEN + 1 : BOSS_MIN_LEN;
    return { totalTime, goal, bossEvery: BOSS_EVERY, bossMinLength };
  }
  const fmt = (s) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.max(0, s) % 60).padStart(2, "0")}`;

  const REASON_MSG = {
    EMPTY: "단어를 입력해 주세요.",
    NOT_IN_DICTIONARY: "사전에 없는 단어예요.",
    CHAIN_MISMATCH: "끝말잇기 규칙에 안 맞아요.",
    ALREADY_USED: "이미 사용한 단어예요.",
    BOSS_TOO_SHORT: "보스 턴! 글자 수가 부족해요.",
  };

  window.WordChainGame = {
    mount(container, opts = {}) {
      let timer = null;
      let level = 1, cfg = null, remain = 0, ended = true, lives = LIVES_START;
      let chain = [], requiredChar = null, turnTimes = [], turnStartedAt = 0;
      let pendingRemaining = Infinity; // 지금 턴 시작 시점의 게이지 값(위험 보너스 판정용)
      let riskBonus = 0;
      let bossPending = false;   // 보스가 예정됐지만 조건 충족 단어가 없어 다음 턴으로 미뤄진 상태
      let bossThisTurn = false;  // 이번 턴이 실제 보스 턴으로 확정됐는지(미루기/강등 반영한 최종값)
      let cleared = isLoggedIn() ? 0 : getGuestCleared();

      const stop = () => { clearInterval(timer); timer = null; };
      const scheduledBossTurn = () => (chain.length + 1) % cfg.bossEvery === 0; // 개수 기준 예정 보스 턴

      async function syncFromServer() {
        const token = localStorage.getItem("mgh.token");
        if (!token) return;
        try {
          const r = await fetch("/api/games/wordchain/progress", { headers: { Authorization: `Bearer ${token}` } });
          if (!r.ok) return;
          const data = await r.json();
          // 종목별 싱글 레벨 진행도는 서버가 내려주는 soloLevel(= meta.wordchain.level = 깬 레벨 수).
          const soloLevel = data.soloLevel ?? data.meta?.wordchain?.level;
          if (typeof soloLevel === "number") {
            cleared = Math.min(MAX_LEVEL, Math.max(0, soloLevel));
            if (ended) showLevelSelect();
          }
        } catch (e) { /* 네트워크 오류 시 기존 표시값 유지 */ }
      }

      // ================= 레벨 선택 =================
      function showLevelSelect() {
        stop(); ended = true;
        let cells = "";
        for (let n = 1; n <= MAX_LEVEL; n++) {
          const st = n <= cleared ? "cleared" : n === cleared + 1 ? "current" : "locked";
          cells += `<button class="vg-lvl ${st}" ${st === "locked" ? "disabled" : ""} data-lvl="${n}">${st === "locked" ? "🔒" : n}</button>`;
        }
        container.innerHTML = `
          <div class="vg-levels">
            <div class="vg-levels-head">레벨 선택 <span class="vg-levels-sub">깬 레벨 ${cleared} / ${MAX_LEVEL}</span></div>
            <div class="vg-level-grid">${cells}</div>
            <div class="vg-hint">전체 시간 안에 목표 체인 개수를 채우면 클리어 · 목숨 ${LIVES_START}개, 오답이어도 같은 턴 다시 도전 가능</div>
          </div>`;
        container.querySelectorAll("[data-lvl]").forEach((b) =>
          b.addEventListener("click", () => startLevel(+b.dataset.lvl)));
      }

      // ================= 레벨 플레이 =================
      async function startLevel(n) {
        level = n; cfg = levelConfig(n);
        ended = false; lives = LIVES_START;
        chain = []; requiredChar = null; turnTimes = []; pendingRemaining = Infinity; riskBonus = 0;
        bossPending = false; bossThisTurn = false;
        stop();
        container.innerHTML = `<div class="vg-error">문제 준비 중…</div>`;
        await seedStartWord(); // 서버가 시작 단어를 내려줌(항상 같은 쉬운 단어로 시작하는 것 방지)
        if (ended) return; // 로딩 중 레벨 선택으로 나갔으면 중단
        remain = cfg.totalTime; turnStartedAt = Date.now();
        timer = setInterval(tick, 1000);
        await beginTurn();
      }

      // 이번 턴이 보스 턴인지 확정한 뒤 화면을 그린다. 예정 보스이거나 이전에 미뤄둔 보스면
      // 후보지만, 조건(글자 수)을 만족하며 이어질 수 있는 단어가 실제로 없으면 보스를 다음 턴으로
      // 미루고(bossPending) 이번 턴은 일반 턴으로 진행한다.
      async function beginTurn() {
        const candidate = bossPending || scheduledBossTurn();
        if (candidate && requiredChar) {
          if (await bossWordExists(requiredChar)) { bossThisTurn = true; bossPending = false; }
          else { bossThisTurn = false; bossPending = true; } // 낼 수 있는 보스 단어가 없음 → 다음 턴으로 미룸
        } else {
          bossThisTurn = false; // 자유 시작 턴 등에선 보스 강제하지 않음
        }
        if (ended) return; // 확인하는 동안 레벨 선택으로 나갔으면 렌더 생략
        renderPlay();
      }

      // 보스 조건(글자 수)을 만족하면서 requiredChar로 이어질 수 있는 단어가 실제로 존재하는지 확인.
      async function bossWordExists(reqChar) {
        try {
          const r = await fetch("/api/games/wordchain/answers", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ requiredChar: reqChar, usedWords: chain, minLength: cfg.bossMinLength }),
          });
          if (!r.ok) return true; // 확인 실패 시 보스 유지(기존 동작) — 실수로 건너뛰지 않도록
          const data = await r.json();
          return !!(data.answers && data.answers.length);
        } catch (e) { return true; }
      }

      async function seedStartWord() {
        try {
          const r = await fetch("/api/games/wordchain/start");
          if (!r.ok) return; // 실패하면 자유 시작(requiredChar=null)으로 폴백
          const { word } = await r.json();
          if (!word) return;
          const cr = await fetch("/api/games/wordchain/check", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ word, usedWords: [], requiredChar: null }),
          });
          const data = await cr.json();
          if (data.valid) { chain = [word]; requiredChar = data.nextChar; pendingRemaining = data.remaining; }
        } catch (e) { /* 네트워크 오류 시 자유 시작으로 폴백 */ }
      }

      function tick() {
        if (ended) return;
        remain--;
        const t = container.querySelector("#wc-time"); if (t) t.textContent = fmt(remain);
        if (remain <= 0) gameOver(`시간 종료! (${chain.length}/${cfg.goal})`);
      }

      function renderPlay() {
        const bossNow = bossThisTurn;
        container.innerHTML = `
          <div class="vg-wrap">
            <div class="vg-hud">
              <div class="sd-pill accent"><div class="l">남은 시간</div><div class="v" id="wc-time">${fmt(remain)}</div></div>
              <div class="sd-pill"><div class="l">목숨</div><div class="v" id="wc-lives">${"❤️".repeat(lives)}${"🖤".repeat(LIVES_START - lives)}</div></div>
              <div class="sd-pill"><div class="l">레벨</div><div class="v">${level}</div></div>
              <div class="sd-pill"><div class="l">체인</div><div class="v" id="wc-chainlen">${chain.length} / ${cfg.goal}</div></div>
              <div style="flex:1"></div>
              <button class="btn" id="wc-quit">레벨 선택</button>
            </div>
            <div class="vg-board">
              ${bossNow ? `<div class="wc-boss">⚔️ 보스 턴! <b>${cfg.bossMinLength}글자 이상</b>인 단어를 내세요</div>` : ""}
              <div class="wc-caption-row">
                <div class="vg-caption">${requiredChar ? `<b>"${requiredChar}"</b>로 시작하는 단어를 입력하세요` : "아무 단어로나 시작하세요"}</div>
                ${requiredChar ? `<button class="btn wc-hint-corner" id="wc-hint" title="목숨 1개 소모">💡 힌트</button>` : ""}
              </div>
              <div class="wc-chain" id="wc-chain">${chain.map((w) => `<span class="wc-chip">${w}</span>`).join("")}</div>
              <div class="vg-inputrow">
                <input class="vg-input" id="wc-input" placeholder="단어 입력 (한글)" autocomplete="off" autocapitalize="off" />
                <button class="btn primary" id="wc-submit">제출</button>
              </div>
              <div class="vg-result" id="wc-result"></div>
              <div class="wc-gauge" id="wc-gauge"></div>
            </div>
          </div>`;
        const input = container.querySelector("#wc-input");
        input.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
        container.querySelector("#wc-submit").addEventListener("click", submit);
        container.querySelector("#wc-quit").addEventListener("click", showLevelSelect);
        container.querySelector("#wc-hint")?.addEventListener("click", useHint);
        input.focus();
      }

      async function submit() {
        if (ended) return;
        const input = container.querySelector("#wc-input");
        const word = input.value.trim(); if (!word) return;
        const bossNow = bossThisTurn;
        try {
          const r = await fetch("/api/games/wordchain/check", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              word, usedWords: chain, requiredChar,
              minLength: bossNow ? cfg.bossMinLength : undefined,
            }),
          });
          const data = await r.json();
          if (data.valid) onValid(word, data);
          else onWrong(data.reason, input);
        } catch (e) {
          showResult(`<span class="bad-msg">네트워크 오류, 다시 시도해 주세요.</span>`);
        }
      }

      async function onValid(word, data) {
        if (ended) return;
        const wasRisky = pendingRemaining <= RISK_THRESHOLD;
        if (wasRisky) riskBonus += RISK_BONUS;
        turnTimes.push(Date.now() - turnStartedAt);
        chain.push(word);
        requiredChar = data.nextChar;
        pendingRemaining = data.remaining;
        turnStartedAt = Date.now();
        // 목표 개수를 채웠어도 미뤄둔 보스가 남아있으면 클리어하지 않고 한 라운드 더 진행해
        // 그 라운드에서 보스를 치른다. 미룬 보스가 없을 때만 클리어.
        if (chain.length >= cfg.goal && !bossPending) { levelClear(); return; }
        await beginTurn(); // 다음 턴(보스 여부·미루기 반영)을 확정하고 새로 그림
        if (ended) return;
        showResult(`<span class="ok-msg">✓ ${word}${wasRisky ? ` <b>+${RISK_BONUS} 위험 보너스!</b>` : ""}</span>`);
        showGauge(data.acceptableNext, data.remaining);
      }

      async function useHint() {
        if (ended || !requiredChar) return;
        if (lives <= 1) { showResult(`<span class="bad-msg">목숨이 부족해서 힌트를 쓸 수 없어요.</span>`); return; }
        const bossNow = bossThisTurn;
        try {
          const r = await fetch("/api/games/wordchain/hint", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ requiredChar, usedWords: chain, minLength: bossNow ? cfg.bossMinLength : undefined }),
          });
          const data = await r.json();
          if (!data.hint) { showResult(`<span class="bad-msg">힌트로 줄 단어가 없어요.</span>`); return; }
          lives--;
          renderHearts();
          container.querySelector("#wc-input")?.focus();
          showResult(`<span class="ok-msg">💡 힌트: ${data.hint} (목숨 1개 사용)</span>`);
        } catch (e) {
          showResult(`<span class="bad-msg">네트워크 오류, 다시 시도해 주세요.</span>`);
        }
      }

      function onWrong(reason, input) {
        if (ended) return;
        lives--;
        input.value = "";
        input.focus();
        renderHearts();
        if (lives <= 0) { gameOver(`목숨을 다 잃었어요 · ${REASON_MSG[reason] || "오답!"}`); return; }
        showResult(`<span class="bad-msg">✕ ${REASON_MSG[reason] || "다시 시도해 주세요."} (남은 목숨 ${lives})</span>`);
      }

      function renderHearts() {
        const el = container.querySelector("#wc-lives");
        if (el) el.textContent = "❤️".repeat(lives) + "🖤".repeat(LIVES_START - lives);
      }

      function showGauge(acceptableNext, remaining) {
        const box = container.querySelector("#wc-gauge");
        if (!box) return;
        const charsStr = acceptableNext.join("/");
        const warn = remaining <= 5;
        box.innerHTML = `<span class="${warn ? "wc-gauge-warn" : ""}">"${charsStr}"로 시작하는 단어: ${remaining}개 남음${warn ? " ⚠️" : ""}</span>`;
      }

      function reportLevelClear(n) {
        const token = localStorage.getItem("mgh.token");
        if (!token) return;
        fetch("/api/games/wordchain/level-clear", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ level: n }),
        }).catch(() => {});
      }

      // 체인 길이 / 소요 시간 / 평균 속도 / 위험 보너스 / 최종 점수
      function computeStats() {
        const chainLen = chain.length;
        const elapsedS = cfg.totalTime - Math.max(0, remain);
        const totalMs = turnTimes.reduce((s, ms) => s + ms, 0);
        const avgS = chainLen ? totalMs / chainLen / 1000 : 0;
        const score = chainLen * 100 + lives * 100 + riskBonus;
        return { chainLen, elapsedS, avgS, riskBonus, score };
      }
      function statsHtml(stats) {
        return `<div class="wc-stats">
          <div><span class="l">체인 길이</span><span class="v">${stats.chainLen}개</span></div>
          <div><span class="l">소요 시간</span><span class="v">${fmt(stats.elapsedS)}</span></div>
          <div><span class="l">평균 속도</span><span class="v">${stats.avgS.toFixed(1)}초/턴</span></div>
          <div><span class="l">위험 보너스</span><span class="v">+${stats.riskBonus}</span></div>
          <div><span class="l">최종 점수</span><span class="v">${stats.score}</span></div>
        </div>`;
      }

      function levelClear() {
        ended = true; stop();
        const wasNewUnlock = level > cleared && level < MAX_LEVEL;
        cleared = Math.max(cleared, level);
        if (isLoggedIn()) reportLevelClear(level);
        else setGuestCleared(cleared);
        const stats = computeStats();
        overlay(`
          <div class="big">🏆</div>
          <h2>레벨 ${level} 클리어!</h2>
          ${statsHtml(stats)}
          <p>${level === MAX_LEVEL ? "마지막 레벨까지 정복했어요!" : wasNewUnlock ? `레벨 ${level + 1} 해금!` : "다음 레벨로 계속!"}</p>
          <div class="row">
            ${level < MAX_LEVEL ? `<button class="btn primary" id="ov-next">레벨 ${level + 1} →</button>` : ""}
            <button class="btn" id="ov-select">레벨 선택</button>
          </div>`);
        bind("#ov-next", () => startLevel(level + 1));
        bind("#ov-select", showLevelSelect);
      }

      // 게임오버 시(시간 종료·목숨 소진 모두) 이번 턴에 이어질 수 있었던 실제 정답 단어들을 공개.
      // /hint는 초성 마스킹(사ㅅㅂㄹ)을 주므로 게임오버 정답 공개에는 부적합 — 완전한 단어를 주는
      // /answers를 사용한다.
      async function fetchAnswerLine() {
        if (!requiredChar) return ""; // 자유 시작 턴이면 특정 정답이 없음
        try {
          const bossNow = bossThisTurn;
          const r = await fetch("/api/games/wordchain/answers", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ requiredChar, usedWords: chain, minLength: bossNow ? cfg.bossMinLength : undefined }),
          });
          if (!r.ok) return "";
          const data = await r.json();
          if (!data.answers || !data.answers.length) return "";
          return `<p>정답 예시: <b>${data.answers.slice(0, 5).join(", ")}</b></p>`;
        } catch (e) { return ""; }
      }

      async function gameOver(reasonText) {
        if (ended) return;
        ended = true; stop();
        const answerLine = await fetchAnswerLine();
        const stats = computeStats();
        overlay(`
          <div class="big">💥</div>
          <h2>게임 종료</h2>
          <p class="bad-msg">${reasonText}</p>
          ${answerLine}
          ${statsHtml(stats)}
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
      function showResult(html) { const b = container.querySelector("#wc-result"); if (b) b.innerHTML = html; }

      showLevelSelect();
      syncFromServer();
      return () => stop();
    },
  };
})();
