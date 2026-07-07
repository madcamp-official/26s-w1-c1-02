/* 멀티플레이 숫자야구 — 1대1 턴제 추리 대결 화면.
   서버(realtime/games/baseball.js)가 설정/턴/판정을 주도. 이 모듈은 표시 + 제출만 담당.
   흐름: setup(내 비밀 숫자 정하기) → play(번갈아 상대 숫자 추측, S/B/Out 확인) → gameover.
   window.BaseballMulti.mount(container, { socket, onExit, onFinish }) => cleanup */
(function () {
  const escape = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = (s) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.max(0, s) % 60).padStart(2, "0")}`;

  // 한 번의 추측을 S/B/Out 뱃지로. 홈런·시간초과는 특수 표시.
  function verdict(g) {
    if (g.timeout) return `<span class="bb-v out">시간초과</span>`;
    if (g.homerun) return `<span class="bb-v hr">홈런! 🎉</span>`;
    const parts = [];
    if (g.strike) parts.push(`<span class="bb-v s">${g.strike}S</span>`);
    if (g.ball) parts.push(`<span class="bb-v b">${g.ball}B</span>`);
    if (!g.strike && !g.ball) parts.push(`<span class="bb-v out">아웃</span>`);
    return parts.join("");
  }

  window.BaseballMulti = {
    mount(container, opts = {}) {
      const socket = opts.socket;
      const onExit = typeof opts.onExit === "function" ? opts.onExit : () => {};
      const onFinish = typeof opts.onFinish === "function" ? opts.onFinish : () => {};
      const myId = socket.id;

      let cfg = { digits: 3, players: [] };
      let phase = "setup";
      let st = null;                 // 최신 baseball:state
      let boards = {};               // id -> [guess]
      let mySecret = null;
      let readyIds = [];
      let remain = 0, ticker = null;

      const $ = (sel) => container.querySelector(sel);
      const stopTicker = () => { if (ticker) { clearInterval(ticker); ticker = null; } };
      const oppId = () => (cfg.players.find((p) => p.id !== myId) || {}).id;
      const nameOf = (id) => { const p = cfg.players.find((x) => x.id === id); return p ? p.name : "?"; };

      // ---------- 설정 화면 ----------
      function renderSetup() {
        const submitted = mySecret != null;
        const oppReady = readyIds.includes(oppId());
        container.innerHTML = `
          <div class="vm-wrap bb-wrap">
            <div class="bb-setup">
              <div class="bb-setup-card">
                <div class="bb-title">⚾ 숫자야구</div>
                <div class="bb-sub">0~9 중 <b>중복 없는 ${cfg.digits}자리</b> 비밀 숫자를 정하세요.</div>
                ${submitted ? `
                  <div class="bb-mynum">내 비밀 숫자 <b>${escape(mySecret)}</b></div>
                  <div class="bb-waiting">${oppReady ? "곧 시작합니다…" : `${escape(nameOf(oppId()) || "상대")}님이 숫자를 정하는 중…`}</div>
                ` : `
                  <input class="bb-input" id="bb-secret" inputmode="numeric" autocomplete="off"
                         maxlength="${cfg.digits}" placeholder="${"?".repeat(cfg.digits)}" />
                  <div class="bb-result" id="bb-setup-msg"></div>
                  <button class="btn primary bb-submit" id="bb-secret-btn">이 숫자로 결정</button>
                `}
                <div class="bb-hint">힌트가 되는 예: ${cfg.digits === 3 ? "0S 0B = 아웃, 1S 1B = 한 자리 위치·한 자리 값만 맞음" : "자리와 값이 모두 맞으면 스트라이크(S)"}</div>
              </div>
            </div>
          </div>`;
        const inp = $("#bb-secret");
        if (inp) {
          inp.addEventListener("input", () => { inp.value = inp.value.replace(/\D/g, "").slice(0, cfg.digits); });
          inp.addEventListener("keydown", (e) => { if (e.key === "Enter") submitSecret(); });
          $("#bb-secret-btn").addEventListener("click", submitSecret);
          inp.focus();
        }
      }

      function localValid(num) {
        if (num.length !== cfg.digits) return `${cfg.digits}자리를 입력하세요.`;
        if (new Set(num).size !== num.length) return "중복되지 않는 숫자여야 합니다.";
        return null;
      }

      function submitSecret() {
        const inp = $("#bb-secret");
        if (!inp) return;
        const num = inp.value.replace(/\D/g, "");
        const err = localValid(num);
        const msg = $("#bb-setup-msg");
        if (err) { if (msg) msg.innerHTML = `<span class="bad-msg">${escape(err)}</span>`; return; }
        socket.emit("baseball:secret", { number: num });
      }

      // ---------- 대결 화면 ----------
      function boardColumn(id, mine) {
        const list = (boards[id] || []).map((g, i) => `
          <div class="bb-row${g.homerun ? " hr" : ""}">
            <span class="bb-no">${i + 1}</span>
            <span class="bb-num">${escape(g.number)}</span>
            <span class="bb-verdict">${verdict(g)}</span>
          </div>`).join("") || `<div class="bb-empty">아직 추측이 없습니다</div>`;
        const cap = mine ? `내 추측 · 상대 숫자 맞히기` : `${escape(nameOf(id) || "상대")}의 추측`;
        return `
          <div class="bb-col${mine ? " mine" : ""}">
            <div class="bb-col-cap">${cap}</div>
            <div class="bb-rows">${list}</div>
          </div>`;
      }

      function renderPlay() {
        const myTurn = st && st.turnId === myId;
        const turnText = myTurn
          ? `🟢 내 차례 — 상대 숫자를 추측하세요`
          : `⏳ ${escape(st ? st.turnName : "상대")}님의 차례`;
        container.innerHTML = `
          <div class="vm-wrap bb-wrap">
            <div class="vm-top bb-top">
              <div class="sd-pill accent"><div class="l">남은 시간</div><div class="v" id="bb-time">${fmt(remain)}</div></div>
              <div class="sd-pill"><div class="l">라운드</div><div class="v"><span id="bb-round">${st ? st.round : 1}</span></div></div>
              <div class="sd-pill"><div class="l">자릿수</div><div class="v">${cfg.digits}자리</div></div>
              <div style="flex:1"></div>
              <div class="bb-turn ${myTurn ? "mine" : ""}" id="bb-turn">${turnText}</div>
            </div>
            <div class="bb-boards">
              ${boardColumn(myId, true)}
              ${boardColumn(oppId(), false)}
            </div>
            <div class="bb-inputbar" id="bb-inputbar">
              <input class="bb-input" id="bb-guess" inputmode="numeric" autocomplete="off"
                     maxlength="${cfg.digits}" placeholder="${"?".repeat(cfg.digits)}"${myTurn ? "" : " disabled"} />
              <button class="btn primary" id="bb-guess-btn"${myTurn ? "" : " disabled"}>추측!</button>
              <div class="bb-result" id="bb-guess-msg"></div>
            </div>
          </div>`;
        const inp = $("#bb-guess");
        if (inp) {
          inp.addEventListener("input", () => { inp.value = inp.value.replace(/\D/g, "").slice(0, cfg.digits); });
          inp.addEventListener("keydown", (e) => { if (e.key === "Enter") submitGuess(); });
          const btn = $("#bb-guess-btn");
          if (btn) btn.addEventListener("click", submitGuess);
          if (myTurn) inp.focus();
        }
      }

      function submitGuess() {
        if (!st || st.turnId !== myId) return;
        const inp = $("#bb-guess");
        if (!inp) return;
        const num = inp.value.replace(/\D/g, "");
        const err = localValid(num);
        const msg = $("#bb-guess-msg");
        if (err) { if (msg) msg.innerHTML = `<span class="bad-msg">${escape(err)}</span>`; return; }
        socket.emit("baseball:guess", { number: num });
        inp.value = "";
      }

      function startTicker() {
        stopTicker();
        ticker = setInterval(() => {
          remain--;
          const t = $("#bb-time"); if (t) t.textContent = fmt(remain);
          if (remain <= 0) stopTicker();
        }, 1000);
      }

      function overlay(html) {
        const prev = container.querySelector(".overlay"); if (prev) prev.remove();
        const o = document.createElement("div");
        o.className = "overlay";
        o.innerHTML = `<div class="modal vm-modal bb-over">${html}</div>`;
        container.appendChild(o);
        return o;
      }

      // ---------- 소켓 이벤트 ----------
      const onSetup = (data) => {
        cfg = { digits: data.digits, players: data.players || [] };
        phase = "setup"; mySecret = null; readyIds = []; boards = {};
        renderSetup();
      };
      const onSecretAck = (data) => { mySecret = data.number; renderSetup(); };
      const onSetupProgress = (data) => { readyIds = data.readyIds || []; if (phase === "setup") renderSetup(); };
      const onState = (data) => {
        phase = data.phase; st = data; boards = data.boards || boards;
        if (data.players && data.players.length) cfg.players = data.players;
        remain = Math.ceil((data.remainMs || 0) / 1000);
        renderPlay();
        startTicker();
      };
      const onGuessResult = (data) => {
        // 상대/내 최신 추측을 즉시 반영(마지막 라운드처럼 state가 뒤따르지 않는 경우 대비)
        const arr = boards[data.by] || (boards[data.by] = []);
        const g = { number: data.number, strike: data.strike, ball: data.ball, out: data.out, homerun: data.homerun, timeout: data.timeout };
        const last = arr[arr.length - 1];
        if (!last || last.number !== g.number || last.strike !== g.strike || last.ball !== g.ball) arr.push(g);
        if (phase === "play") renderPlay();
        const msg = data.by === myId ? $("#bb-guess-msg") : null;
        if (msg) {
          msg.innerHTML = data.homerun
            ? `<span class="ok-msg">🎉 홈런! 정답입니다</span>`
            : `<span class="bb-inline">${data.strike}S ${data.ball}B${(!data.strike && !data.ball) ? " · 아웃" : ""}</span>`;
        }
      };
      const onInvalid = (data) => {
        const msg = (phase === "setup" ? $("#bb-setup-msg") : $("#bb-guess-msg"));
        if (msg) msg.innerHTML = `<span class="bad-msg">${escape(data && data.message ? data.message : "잘못된 입력입니다.")}</span>`;
      };
      const onGameover = (data) => {
        stopTicker();
        phase = "over";
        onFinish();
        boards = data.boards || boards;
        const secrets = data.secrets || {};
        let head, cls;
        if (data.result === "draw") { head = "🤝 무승부!"; cls = "draw"; }
        else if (data.result === "forfeit") { head = data.winnerId === myId ? "🏆 부전승!" : "상대가 나갔습니다"; cls = data.winnerId === myId ? "win" : "lose"; }
        else if (data.winnerId === myId) { head = "🏆 승리!"; cls = "win"; }
        else { head = "😢 패배"; cls = "lose"; }
        const rows = cfg.players.map((p) => `
          <div class="bb-final-row ${data.winnerId === p.id ? "win" : ""}">
            <span class="bb-final-name">${escape(p.name)}${p.id === myId ? " (나)" : ""}</span>
            <span class="bb-final-secret">비밀 숫자 <b>${escape(secrets[p.id] || "-")}</b></span>
            <span class="bb-final-tries">${(boards[p.id] || []).length}회 추측</span>
          </div>`).join("");
        const o = overlay(`
          <div class="big ${cls}">${head}</div>
          <div class="bb-final">${rows}</div>
          <div class="row"><button class="btn primary" id="bb-exit">대기실로</button></div>`);
        o.querySelector("#bb-exit").addEventListener("click", onExit);
      };

      socket.on("baseball:setup", onSetup);
      socket.on("baseball:secretAck", onSecretAck);
      socket.on("baseball:setupProgress", onSetupProgress);
      socket.on("baseball:state", onState);
      socket.on("baseball:guessResult", onGuessResult);
      socket.on("baseball:invalid", onInvalid);
      socket.on("baseball:gameover", onGameover);

      container.innerHTML = `<div class="vm-wrap"><div class="vm-waiting">게임을 준비 중입니다…</div></div>`;

      return () => {
        stopTicker();
        socket.off("baseball:setup", onSetup);
        socket.off("baseball:secretAck", onSecretAck);
        socket.off("baseball:setupProgress", onSetupProgress);
        socket.off("baseball:state", onState);
        socket.off("baseball:guessResult", onGuessResult);
        socket.off("baseball:invalid", onInvalid);
        socket.off("baseball:gameover", onGameover);
      };
    },
  };
})();
