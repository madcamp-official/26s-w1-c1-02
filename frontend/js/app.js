/* 미니게임천국 MVP — SPA shell, views, websocket lobby chat.
   Login/profile intentionally deferred: a random guest identity is used. */
(function () {
  const app = document.getElementById("app");

  // ---- guest identity (no login yet) ----
  const GUEST_ID = "손님" + Math.floor(1000 + Math.random() * 9000);
  const AV_COLORS = ["#b07d43", "#7a9a5f", "#c67b5a", "#6a5a95", "#4a8a8a", "#a5643a"];
  const avColor = (name) => AV_COLORS[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % AV_COLORS.length];

  // ---- app state ----
  const state = { view: "lobby", online: 1, gameCleanup: null };

  // ---- solo games catalog (다른 그림 찾기 is the featured playable mode) ----
  const SOLO_GAMES = [
    { id: "spot", icon: "🔍", title: "다른 그림 찾기", badge: { c: "new", t: "NEW" },
      desc: "두 그림에서 서로 다른 부분을 제한 시간 안에 찾아보세요.", lv: 1, done: 0, total: 20, playable: true },
    { id: "word", icon: "🔤", title: "끝말잇기 연습", badge: { c: "rec", t: "초보자 추천" },
      desc: "AI와 함께 끝말잇기 연습. 난이도를 선택할 수 있어요.", lv: 7, done: 6, total: 15 },
    { id: "speed", icon: "⚡", title: "스피드 타자", badge: { c: "hi", t: "고득점 도전" },
      desc: "제한 시간 내에 얼마나 빠르게 단어를 입력할 수 있나요?", lv: 3, done: 2, total: 12 },
    { id: "quiz", icon: "🧠", title: "상식 퀴즈", badge: null,
      desc: "다양한 주제의 상식 문제로 두뇌를 깨워보세요.", lv: 5, done: 4, total: 18 },
  ];

  // ---- mock multiplayer rooms (real-time wiring comes later) ----
  const ROOMS = [
    { n: 1, name: "초보자 환영! 같이해요", host: "하늘별", mode: "다른그림찾기", cur: 3, max: 6, state: "wait", locked: false },
    { n: 2, name: "고수만 오세요 ㄴㅇㄱ", host: "퀵마스터", mode: "스피드타자", cur: 5, max: 6, state: "play", locked: false },
    { n: 3, name: "비밀방이에요", host: "??", mode: "끝말잇기", cur: 2, max: 4, state: "wait", locked: true },
    { n: 4, name: "상식 배틀 한판", host: "박학다식", mode: "상식퀴즈", cur: 1, max: 8, state: "wait", locked: false },
    { n: 5, name: "즐겜해요~~ 누구든 환영", host: "달빛토끼", mode: "다른그림찾기", cur: 4, max: 6, state: "wait", locked: false },
    { n: 6, name: "스피드 모드 도전", host: "번개", mode: "스피드타자", cur: 6, max: 6, state: "play", locked: false },
  ];

  const USERS = ["하늘별", "퀵마스터", "달빛토끼", "English99", "번개", "소나기", "그림자", "별빛달", "초록숲", "무지개"];

  // ---- lobby chat (backed by /ws when reachable) ----
  const chat = {
    messages: [{ sys: true, text: "미니게임천국 로비에 오신 것을 환영합니다 🎉" }],
    ws: null, connected: false, listeners: new Set(),
    connect() {
      if (this.ws) return;
      try {
        const proto = location.protocol === "https:" ? "wss" : "ws";
        const ws = new WebSocket(`${proto}://${location.host}/ws`);
        this.ws = ws;
        ws.onopen = () => { this.connected = true; this.emit(); };
        ws.onclose = () => { this.connected = false; this.ws = null; this.emit(); };
        ws.onerror = () => { this.connected = false; };
        ws.onmessage = (ev) => {
          let msg; try { msg = JSON.parse(ev.data); } catch { msg = { user: "?", text: String(ev.data) }; }
          if (msg && msg.user === GUEST_ID) return; // our own echo already shown
          this.push(msg);
        };
      } catch { this.connected = false; }
    },
    send(text) {
      const msg = { user: GUEST_ID, text, ts: Date.now() };
      this.push(msg);
      if (this.connected && this.ws) { try { this.ws.send(JSON.stringify(msg)); } catch {} }
    },
    push(msg) { this.messages.push(msg); if (this.messages.length > 100) this.messages.shift(); this.emit(); },
    emit() { this.listeners.forEach((fn) => fn()); },
  };
  chat.connect();

  // ---------- rendering ----------
  function h(html) { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; }

  function navHTML() {
    const tab = (id, label) => `<button class="nav-tab${state.view === id || (id === "solo" && state.view === "game:spot") ? " active" : ""}" data-nav="${id}">${label}</button>`;
    return `
      <div class="nav">
        <div class="nav-brand">
          <div class="nav-logo">미</div>
          <div class="nav-title">미니게임천국</div>
        </div>
        <div class="nav-tabs">
          ${tab("lobby", "로비")}
          ${tab("solo", "혼자하기")}
          ${tab("multi", "멀티플레이")}
        </div>
        <div class="nav-spacer"></div>
        <div class="nav-right">
          <div class="nav-online"><span class="dot-live"></span>${chat.connected ? "실시간 연결됨" : "오프라인 모드"}</div>
          <div class="nav-icon">🔔</div>
          <div class="nav-icon">⚙️</div>
          <div class="nav-guest"><div class="av">🙂</div><div class="who">${GUEST_ID}</div></div>
        </div>
      </div>`;
  }

  function sidebarChat() {
    const el = h(`
      <aside class="sidebar">
        <div class="side-head"><div class="t">💬 전체 채팅</div><div class="c">${state.online}명</div></div>
        <div class="side-scroll" id="chat-scroll"></div>
        <div class="side-input">
          <input id="chat-input" placeholder="메시지 입력..." maxlength="120" />
          <button id="chat-send">➤</button>
        </div>
      </aside>`);

    const scroll = el.querySelector("#chat-scroll");
    const input = el.querySelector("#chat-input");
    function paint() {
      scroll.innerHTML = chat.messages.map((m) =>
        m.sys
          ? `<div class="chat-line"><span class="sys">${escape(m.text)}</span></div>`
          : `<div class="chat-line"><span class="u">${escape(m.user)}</span>${escape(m.text)}</div>`
      ).join("");
      scroll.scrollTop = scroll.scrollHeight;
    }
    function submit() {
      const v = input.value.trim();
      if (!v) return;
      chat.send(v); input.value = "";
    }
    el.querySelector("#chat-send").addEventListener("click", submit);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });

    const listener = () => paint();
    chat.listeners.add(listener);
    el._cleanup = () => chat.listeners.delete(listener);
    paint();
    return el;
  }

  function sidebarUsers() {
    const rows = USERS.map((u) =>
      `<div class="user-row"><div class="av" style="background:${avColor(u)}">${u[0]}</div>${escape(u)}</div>`
    ).join("");
    return h(`
      <aside class="sidebar">
        <div class="side-head"><div class="t">👥 접속자</div><div class="c">${state.online + USERS.length}명</div></div>
        <div class="side-scroll">${rows}<div class="chat-line"><span class="sys">+ 다른 접속자들</span></div></div>
      </aside>`);
  }

  function lobbyView() {
    const content = h(`
      <div class="content">
        <div class="banner">
          <h1>미니게임천국에 오신 것을 환영합니다!</h1>
          <p>${GUEST_ID}님, 오늘도 즐거운 게임 되세요 🎮</p>
          <div class="stats">
            <div class="stat"><div class="n">0</div><div class="l">총 승리</div></div>
            <div class="stat"><div class="n">–</div><div class="l">승률</div></div>
            <div class="stat"><div class="n">1</div><div class="l">레벨</div></div>
          </div>
        </div>
        <div class="section-label">게임 모드 선택</div>
        <div class="mode-grid">
          <button class="mode-card" data-nav="solo">
            <div class="mode-ic">👤</div>
            <h3>혼자하기</h3>
            <p>AI 및 미니게임으로 혼자서 즐겨보세요. 다른 그림 찾기, 끝말잇기 등.</p>
            <div class="mode-cta">시작하기 →</div>
          </button>
          <button class="mode-card" data-nav="multi">
            <div class="mode-ic">👥</div>
            <h3>멀티플레이</h3>
            <p>다른 플레이어들과 실시간으로 대결하세요. 방을 만들거나 참가하세요.</p>
            <div class="mode-cta">입장하기 →</div>
          </button>
        </div>
      </div>`);
    return [content, sidebarChat()];
  }

  function soloView() {
    const items = SOLO_GAMES.map((g) => {
      const pct = Math.round((g.done / g.total) * 100);
      const badge = g.badge ? `<span class="badge ${g.badge.c}">${g.badge.t}</span>` : "";
      return `
        <button class="game-item" data-game="${g.id}">
          <div class="gi-top">
            <div class="gi-ic">${g.icon}</div>
            <div class="gi-body">
              <div class="gi-title-row"><span class="gi-title">${g.title}</span>${badge}</div>
              <div class="gi-desc">${g.desc}</div>
            </div>
            <div class="gi-right"><div class="gi-lv">Lv.${g.lv}</div><div class="gi-count">${g.done}/${g.total}</div></div>
          </div>
          <div class="progress"><div class="bar"><i style="width:${pct}%"></i></div><div class="lbl">진행률 ${pct}%</div></div>
        </button>`;
    }).join("");

    const content = h(`
      <div class="content">
        <div class="page-head">
          <button class="page-back" data-nav="lobby">←</button>
          <div class="page-title">혼자하기 모드</div>
          <div class="page-sub">AI 및 미니게임</div>
        </div>
        <div class="game-list">${items}</div>
      </div>`);

    content.querySelectorAll("[data-game]").forEach((el) => {
      el.addEventListener("click", () => {
        const g = SOLO_GAMES.find((x) => x.id === el.dataset.game);
        if (g && g.playable) go("game:spot");
        else toast(`"${g.title}"는 준비 중이에요.`);
      });
    });
    return [content, sidebarChat()];
  }

  function spotGameView() {
    const content = h(`
      <div class="content">
        <div class="page-head">
          <button class="page-back" data-nav="solo">←</button>
          <div class="page-title">다른 그림 찾기</div>
          <div class="page-sub">제한 시간 안에 다른 곳을 찾으세요</div>
        </div>
        <div id="game-mount"></div>
      </div>`);
    const mount = content.querySelector("#game-mount");
    state.gameCleanup = window.SpotDifference.mount(mount, { onExit: () => go("solo") });
    return [content, null];
  }

  function multiView() {
    const rows = ROOMS.map((r) => `
      <tr>
        <td>${r.n}</td>
        <td><div class="room-name">${r.locked ? "🔒 " : ""}${escape(r.name)}</div></td>
        <td class="host">☆ ${escape(r.host)}</td>
        <td>${escape(r.mode)}</td>
        <td>${r.cur}/${r.max}</td>
        <td><span class="state ${r.state === "wait" ? "wait" : "play"}">${r.state === "wait" ? "대기중" : "게임중"}</span></td>
      </tr>`).join("");

    const content = h(`
      <div class="content">
        <div class="page-head">
          <button class="page-back" data-nav="lobby">←</button>
          <div class="page-title">멀티플레이 로비</div>
          <div class="page-sub">방 ${ROOMS.length}개</div>
        </div>
        <div class="mp-toolbar">
          <div class="mp-search"><input placeholder="방 검색..." /></div>
          <button class="btn primary" id="mk-room">＋ 방 생성</button>
          <button class="btn" id="join-room">→ 방 참가</button>
        </div>
        <div class="rooms">
          <table>
            <thead><tr><th>#</th><th>방 이름</th><th>방장</th><th>모드</th><th>인원</th><th>상태</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>`);

    content.querySelector("#mk-room").addEventListener("click", () => toast("방 생성은 실시간 서버 연동 후 제공됩니다."));
    content.querySelector("#join-room").addEventListener("click", () => toast("방 참가는 실시간 서버 연동 후 제공됩니다."));
    content.querySelectorAll("tbody tr").forEach((tr) => tr.addEventListener("click", () => toast("방 입장은 실시간 서버 연동 후 제공됩니다.")));
    return [content, sidebarUsers()];
  }

  // ---------- router ----------
  let mountedSidebar = null;
  function render() {
    if (state.gameCleanup) { state.gameCleanup(); state.gameCleanup = null; }
    if (mountedSidebar && mountedSidebar._cleanup) mountedSidebar._cleanup();

    let content, sidebar;
    if (state.view === "lobby") [content, sidebar] = lobbyView();
    else if (state.view === "solo") [content, sidebar] = soloView();
    else if (state.view === "game:spot") [content, sidebar] = spotGameView();
    else if (state.view === "multi") [content, sidebar] = multiView();

    mountedSidebar = sidebar;

    const shell = h(`<div class="app-shell"></div>`);
    shell.appendChild(h(navHTML()));
    const main = h(`<div class="main"></div>`);
    main.appendChild(content);
    if (sidebar) main.appendChild(sidebar);
    shell.appendChild(main);

    app.innerHTML = "";
    app.appendChild(shell);

    shell.querySelectorAll("[data-nav]").forEach((el) =>
      el.addEventListener("click", () => go(el.dataset.nav))
    );
  }

  function go(view) { state.view = view; location.hash = view; render(); }

  // update nav "connected" label when ws state changes
  chat.listeners.add(() => {
    const label = document.querySelector(".nav-online");
    if (label) label.innerHTML = `<span class="dot-live"></span>${chat.connected ? "실시간 연결됨" : "오프라인 모드"}`;
  });

  // ---------- helpers ----------
  function escape(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
  let toastTimer;
  function toast(msg) {
    let t = document.getElementById("toast");
    if (!t) {
      t = document.createElement("div");
      t.id = "toast";
      t.style.cssText = "position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#3d2e20;color:#fff;padding:11px 18px;border-radius:10px;font-size:14px;z-index:100;box-shadow:0 8px 24px rgba(0,0,0,.2);transition:opacity .2s";
      document.body.appendChild(t);
    }
    t.textContent = msg; t.style.opacity = "1";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.style.opacity = "0"; }, 2200);
  }

  // ---------- boot ----------
  const initial = (location.hash || "").replace("#", "");
  if (["lobby", "solo", "multi", "game:spot"].includes(initial)) state.view = initial;
  render();
})();
