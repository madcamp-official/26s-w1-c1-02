/* 미니게임천국 MVP — SPA shell, views, websocket lobby chat.
   Login/profile intentionally deferred: a random guest identity is used. */
(function () {
  const app = document.getElementById("app");

  // ---- 프로필 정체성: 로그인 시 계정 아이디(username)로 교체, 로그인 전엔 손님 ----
  let GUEST_ID = localStorage.getItem("mgh.username") || ("손님" + Math.floor(1000 + Math.random() * 9000));
  // ---- 화면에 표시할 이름: 로그인 시 닉네임, 로그인 전엔 손님 아이디 ----
  let DISPLAY_NAME = localStorage.getItem("mgh.nickname") || GUEST_ID;
  const AV_COLORS = ["#b07d43", "#7a9a5f", "#c67b5a", "#6a5a95", "#4a8a8a", "#a5643a"];
  const avColor = (name) => AV_COLORS[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % AV_COLORS.length];

  // ---- app state ----
  const state = { view: "login", online: 1, gameCleanup: null };

  // ---- solo games catalog (다른 그림 찾기 is the featured playable mode) ----
  const SOLO_GAMES = [
    { id: "vowel", icon: "🔡", title: "자음 모음 조합", badge: { c: "new", t: "NEW" },
      desc: "흩어진 자음·모음을 모두 조합해 실제 단어를 만드세요.", lv: 1, done: 0, total: 20, playable: true },
    { id: "spot", icon: "🔍", title: "다른 그림 찾기", badge: { c: "hot", t: "인기" },
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
          if (msg && msg.user === DISPLAY_NAME) return; // our own echo already shown
          this.push(msg);
        };
      } catch { this.connected = false; }
    },
    send(text) {
      const msg = { user: DISPLAY_NAME, text, ts: Date.now() };
      this.push(msg);
      if (this.connected && this.ws) { try { this.ws.send(JSON.stringify(msg)); } catch {} }
    },
    push(msg) { this.messages.push(msg); if (this.messages.length > 100) this.messages.shift(); this.emit(); },
    emit() { this.listeners.forEach((fn) => fn()); },
  };
  chat.connect();

  // ---------- audio (WebAudio, asset-free) ----------
  const audio = {
    ctx: null, bgmGain: null, sfxGain: null, bgmNodes: null, _bgm: 0.5, _sfx: 0.7,
    ensure() {
      if (this.ctx) return;
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.bgmGain = this.ctx.createGain();
      this.bgmGain.gain.value = this._bgm * 0.12;
      this.bgmGain.connect(this.ctx.destination);
      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = this._sfx;
      this.sfxGain.connect(this.ctx.destination);
    },
    resume() { this.ensure(); if (this.ctx && this.ctx.state === "suspended") this.ctx.resume(); },
    setBgm(v) { this._bgm = v; if (this.bgmGain) this.bgmGain.gain.value = v * 0.12; },
    setSfx(v) { this._sfx = v; if (this.sfxGain) this.sfxGain.gain.value = v; },
    blip() {
      this.resume(); if (!this.ctx) return;
      const t = this.ctx.currentTime;
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = "triangle"; o.frequency.value = 660;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.9, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      o.connect(g); g.connect(this.sfxGain); o.start(t); o.stop(t + 0.17);
    },
    startBgm() {
      this.resume(); if (!this.ctx || this.bgmNodes) return;
      const freqs = [220, 277.18, 329.63]; // A minor-ish soft pad (A3 / C#4 / E4)
      const filter = this.ctx.createBiquadFilter();
      filter.type = "lowpass"; filter.frequency.value = 700; filter.Q.value = 0.6;
      filter.connect(this.bgmGain);
      const lfo = this.ctx.createOscillator(), lfoGain = this.ctx.createGain();
      lfo.frequency.value = 0.06; lfoGain.gain.value = 240;
      lfo.connect(lfoGain); lfoGain.connect(filter.frequency); lfo.start();
      const oscs = freqs.map((f, i) => {
        const o = this.ctx.createOscillator();
        o.type = "sine"; o.frequency.value = f; o.detune.value = (i - 1) * 4;
        o.connect(filter); o.start();
        return o;
      });
      this.bgmNodes = { oscs, lfo };
    },
    stopBgm() {
      if (!this.bgmNodes) return;
      this.bgmNodes.oscs.forEach((o) => { try { o.stop(); } catch (e) {} });
      try { this.bgmNodes.lfo.stop(); } catch (e) {}
      this.bgmNodes = null;
    },
  };

  // ---------- settings (persisted in localStorage) ----------
  const LS = { theme: "mgh.theme", bgm: "mgh.bgm", sfx: "mgh.sfx", bgmOn: "mgh.bgmOn" };
  function lsNum(k, d) { const v = parseInt(localStorage.getItem(k), 10); return isNaN(v) ? d : v; }
  const settings = {
    theme: localStorage.getItem(LS.theme) || "light",
    bgm: lsNum(LS.bgm, 50),
    sfx: lsNum(LS.sfx, 70),
    bgmOn: localStorage.getItem(LS.bgmOn) === "1",
  };
  function applyTheme(t) {
    settings.theme = t; localStorage.setItem(LS.theme, t);
    document.documentElement.setAttribute("data-theme", t);
  }
  applyTheme(settings.theme);
  audio._bgm = settings.bgm / 100; audio._sfx = settings.sfx / 100;

  function openSettings() {
    if (document.getElementById("settings-overlay")) return;
    const o = h(`
      <div class="overlay" id="settings-overlay">
        <div class="settings">
          <div class="settings-head"><h2>⚙️ 설정</h2><button class="settings-close" title="닫기">✕</button></div>
          <div class="set-row">
            <div class="set-label"><span>🎵 배경음악 (BGM)</span><span class="set-val" id="v-bgm">${settings.bgm}%</span></div>
            <div class="set-ctl">
              <button class="set-toggle${settings.bgmOn ? " on" : ""}" id="bgm-toggle">${settings.bgmOn ? "⏸" : "▶"}</button>
              <input type="range" min="0" max="100" value="${settings.bgm}" id="s-bgm" />
            </div>
          </div>
          <div class="set-row">
            <div class="set-label"><span>🔊 게임 소리</span><span class="set-val" id="v-sfx">${settings.sfx}%</span></div>
            <div class="set-ctl"><input type="range" min="0" max="100" value="${settings.sfx}" id="s-sfx" /></div>
          </div>
          <div class="set-row">
            <div class="set-label"><span>🎨 테마</span></div>
            <div class="theme-seg">
              <button data-theme-opt="light" class="${settings.theme === "light" ? "active" : ""}">☀️ 라이트</button>
              <button data-theme-opt="dark" class="${settings.theme === "dark" ? "active" : ""}">🌙 다크</button>
            </div>
          </div>
          ${state.view !== "login" ? `
          <div class="set-row">
            <button class="logout-btn" id="btn-logout">🚪 로그아웃</button>
          </div>` : ""}
        </div>
      </div>`);

    const close = () => o.remove();
    o.addEventListener("click", (e) => { if (e.target === o) close(); });
    o.querySelector(".settings-close").addEventListener("click", close);

    const sBgm = o.querySelector("#s-bgm"), vBgm = o.querySelector("#v-bgm"), tBgm = o.querySelector("#bgm-toggle");
    sBgm.addEventListener("input", () => {
      settings.bgm = +sBgm.value; localStorage.setItem(LS.bgm, settings.bgm);
      vBgm.textContent = settings.bgm + "%"; audio.setBgm(settings.bgm / 100);
    });
    tBgm.addEventListener("click", () => {
      settings.bgmOn = !settings.bgmOn; localStorage.setItem(LS.bgmOn, settings.bgmOn ? "1" : "0");
      if (settings.bgmOn) { audio.setBgm(settings.bgm / 100); audio.startBgm(); tBgm.classList.add("on"); tBgm.textContent = "⏸"; }
      else { audio.stopBgm(); tBgm.classList.remove("on"); tBgm.textContent = "▶"; }
    });

    const sSfx = o.querySelector("#s-sfx"), vSfx = o.querySelector("#v-sfx");
    sSfx.addEventListener("input", () => {
      settings.sfx = +sSfx.value; localStorage.setItem(LS.sfx, settings.sfx);
      vSfx.textContent = settings.sfx + "%"; audio.setSfx(settings.sfx / 100);
    });
    sSfx.addEventListener("change", () => audio.blip()); // 슬라이더 놓으면 미리듣기

    o.querySelectorAll("[data-theme-opt]").forEach((b) => b.addEventListener("click", () => {
      applyTheme(b.dataset.themeOpt);
      o.querySelectorAll("[data-theme-opt]").forEach((x) => x.classList.toggle("active", x === b));
    }));

    // 로그아웃: 저장된 토큰/계정 정리 후 손님 상태로 복귀
    o.querySelector("#btn-logout")?.addEventListener("click", () => {
      localStorage.removeItem("mgh.token");
      localStorage.removeItem("mgh.username");
      localStorage.removeItem("mgh.nickname");
      GUEST_ID = "손님" + Math.floor(1000 + Math.random() * 9000);
      DISPLAY_NAME = GUEST_ID;
      close();
      go("login");
    });

    document.body.appendChild(o);
  }

  function openSignup() {
    if (document.getElementById("signup-overlay")) return;
    const o = h(`
      <div class="overlay" id="signup-overlay">
        <div class="settings">
          <div class="settings-head"><h2>회원가입</h2><button class="settings-close" title="닫기">✕</button></div>
          <form class="login-card" id="signup-form">
            <input class="login-input" id="su-username" placeholder="아이디" autocomplete="username" />
            <input class="login-input" id="su-email" type="email" placeholder="이메일" autocomplete="email" />
            <input class="login-input" id="su-nickname" placeholder="닉네임" />
            <input class="login-input" id="su-password" type="password" placeholder="비밀번호" autocomplete="new-password" />
            <button type="submit" class="login-btn primary">가입하기</button>
          </form>
        </div>
      </div>`);

    const close = () => o.remove();
    o.addEventListener("click", (e) => { if (e.target === o) close(); });
    o.querySelector(".settings-close").addEventListener("click", close);

    o.querySelector("#signup-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const username = o.querySelector("#su-username").value.trim();
      const email = o.querySelector("#su-email").value.trim();
      const nickname = o.querySelector("#su-nickname").value.trim();
      const password = o.querySelector("#su-password").value;
      if (!username || !email || !nickname || !password) { toast("아이디, 이메일, 비밀번호, 닉네임을 모두 입력해주세요."); return; }
      try {
        const res = await fetch("/api/signup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, email, password, nickname }),
        });
        const data = await res.json();
        if (!res.ok) { toast(data.message || "회원가입에 실패했습니다."); return; }
        localStorage.setItem("mgh.token", data.token);
        GUEST_ID = data.user.username;
        localStorage.setItem("mgh.username", GUEST_ID);
        DISPLAY_NAME = data.user.nickname || GUEST_ID;
        localStorage.setItem("mgh.nickname", DISPLAY_NAME);
        close();
        go("lobby");
      } catch {
        toast("서버에 연결할 수 없습니다.");
      }
    });

    document.body.appendChild(o);
  }

  // ---------- rendering ----------
  function h(html) { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; }

  function navHTML() {
    const tab = (id, label) => `<button class="nav-tab${state.view === id || (id === "solo" && state.view.startsWith("game:")) ? " active" : ""}" data-nav="${id}">${label}</button>`;
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
          <button class="nav-icon">🔔</button>
          <button class="nav-icon" id="nav-gear" title="설정">⚙️</button>
          <div class="nav-guest"><div class="av">🙂</div><div class="who">${DISPLAY_NAME}</div></div>
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
          <p>${DISPLAY_NAME}님, 오늘도 즐거운 게임 되세요 🎮</p>
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
        if (g && g.playable) go("game:" + g.id);
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

  function vowelGameView() {
    const content = h(`
      <div class="content">
        <div class="page-head">
          <button class="page-back" data-nav="solo">←</button>
          <div class="page-title">자음 모음 조합</div>
          <div class="page-sub">자모를 모두 조합해 단어를 만드세요</div>
        </div>
        <div id="game-mount"></div>
      </div>`);
    const mount = content.querySelector("#game-mount");
    state.gameCleanup = window.VowelGame.mount(mount, { onExit: () => go("solo") });
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

  // ---- social brand icons (inline SVG, no external assets) ----
  const ICON = {
    kakao: '<svg viewBox="0 0 24 24" fill="#191600"><path d="M12 3C6.5 3 2 6.6 2 11c0 2.8 1.9 5.3 4.7 6.7-.2.7-.7 2.5-.8 2.9-.1.5.2.5.4.4.2-.1 2.7-1.8 3.7-2.5.6.1 1.3.1 2 .1 5.5 0 10-3.6 10-8S17.5 3 12 3z"/></svg>',
    naver: '<svg viewBox="0 0 24 24" fill="#fff"><path d="M16.3 12.6 7.4 0H0v24h7.7V11.4L16.6 24H24V0h-7.7z"/></svg>',
    google: '<svg viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.9 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.3l7.9 6.1C12.3 13.2 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.5 3-2.2 5.5-4.7 7.2l7.3 5.7c4.3-3.9 6.8-9.7 6.8-16.4z"/><path fill="#FBBC05" d="M10.5 28.4c-.5-1.5-.8-3.1-.8-4.9s.3-3.4.8-4.9l-7.9-6.1C1 15.6 0 19.6 0 24s1 8.4 2.6 11.5l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.3 0 11.6-2.1 15.5-5.7l-7.3-5.7c-2 1.4-4.7 2.3-8.2 2.3-6.3 0-11.7-3.7-13.5-9.4l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/></svg>',
  };

  function loginView() {
    const shell = h(`
      <div class="app-shell login-shell">
        <header class="login-top">
          <div class="nav-brand">
            <div class="nav-logo">미</div>
            <div class="nav-title">미니게임천국</div>
          </div>
          <button class="nav-icon" id="login-gear" title="설정">⚙️</button>
        </header>
        <main class="login-main">
          <form class="login-card" id="login-form">
            <input class="login-input" id="login-id" placeholder="아이디" autocomplete="username" />
            <input class="login-input" id="login-pw" type="password" placeholder="비밀번호" autocomplete="current-password" />
            <div class="login-div"></div>
            <div class="login-actions">
              <button type="submit" class="login-btn primary">로그인</button>
              <button type="button" class="login-btn primary" id="btn-signup">회원가입</button>
            </div>
            <div class="login-or"><span>소셜 계정으로 시작</span></div>
            <div class="social">
              <button type="button" class="social-btn kakao">${ICON.kakao}<span>카카오로 시작하기</span></button>
              <button type="button" class="social-btn naver">${ICON.naver}<span>네이버로 시작하기</span></button>
              <button type="button" class="social-btn google">${ICON.google}<span>Google로 시작하기</span></button>
            </div>
          </form>
        </main>
      </div>`);

    shell.querySelector("#login-gear").addEventListener("click", openSettings);
    shell.querySelector("#login-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const username = shell.querySelector("#login-id").value.trim();
      const password = shell.querySelector("#login-pw").value;
      if (!username || !password) { toast("아이디와 비밀번호를 입력해주세요."); return; }
      try {
        const res = await fetch("/api/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, password }),
        });
        const data = await res.json();
        if (!res.ok) { toast(data.message || "로그인에 실패했습니다."); return; }
        localStorage.setItem("mgh.token", data.token);
        GUEST_ID = data.user.username;
        localStorage.setItem("mgh.username", GUEST_ID);
        DISPLAY_NAME = data.user.nickname || GUEST_ID;
        localStorage.setItem("mgh.nickname", DISPLAY_NAME);
        go("lobby");
      } catch {
        toast("서버에 연결할 수 없습니다.");
      }
    });
    shell.querySelector("#btn-signup").addEventListener("click", openSignup);
    shell.querySelectorAll(".social-btn").forEach((b) => b.addEventListener("click", () => {
      const prov = b.classList.contains("kakao") ? "카카오" : b.classList.contains("naver") ? "네이버" : "Google";
      toast(`${prov} 로그인은 백엔드 연동 후 제공됩니다.`);
    }));
    return shell;
  }

  // ---------- router ----------
  let mountedSidebar = null;
  function render() {
    if (state.gameCleanup) { state.gameCleanup(); state.gameCleanup = null; }
    if (mountedSidebar && mountedSidebar._cleanup) mountedSidebar._cleanup();
    mountedSidebar = null;

    // 로그인 화면은 독립 레이아웃 (표준 네비/사이드바 없음)
    if (state.view === "login") {
      app.innerHTML = "";
      app.appendChild(loginView());
      return;
    }

    let content, sidebar;
    if (state.view === "lobby") [content, sidebar] = lobbyView();
    else if (state.view === "solo") [content, sidebar] = soloView();
    else if (state.view === "game:spot") [content, sidebar] = spotGameView();
    else if (state.view === "game:vowel") [content, sidebar] = vowelGameView();
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
    shell.querySelector("#nav-gear")?.addEventListener("click", openSettings);
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
  if (["login", "lobby", "solo", "multi", "game:spot", "game:vowel"].includes(initial)) state.view = initial;
  render();

  // BGM이 켜진 상태로 저장돼 있으면, 브라우저 자동재생 정책상 첫 클릭에서 재생 시작
  if (settings.bgmOn) {
    const kick = () => { audio.setBgm(settings.bgm / 100); audio.startBgm(); document.removeEventListener("click", kick); };
    document.addEventListener("click", kick);
  }
})();
