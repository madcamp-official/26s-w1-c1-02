/* 미니게임천국 MVP — SPA shell, views, Socket.IO 로비 채팅 + 멀티플레이 방.
   Login/profile intentionally deferred: a random guest identity is used. */
(function () {
  const app = document.getElementById("app");

  // ---- 프로필 정체성: 로그인 시 계정 아이디(username)로 교체, 로그인 전엔 손님 ----
  let GUEST_ID = localStorage.getItem("mgh.username") || ("손님" + Math.floor(1000 + Math.random() * 9000));
  // ---- 화면에 표시할 이름: 로그인 시 닉네임, 로그인 전엔 손님 아이디 ----
  let DISPLAY_NAME = localStorage.getItem("mgh.nickname") || GUEST_ID;
  // ---- 프로필 아이콘: 로그인 시 계정에 저장된 아이콘, 로그인 전엔 기본값 ----
  const DEFAULT_AVATAR = "🙂";
  let DISPLAY_AVATAR = localStorage.getItem("mgh.avatar") || DEFAULT_AVATAR;
  // 프로필 설정에서 고를 수 있는 아이콘 목록 (서버 화이트리스트와 동일하게 유지)
  const AVATARS = ["🙂", "😎", "🤖", "👻", "🐱", "🐶", "🦊", "🐻", "🐼", "🐰", "🦁", "🐸", "🐧", "🦄", "🐢", "🔥", "⭐", "🎮"];
  // 소셜 로그인 직후 닉네임 확정 전까지는 소켓에 identify(실명일 수 있는 값)를 보내지 않는다
  let awaitingNicknameConfirm = (location.hash || "").replace("#", "") === "nickname-setup";

  // 로그아웃: 저장된 토큰/계정 정리 후 손님 상태로 복귀
  function logout() {
    localStorage.removeItem("mgh.token");
    localStorage.removeItem("mgh.username");
    localStorage.removeItem("mgh.nickname");
    localStorage.removeItem("mgh.avatar");
    GUEST_ID = "손님" + Math.floor(1000 + Math.random() * 9000);
    DISPLAY_NAME = GUEST_ID;
    DISPLAY_AVATAR = DEFAULT_AVATAR;
    awaitingNicknameConfirm = false;
    net.identify(DISPLAY_NAME, DISPLAY_AVATAR);
    go("login");
  }

  // ---- app state ----
  const state = { view: "login", online: 1, gameCleanup: null, contentCleanup: null };

  // ---- solo games catalog (다른 그림 찾기 is the featured playable mode) ----
  const SOLO_GAMES = [
    { id: "vowel", icon: "🔡", title: "자음 모음 조합", badge: null,
      desc: "흩어진 자음·모음을 모두 조합해 실제 단어를 만드세요.", lv: 1, done: 0, total: 20, playable: true },
    { id: "spot", icon: "🔍", title: "다른 그림 찾기", badge: null,
      desc: "두 그림에서 서로 다른 부분을 제한 시간 안에 찾아보세요.", lv: 1, done: 0, total: 20, playable: true },
    { id: "word", icon: "🔤", title: "끝말잇기", badge: null,
      desc: "제한 시간 안에 끝말잇기 체인을 이어가세요.", lv: 1, done: 0, total: 20, playable: true },
  ];

  function modeLabel(id) {
    const m = net.modes.find((x) => x.id === id);
    return m ? m.label : id;
  }

  const DIFF_LABEL = { 1: "쉬움", 2: "보통", 3: "어려움", 4: "세종대왕" };
  const SPOT_DIFF_LABEL = { 1: "쉬움", 2: "보통", 3: "어려움", 4: "인간프린터" };

  // 실시간 게임 엔진을 마운트하는 모드 / 1대1 전용(정원 2) 모드
  const ENGINE_MODES = new Set(["vowel", "spot", "baseball"]);
  const DUEL_MODES = new Set(["baseball"]);
  const isEngineMode = (m) => ENGINE_MODES.has(m);

  // 모드별 설정 UI 메타 — 난이도 라벨/옵션, 라운드(문제 수/기회) 라벨·범위
  function cfgMeta(mode) {
    if (mode === "baseball") {
      // 횟수 제한 없음 — 먼저 맞히는 사람이 승리. 라운드 설정 미노출(hasRounds:false)
      return {
        diffLabel: "자릿수", diffOptions: [[1, "3자리"], [2, "4자리"]], diffDef: 1,
        hasRounds: false, roundsUnit: "",
        tagDiff: (d) => (String(d) === "2" ? "4자리" : "3자리"),
      };
    }
    // 다른 그림 찾기는 최고 난이도 라벨만 자체 표현("인간프린터"), 자음·모음 조합은 "세종대왕" 유지
    const label = mode === "spot" ? SPOT_DIFF_LABEL : DIFF_LABEL;
    return {
      diffLabel: "난이도", diffOptions: [1, 2, 3, 4].map((v) => [v, label[v]]), diffDef: 2,
      hasRounds: true, roundsLabel: "문제 수", roundsUnit: "개", roundsMin: 3, roundsMax: 20, roundsDef: 8,
      tagDiff: (d) => label[d] || "?",
    };
  }

  // ---- realtime: 로비 채팅 + 멀티플레이 방 (Socket.IO) ----
  const net = {
    socket: null, connected: false, listeners: new Set(),
    modes: [], rooms: [], room: null, presence: [],
    chat: [{ sys: true, text: "미니게임천국 로비에 오신 것을 환영합니다 🎉" }],
    roomChat: [],
    connect() {
      if (this.socket || typeof io === "undefined") return;
      const socket = io({ path: "/socket.io" });
      this.socket = socket;
      socket.on("connect", () => { this.connected = true; if (!awaitingNicknameConfirm) socket.emit("identify", { name: DISPLAY_NAME, avatar: DISPLAY_AVATAR }); this.emit(); });
      socket.on("disconnect", () => { this.connected = false; this.room = null; this.roomChat = []; this.emit(); });
      socket.on("modes", (modes) => { this.modes = modes; this.emit(); });
      socket.on("rooms:update", (rooms) => { this.rooms = rooms; this.emit(); });
      socket.on("presence", (users) => { this.presence = users; this.emit(); });
      socket.on("room:state", (room) => { this.room = room; this.emit(); });
      socket.on("chat:history", (msgs) => { this.chat.push(...msgs); this.emit(); });
      socket.on("chat:message", (msg) => { this.pushChat(msg); });
      socket.on("room:chat", (msg) => { this.roomChat.push(msg); if (this.roomChat.length > 200) this.roomChat.shift(); this.emit(); });
      socket.on("room:notice", (text) => toast(text));
    },
    identify(name, avatar) { if (this.socket) this.socket.emit("identify", { name, avatar }); },
    sendChat(text) { if (this.socket) this.socket.emit("chat:message", text); },
    pushChat(msg) { this.chat.push(msg); if (this.chat.length > 200) this.chat.shift(); this.emit(); },
    sendRoomChat(text) { if (this.socket) this.socket.emit("room:chat", text); },
    createRoom(payload) {
      return new Promise((res) => this.socket.emit("room:create", payload, (r) => {
        if (r && r.ok && r.room) { this.room = r.room; this.roomChat = []; this.emit(); }
        res(r);
      }));
    },
    joinRoom(payload) {
      return new Promise((res) => this.socket.emit("room:join", payload, (r) => {
        if (r && r.ok && r.room) { this.room = r.room; this.roomChat = []; this.emit(); }
        res(r);
      }));
    },
    leaveRoom() {
      this.roomChat = []; this.room = null;
      this.emit();
      return new Promise((res) => this.socket.emit("room:leave", res));
    },
    setMode(mode) { if (this.socket) this.socket.emit("room:setMode", mode); },
    setConfig(cfg) { if (this.socket) this.socket.emit("room:setConfig", cfg); },
    toggleReady() { if (this.socket) this.socket.emit("room:ready"); },
    toggleStart() { if (this.socket) this.socket.emit("room:start"); },
    emit() { this.listeners.forEach((fn) => fn()); },
  };
  net.connect();

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

    o.querySelector("#btn-logout")?.addEventListener("click", () => { close(); logout(); });

    document.body.appendChild(o);
  }

  function openProfile() {
    if (document.getElementById("profile-overlay")) return;
    let selectedAvatar = DISPLAY_AVATAR;
    const o = h(`
      <div class="overlay" id="profile-overlay">
        <div class="settings">
          <div class="settings-head"><h2>🙂 프로필</h2><button class="settings-close" title="닫기">✕</button></div>
          <div class="set-row">
            <div class="set-label"><span>닉네임</span></div>
            <input class="login-input" id="profile-nickname" maxlength="20" value="${escape(DISPLAY_NAME)}" />
          </div>
          <div class="set-row">
            <div class="set-label"><span>아이콘</span></div>
            <div class="avatar-grid">
              ${AVATARS.map((a) => `<button type="button" class="avatar-opt${a === DISPLAY_AVATAR ? " active" : ""}" data-avatar="${a}">${a}</button>`).join("")}
            </div>
          </div>
          <div class="profile-actions">
            <button class="login-btn primary" id="profile-save">저장</button>
          </div>
        </div>
      </div>`);

    const close = () => o.remove();
    o.addEventListener("click", (e) => { if (e.target === o) close(); });
    o.querySelector(".settings-close").addEventListener("click", close);

    o.querySelectorAll("[data-avatar]").forEach((btn) => btn.addEventListener("click", () => {
      selectedAvatar = btn.dataset.avatar;
      o.querySelectorAll("[data-avatar]").forEach((b) => b.classList.toggle("active", b === btn));
    }));

    o.querySelector("#profile-save").addEventListener("click", async () => {
      const nickname = o.querySelector("#profile-nickname").value.trim();
      if (!nickname) { toast("닉네임을 입력해주세요."); return; }
      const token = localStorage.getItem("mgh.token");
      try {
        if (nickname !== DISPLAY_NAME) {
          const res = await fetch("/api/profile/nickname", {
            method: "PATCH",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ nickname }),
          });
          const data = await res.json();
          if (!res.ok) { toast(data.message || "닉네임 변경에 실패했습니다."); return; }
          DISPLAY_NAME = data.nickname;
          localStorage.setItem("mgh.nickname", DISPLAY_NAME);
          net.identify(DISPLAY_NAME, DISPLAY_AVATAR);
        }
        if (selectedAvatar !== DISPLAY_AVATAR) {
          const res = await fetch("/api/profile/avatar", {
            method: "PATCH",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ avatar: selectedAvatar }),
          });
          const data = await res.json();
          if (!res.ok) { toast(data.message || "아이콘 변경에 실패했습니다."); return; }
          DISPLAY_AVATAR = data.avatar;
          localStorage.setItem("mgh.avatar", DISPLAY_AVATAR);
          net.identify(DISPLAY_NAME, DISPLAY_AVATAR);
        }
        close();
        render();
        toast("프로필을 저장했습니다.");
      } catch {
        toast("서버에 연결할 수 없습니다.");
      }
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
        DISPLAY_AVATAR = data.user.avatar || DEFAULT_AVATAR;
        localStorage.setItem("mgh.avatar", DISPLAY_AVATAR);
        net.identify(DISPLAY_NAME, DISPLAY_AVATAR);
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
          <button class="nav-icon" id="nav-gear" title="설정">⚙️</button>
          <button class="nav-guest" id="nav-profile" title="프로필"><div class="av">${DISPLAY_AVATAR}</div><div class="who">${DISPLAY_NAME}</div></button>
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
      scroll.innerHTML = net.chat.map((m) =>
        m.sys
          ? `<div class="chat-line"><span class="sys">${escape(m.text)}</span></div>`
          : `<div class="chat-line"><span class="u">${escape(m.user)}</span>${escape(m.text)}</div>`
      ).join("");
      scroll.scrollTop = scroll.scrollHeight;
    }
    function submit() {
      const v = input.value.trim();
      if (!v) return;
      net.sendChat(v); input.value = "";
    }
    el.querySelector("#chat-send").addEventListener("click", submit);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });

    const listener = () => paint();
    net.listeners.add(listener);
    el._cleanup = () => net.listeners.delete(listener);
    paint();
    return el;
  }

  function sidebarUsers() {
    const el = h(`
      <aside class="sidebar">
        <div class="side-head"><div class="t">👥 접속자</div><div class="c" id="users-count">0명</div></div>
        <div class="side-scroll" id="users-scroll"></div>
      </aside>`);

    const scroll = el.querySelector("#users-scroll");
    const count = el.querySelector("#users-count");
    function paint() {
      const users = net.presence;
      count.textContent = `${users.length}명`;
      if (!users.length) {
        scroll.innerHTML = `<div class="chat-line"><span class="sys">${net.connected ? "접속 중인 플레이어가 없습니다" : "오프라인 모드"}</span></div>`;
        return;
      }
      const myId = net.socket && net.socket.id;
      // 나를 항상 목록 맨 위로 고정 (안정 정렬)
      const ordered = [...users].sort((a, b) => (b.id === myId) - (a.id === myId));
      scroll.innerHTML = ordered.map((u) => {
        const name = u.name || "손님";
        const me = u.id && u.id === myId;
        return `<div class="user-row"><div class="av">${u.avatar || DEFAULT_AVATAR}</div>${escape(name)}${me ? ' <span class="me-tag">(나)</span>' : ""}</div>`;
      }).join("");
    }

    const listener = () => paint();
    net.listeners.add(listener);
    el._cleanup = () => net.listeners.delete(listener);
    paint();
    return el;
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
    return [content, null];
  }

  // 로그인 상태면 레벨제 솔로 게임들의 실제 레벨/진행도를 가져와 SOLO_GAMES에 반영.
  // apiPath/maxLevel는 각 게임 클라이언트(vowel-game.js/spot-difference.js)의 값과 동일해야 함.
  const PROGRESS_GAMES = [
    { id: "vowel", apiPath: "jamo", maxLevel: 20 },
    { id: "spot", apiPath: "spot", maxLevel: 20 },
    { id: "word", apiPath: "wordchain", maxLevel: 20 },
  ];
  async function refreshSoloProgress() {
    const token = localStorage.getItem("mgh.token");
    if (!token) return;
    let changed = false;
    await Promise.all(PROGRESS_GAMES.map(async ({ id, apiPath, maxLevel }) => {
      try {
        // 진행도는 서버 DB(user_game_progress)에서만 읽는다. 이 브라우저의 로컬 캐시는 참고/반영하지 않는다.
        const res = await fetch(`/api/games/${apiPath}/progress`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const data = await res.json();
        const g = SOLO_GAMES.find((x) => x.id === id);
        if (!g) return;
        // soloLevel = 깬 레벨 수(0 기준). done=깬 레벨 수, lv=현재(플레이 가능한) 레벨=깬 수+1.
        const cleared = data.soloLevel ?? data.meta?.[apiPath]?.level ?? 0;
        const lv = Math.min(maxLevel, cleared + 1);
        if (g.lv !== lv || g.done !== cleared || g.total !== maxLevel) changed = true;
        g.lv = lv;
        g.done = cleared;
        g.total = maxLevel;
      } catch (e) {
        // 네트워크 오류 시 기존 표시값 유지
      }
    }));
    if (changed && state.view === "solo") render();
  }

  function soloView() {
    refreshSoloProgress();
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
            <div class="gi-right"><div class="gi-lv">Lv.${g.lv}</div></div>
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

  function wordGameView() {
    const content = h(`
      <div class="content">
        <div class="page-head">
          <button class="page-back" data-nav="solo">←</button>
          <div class="page-title">끝말잇기</div>
          <div class="page-sub">제한 시간 안에 끝말잇기 체인을 이어가세요</div>
        </div>
        <div id="game-mount"></div>
      </div>`);
    const mount = content.querySelector("#game-mount");
    state.gameCleanup = window.WordChainGame.mount(mount, { onExit: () => go("solo") });
    return [content, null];
  }

  // ---- 방 생성 모달 ----
  function openCreateRoom() {
    if (document.getElementById("room-create-overlay")) return;
    if (!net.connected) { toast("서버에 연결되어 있지 않습니다."); return; }
    const modes = net.modes.length ? net.modes : [{ id: "spot", label: "다른그림찾기" }];

    const o = h(`
      <div class="overlay" id="room-create-overlay">
        <form class="room-modal" id="room-create-form">
          <div class="room-modal-head"><h2>방 만들기</h2><button type="button" class="settings-close" title="닫기">✕</button></div>
          <div class="rm-field">
            <label for="rc-name">방 이름</label>
            <input class="rm-input" id="rc-name" placeholder="방 이름을 입력하세요" maxlength="40" />
          </div>
          <div class="rm-field">
            <label for="rc-mode">게임 모드</label>
            <select class="rm-input" id="rc-mode">
              ${modes.map((m) => `<option value="${m.id}">${escape(m.label)}</option>`).join("")}
            </select>
          </div>
          <div class="rm-field vowel-cfg" id="rc-vowel-cfg" hidden>
            <label for="rc-diff" id="rc-diff-label">난이도</label>
            <select class="rm-input" id="rc-diff"></select>
            <div id="rc-rounds-wrap">
              <div class="rm-slider-label" style="margin-top:12px"><span id="rc-rounds-label">문제 수</span>: <span id="rc-rounds-val">8</span><span id="rc-rounds-unit">개</span></div>
              <input type="range" min="3" max="20" step="1" value="8" id="rc-rounds" />
              <div class="rm-slider-ends"><span id="rc-rounds-lo">3개</span><span id="rc-rounds-hi">20개</span></div>
            </div>
          </div>
          <div class="rm-field">
            <div class="rm-slider-label">최대 인원: <span id="rc-max-val">6</span>명</div>
            <input type="range" min="2" max="8" step="1" value="6" id="rc-max" />
            <div class="rm-slider-ends"><span>2명</span><span>8명</span></div>
          </div>
          <div class="rm-toggle-row">
            <span>비밀방</span>
            <button type="button" class="rm-switch" id="rc-private" role="switch" aria-checked="false"></button>
          </div>
          <input class="rm-input" id="rc-password" type="password" placeholder="비밀번호" style="display:none" />
          <div class="rm-actions">
            <button type="button" class="rm-btn ghost" id="rc-cancel">취소</button>
            <button type="submit" class="rm-btn primary">방 생성</button>
          </div>
        </form>
      </div>`);

    const close = () => o.remove();
    o.addEventListener("click", (e) => { if (e.target === o) close(); });
    o.querySelector(".settings-close").addEventListener("click", close);
    o.querySelector("#rc-cancel").addEventListener("click", close);

    const maxSlider = o.querySelector("#rc-max"), maxVal = o.querySelector("#rc-max-val");
    maxSlider.addEventListener("input", () => { maxVal.textContent = maxSlider.value; });

    // 실시간 게임 모드에서만 설정(난이도/문제 수 또는 자릿수/기회) 노출
    const modeSel = o.querySelector("#rc-mode");
    const vowelCfg = o.querySelector("#rc-vowel-cfg");
    const diffSel = o.querySelector("#rc-diff");
    const roundsSlider = o.querySelector("#rc-rounds"), roundsVal = o.querySelector("#rc-rounds-val");
    roundsSlider.addEventListener("input", () => { roundsVal.textContent = roundsSlider.value; });
    const syncVowelCfg = () => {
      const mode = modeSel.value;
      vowelCfg.hidden = !isEngineMode(mode);
      const meta = cfgMeta(mode);
      // 난이도/자릿수 옵션 재구성
      o.querySelector("#rc-diff-label").textContent = meta.diffLabel;
      diffSel.innerHTML = meta.diffOptions
        .map(([v, lb]) => `<option value="${v}"${v === meta.diffDef ? " selected" : ""}>${lb}</option>`).join("");
      // 문제 수/기회 슬라이더 — hasRounds 인 모드만 노출(숫자야구는 제한 없음)
      o.querySelector("#rc-rounds-wrap").hidden = !meta.hasRounds;
      if (meta.hasRounds) {
        o.querySelector("#rc-rounds-label").textContent = meta.roundsLabel;
        o.querySelector("#rc-rounds-unit").textContent = meta.roundsUnit;
        o.querySelector("#rc-rounds-lo").textContent = meta.roundsMin + meta.roundsUnit;
        o.querySelector("#rc-rounds-hi").textContent = meta.roundsMax + meta.roundsUnit;
        roundsSlider.min = meta.roundsMin; roundsSlider.max = meta.roundsMax; roundsSlider.value = meta.roundsDef;
        roundsVal.textContent = meta.roundsDef;
      }
      // 1대1 전용 모드: 정원 2명 고정
      const duel = DUEL_MODES.has(mode);
      if (duel) { maxSlider.value = 2; maxVal.textContent = 2; }
      maxSlider.disabled = duel;
      maxSlider.closest(".rm-field").style.opacity = duel ? ".5" : "";
    };
    modeSel.addEventListener("change", syncVowelCfg);
    syncVowelCfg();

    let isPrivate = false;
    const privSwitch = o.querySelector("#rc-private");
    const pwInput = o.querySelector("#rc-password");
    privSwitch.addEventListener("click", () => {
      isPrivate = !isPrivate;
      privSwitch.classList.toggle("on", isPrivate);
      privSwitch.setAttribute("aria-checked", isPrivate ? "true" : "false");
      pwInput.style.display = isPrivate ? "" : "none";
      if (isPrivate) pwInput.focus();
    });

    o.querySelector("#room-create-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const name = o.querySelector("#rc-name").value.trim();
      if (!name) { toast("방 이름을 입력해주세요."); return; }
      const password = pwInput.value;
      if (isPrivate && !password) { toast("비밀방은 비밀번호를 입력해주세요."); return; }
      const res = await net.createRoom({
        name, mode: modeSel.value, maxPlayers: +maxSlider.value,
        difficulty: +o.querySelector("#rc-diff").value, rounds: +roundsSlider.value,
        private: isPrivate, password,
      });
      if (!res.ok) { toast(res.message || "방 생성에 실패했습니다."); return; }
      close();
      go("room");
    });

    document.body.appendChild(o);
    o.querySelector("#rc-name").focus();
  }

  // ---- 방 코드로 참가 모달 ----
  function openJoinByCode() {
    if (document.getElementById("room-join-overlay")) return;
    if (!net.connected) { toast("서버에 연결되어 있지 않습니다."); return; }
    const o = h(`
      <div class="overlay" id="room-join-overlay">
        <form class="room-modal" id="room-join-form">
          <div class="room-modal-head"><h2>방 참가</h2><button type="button" class="settings-close" title="닫기">✕</button></div>
          <div class="rm-field">
            <label for="rj-code">방 코드</label>
            <input class="rm-input rm-upper" id="rj-code" placeholder="방 코드를 입력하세요" maxlength="12" autocapitalize="characters" />
          </div>
          <div class="rm-field">
            <label for="rj-password">비밀번호</label>
            <input class="rm-input" id="rj-password" type="password" placeholder="비밀방인 경우 입력" />
          </div>
          <div class="rm-actions">
            <button type="button" class="rm-btn ghost" id="rj-cancel">취소</button>
            <button type="submit" class="rm-btn primary">참가하기</button>
          </div>
        </form>
      </div>`);

    const close = () => o.remove();
    o.addEventListener("click", (e) => { if (e.target === o) close(); });
    o.querySelector(".settings-close").addEventListener("click", close);
    o.querySelector("#rj-cancel").addEventListener("click", close);

    // 방 코드 입력 시 자동으로 대문자 변환
    const codeInput = o.querySelector("#rj-code");
    codeInput.addEventListener("input", () => {
      const start = codeInput.selectionStart;
      codeInput.value = codeInput.value.toUpperCase();
      codeInput.setSelectionRange(start, start);
    });

    o.querySelector("#room-join-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const roomId = o.querySelector("#rj-code").value.trim().toUpperCase();
      if (!roomId) { toast("방 코드를 입력해주세요."); return; }
      const password = o.querySelector("#rj-password").value;
      const res = await net.joinRoom({ roomId, password });
      if (!res.ok) { toast(res.message || "참가에 실패했습니다."); return; }
      close();
      go("room");
    });

    document.body.appendChild(o);
    o.querySelector("#rj-code").focus();
  }

  // ---- 비밀방 참가 시 비밀번호 입력 모달 ----
  function openRoomPassword(room) {
    if (document.getElementById("room-pw-overlay")) return;
    const o = h(`
      <div class="overlay" id="room-pw-overlay">
        <form class="room-modal" id="room-pw-form">
          <div class="room-modal-head"><h2>🔒 ${escape(room.name)}</h2><button type="button" class="settings-close" title="닫기">✕</button></div>
          <div class="rm-field">
            <label for="rp-password">비밀번호</label>
            <input class="rm-input" id="rp-password" type="password" placeholder="비밀번호를 입력하세요" />
          </div>
          <div class="rm-actions">
            <button type="button" class="rm-btn ghost" id="rp-cancel">취소</button>
            <button type="submit" class="rm-btn primary">입장하기</button>
          </div>
        </form>
      </div>`);

    const close = () => o.remove();
    o.addEventListener("click", (e) => { if (e.target === o) close(); });
    o.querySelector(".settings-close").addEventListener("click", close);
    o.querySelector("#rp-cancel").addEventListener("click", close);

    o.querySelector("#room-pw-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const password = o.querySelector("#rp-password").value;
      const res = await net.joinRoom({ roomId: room.id, password });
      if (!res.ok) { toast(res.message || "참가에 실패했습니다."); return; }
      close();
      go("room");
    });

    document.body.appendChild(o);
    o.querySelector("#rp-password").focus();
  }

  function multiView() {
    const content = h(`
      <div class="content">
        <div class="page-head">
          <button class="page-back" data-nav="lobby">←</button>
          <div class="page-title">멀티플레이 로비</div>
          <div class="page-sub" id="mp-count">방 ${net.rooms.length}개</div>
        </div>
        <div class="mp-toolbar">
          <div class="mp-search"><input id="room-search" placeholder="방 검색..." /></div>
          <button class="btn primary" id="mk-room">＋ 방 생성</button>
          <button class="btn" id="join-room">→ 방 참가</button>
        </div>
        <div class="rooms">
          <table>
            <thead><tr><th>방 이름</th><th>방장</th><th>모드</th><th>인원</th><th>상태</th></tr></thead>
            <tbody></tbody>
          </table>
        </div>
      </div>`);

    const tbody = content.querySelector("tbody");
    const count = content.querySelector("#mp-count");
    const search = content.querySelector("#room-search");

    function paint() {
      const q = search.value.trim().toLowerCase();
      const rooms = q ? net.rooms.filter((r) => r.name.toLowerCase().includes(q)) : net.rooms;

      count.textContent = q ? `방 ${rooms.length}개 (전체 ${net.rooms.length}개)` : `방 ${net.rooms.length}개`;
      tbody.innerHTML = rooms.length
        ? rooms.map((r) => `
          <tr data-room="${r.id}">
            <td><div class="room-name">${r.locked ? "🔒 " : ""}${escape(r.name)}</div></td>
            <td class="host">☆ ${escape(r.hostName)}</td>
            <td>${escape(modeLabel(r.mode))}</td>
            <td>${r.cur}/${r.max}</td>
            <td><span class="state ${r.state === "wait" ? "wait" : "play"}">${r.state === "wait" ? "대기중" : "게임중"}</span></td>
          </tr>`).join("")
        : `<tr><td colspan="5" class="rooms-empty">${q ? "검색 결과가 없어요." : "아직 생성된 방이 없어요. 방을 만들어보세요!"}</td></tr>`;

      tbody.querySelectorAll("tr[data-room]").forEach((tr) => tr.addEventListener("click", async () => {
        const room = net.rooms.find((r) => r.id === tr.dataset.room);
        if (!room) return;
        if (room.cur >= room.max) { toast("방 인원이 가득 찼습니다."); return; }
        if (room.locked) { openRoomPassword(room); return; }
        const res = await net.joinRoom({ roomId: room.id });
        if (!res.ok) { toast(res.message || "참가에 실패했습니다."); return; }
        go("room");
      }));
    }

    content.querySelector("#mk-room").addEventListener("click", openCreateRoom);
    content.querySelector("#join-room").addEventListener("click", openJoinByCode);
    search.addEventListener("input", paint);

    const listener = () => paint();
    net.listeners.add(listener);
    content._cleanup = () => net.listeners.delete(listener);
    paint();
    return [content, sidebarUsers()];
  }

  function sidebarRoomChat() {
    const el = h(`
      <aside class="sidebar">
        <div class="side-head"><div class="t">💬 방 채팅</div><div class="c" id="room-chat-count">0명</div></div>
        <div class="side-scroll" id="room-chat-scroll"></div>
        <div class="side-input">
          <input id="room-chat-input" placeholder="메시지 입력..." maxlength="120" />
          <button id="room-chat-send">➤</button>
        </div>
      </aside>`);

    const scroll = el.querySelector("#room-chat-scroll");
    const count = el.querySelector("#room-chat-count");
    const input = el.querySelector("#room-chat-input");
    function paint() {
      const room = net.room;
      const inGame = !!(room && room.state === "play" && isEngineMode(room.mode));
      el.classList.toggle("in-game", inGame);
      count.textContent = `${net.room ? net.room.players.length : 0}명`;
      scroll.innerHTML = net.roomChat.map((m) =>
        m.sys
          ? `<div class="chat-line"><span class="sys">${escape(m.text)}</span></div>`
          : `<div class="chat-line"><span class="u">${escape(m.user)}</span>${escape(m.text)}</div>`
      ).join("");
      scroll.scrollTop = scroll.scrollHeight;
    }
    function submit() {
      const v = input.value.trim();
      if (!v) return;
      net.sendRoomChat(v); input.value = "";
    }
    el.querySelector("#room-chat-send").addEventListener("click", submit);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });

    const listener = () => paint();
    net.listeners.add(listener);
    el._cleanup = () => net.listeners.delete(listener);
    paint();
    return el;
  }

  function roomView() {
    const content = h(`<div class="content"><div id="room-root"></div></div>`);
    const root = content.querySelector("#room-root");
    let gearOpen = false;

    // 멀티 게임 마운트 상태 (자음·모음 조합 / 다른 그림 찾기 실시간 대전)
    let gameCleanup = null, gameMounted = false, gameFinished = false;
    function mountGame(mode) {
      root.innerHTML = "";
      gameMounted = true; gameFinished = false;
      const engine = mode === "spot" ? window.SpotMulti
        : mode === "baseball" ? window.BaseballMulti
        : window.VowelMulti;
      gameCleanup = engine.mount(root, {
        socket: net.socket,
        onExit: exitGame,
        onFinish: () => { gameFinished = true; },
      });
      content.classList.add("room-playing");
    }
    function unmountGame() {
      if (gameCleanup) { gameCleanup(); gameCleanup = null; }
      gameMounted = false; gameFinished = false;
      content.classList.remove("room-playing");
    }
    function exitGame() { unmountGame(); paint(); }

    function leaveAndGoLobby() {
      unmountGame();
      net.leaveRoom().then(() => go("multi"));
    }

    // 기어 메뉴: 바깥 클릭 시 닫기
    function onDocClick(e) {
      if (!gearOpen || e.target.closest(".room-gear-wrap")) return;
      gearOpen = false;
      const menu = root.querySelector("#room-gear-menu");
      if (menu) menu.hidden = true;
    }
    document.addEventListener("click", onDocClick);

    function paint() {
      const room = net.room;
      if (!room) { unmountGame(); go("multi"); return; }

      // 실시간 게임 진행 중 → 게임 화면을 마운트하고 이후 재렌더는 게임이 자체 관리
      if (room.state === "play" && isEngineMode(room.mode)) {
        if (!gameMounted) mountGame(room.mode);
        return;
      }
      // 대기 상태로 돌아왔는데 게임이 아직 붙어 있으면:
      //  - 정상 종료(gameFinished): 최종 순위 오버레이 유지 (사용자가 "대기실로" 누를 때까지)
      //  - 그 외(방장이 중간에 대기실로 되돌림): 게임 정리 후 대기실 렌더
      if (gameMounted) {
        if (gameFinished) return;
        unmountGame();
      }

      const isHost = !!(net.socket && room.hostId === net.socket.id);
      const meId = net.socket && net.socket.id;
      // 난이도·문제 수(또는 자릿수·기회) 설정을 쓰는 실시간 게임
      const isVowel = isEngineMode(room.mode);
      const meta = cfgMeta(room.mode);
      const modeOptions = (net.modes.length ? net.modes : [{ id: room.mode, label: modeLabel(room.mode) }])
        .map((m) => `<option value="${m.id}"${m.id === room.mode ? " selected" : ""}>${escape(m.label)}</option>`).join("");
      // 시작 게이트: 방장 제외 전원 준비 + (2명 이상)
      const others = room.players.filter((p) => p.id !== room.hostId);
      const allReady = others.every((p) => p.ready);
      const canStart = room.players.length >= 2 && allReady;
      const startHint = room.players.length < 2 ? "2명 이상이 필요합니다"
        : !allReady ? "전원 준비 대기 중" : "";

      // 참가자 자리 + 빈 자리(점선 플레이스홀더). 방장=방장, 그 외=준비/대기(본인은 클릭 토글)
      const slots = room.players.map((p) => {
        const host = p.id === room.hostId;
        const me = p.id === meId;
        let badge;
        if (host) badge = `<span class="slot-badge host">방장</span>`;
        else if (me) badge = `<button class="slot-badge ready-btn ${p.ready ? "on" : "off"}" data-ready="1">${p.ready ? "준비완료" : "준비하기"}</button>`;
        else badge = `<span class="slot-badge ${p.ready ? "on" : "off"}">${p.ready ? "준비" : "대기중"}</span>`;
        return `
          <div class="slot filled${me ? " me-slot" : ""}">
            <div class="av">${p.avatar || DEFAULT_AVATAR}</div>
            <span class="slot-name">${escape(p.name)}</span>
            ${badge}
          </div>`;
      }).join("");
      const emptyCount = Math.max(0, room.maxPlayers - room.players.length);
      const emptySlots = Array.from({ length: emptyCount }, () => `<div class="slot empty"></div>`).join("");

      const startDisabled = isHost && room.state === "wait" && !canStart;
      root.innerHTML = `
        <div class="page-head room-head">
          <button class="page-back" id="room-back">←</button>
          <div class="page-title">${escape(room.name)}</div>
          <div class="room-head-actions">
            ${isHost ? `<button class="btn primary" id="room-toggle"${startDisabled ? " disabled" : ""}${startHint ? ` title="${escape(startHint)}"` : ""}>${room.state === "wait" ? "게임 시작" : "대기실로"}</button>` : ""}
            ${isHost ? `
            <div class="room-gear-wrap">
              <button class="nav-icon" id="room-gear" title="게임 설정">⚙️</button>
              <div class="room-gear-menu" id="room-gear-menu"${gearOpen ? "" : " hidden"}>
                <div class="rgm-label">게임 모드</div>
                <select class="rm-input" id="room-mode">${modeOptions}</select>
                ${isVowel ? `
                <div class="rgm-label" style="margin-top:10px">${meta.diffLabel}</div>
                <select class="rm-input" id="room-diff">
                  ${meta.diffOptions.map(([v, lb]) => `<option value="${v}"${room.difficulty === v ? " selected" : ""}>${lb}</option>`).join("")}
                </select>
                ${meta.hasRounds ? `
                <div class="rgm-label" style="margin-top:10px">${meta.roundsLabel}: <span id="room-rounds-val">${room.rounds}</span>${meta.roundsUnit}</div>
                <input type="range" min="${meta.roundsMin}" max="${meta.roundsMax}" step="1" value="${room.rounds}" id="room-rounds" />` : ""}` : ""}
              </div>
            </div>` : ""}
          </div>
        </div>
        <div class="room-info-line">
          ${isHost ? "" : `<span class="room-mode-tag">${escape(modeLabel(room.mode))}</span>`}
          ${isVowel ? `<span class="room-mode-tag">${meta.tagDiff(room.difficulty)}${meta.hasRounds ? ` · ${room.rounds}${meta.roundsUnit}` : ""}</span>` : ""}
          <span class="state ${room.state === "wait" ? "wait" : "play"}">${room.state === "wait" ? "대기중" : "게임중"}</span>
          <span class="room-info-meta">코드 ${escape(String(room.id).toUpperCase())}${room.locked ? " · 🔒" : ""} · ${room.players.length}/${room.maxPlayers}</span>
        </div>
        ${startHint && isHost && room.state === "wait" ? `<div class="room-start-hint">${escape(startHint)}</div>` : ""}
        <div class="room-slots">${slots}${emptySlots}</div>`;

      root.querySelector("#room-back").addEventListener("click", leaveAndGoLobby);
      const modeSel = root.querySelector("#room-mode");
      if (modeSel) modeSel.addEventListener("change", () => net.setMode(modeSel.value));
      const diffSel = root.querySelector("#room-diff");
      if (diffSel) diffSel.addEventListener("change", () => net.setConfig({ difficulty: +diffSel.value, rounds: room.rounds }));
      const roundsSlider = root.querySelector("#room-rounds");
      if (roundsSlider) {
        const rv = root.querySelector("#room-rounds-val");
        roundsSlider.addEventListener("input", () => { if (rv) rv.textContent = roundsSlider.value; });
        roundsSlider.addEventListener("change", () => net.setConfig({ difficulty: room.difficulty, rounds: +roundsSlider.value }));
      }
      const toggleBtn = root.querySelector("#room-toggle");
      if (toggleBtn) toggleBtn.addEventListener("click", () => { if (!toggleBtn.disabled) net.toggleStart(); });
      const gearBtn = root.querySelector("#room-gear");
      if (gearBtn) gearBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        gearOpen = !gearOpen;
        root.querySelector("#room-gear-menu").hidden = !gearOpen;
      });
      const readyBtn = root.querySelector("[data-ready]");
      if (readyBtn) readyBtn.addEventListener("click", () => net.toggleReady());
    }

    const listener = () => paint();
    net.listeners.add(listener);
    content._cleanup = () => { unmountGame(); net.listeners.delete(listener); document.removeEventListener("click", onDocClick); };
    paint();
    return [content, sidebarRoomChat()];
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
        DISPLAY_AVATAR = data.user.avatar || DEFAULT_AVATAR;
        localStorage.setItem("mgh.avatar", DISPLAY_AVATAR);
        net.identify(DISPLAY_NAME, DISPLAY_AVATAR);
        go("lobby");
      } catch {
        toast("서버에 연결할 수 없습니다.");
      }
    });
    shell.querySelector("#btn-signup").addEventListener("click", openSignup);
    shell.querySelectorAll(".social-btn").forEach((b) => {
      if (b.classList.contains("kakao")) {
        b.addEventListener("click", () => { location.href = "/auth/kakao"; });
        return;
      }
      if (b.classList.contains("google")) {
        b.addEventListener("click", () => { location.href = "/auth/google"; });
        return;
      }
      if (b.classList.contains("naver")) {
        b.addEventListener("click", () => { location.href = "/auth/naver"; });
        return;
      }
    });
    return shell;
  }

  // 소셜 로그인 직후 닉네임 확인/설정 (구글/네이버는 실명이 그대로 넘어올 수 있어 확인 절차 필요)
  function nicknameSetupView() {
    const shell = h(`
      <div class="app-shell login-shell">
        <header class="login-top">
          <div class="nav-brand">
            <div class="nav-logo">미</div>
            <div class="nav-title">미니게임천국</div>
          </div>
        </header>
        <main class="login-main">
          <form class="login-card" id="nickname-form">
            <div class="login-or"><span>다른 유저에게 보여질 닉네임을 입력해주세요</span></div>
            <input class="login-input" id="nickname-input" placeholder="닉네임" maxlength="20" autocomplete="off" />
            <div class="login-div"></div>
            <div class="login-actions">
              <button type="submit" class="login-btn primary">닉네임 설정하기</button>
              <button type="button" class="login-btn" id="nickname-cancel">다른 계정으로 로그인</button>
            </div>
          </form>
        </main>
      </div>`);

    shell.querySelector("#nickname-cancel").addEventListener("click", logout);
    shell.querySelector("#nickname-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const nickname = shell.querySelector("#nickname-input").value.trim();
      if (!nickname) { toast("닉네임을 입력해주세요."); return; }
      try {
        const token = localStorage.getItem("mgh.token");
        const res = await fetch("/api/profile/nickname", {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ nickname }),
        });
        const data = await res.json();
        if (!res.ok) {
          toast(data.message || "닉네임 설정에 실패했습니다.");
          if (res.status === 401) logout();
          return;
        }
        DISPLAY_NAME = data.nickname;
        localStorage.setItem("mgh.nickname", DISPLAY_NAME);
        awaitingNicknameConfirm = false;
        net.identify(DISPLAY_NAME, DISPLAY_AVATAR);
        go("lobby");
      } catch {
        toast("서버에 연결할 수 없습니다.");
      }
    });
    return shell;
  }

  // ---------- router ----------
  let mountedSidebar = null;
  function render() {
    if (state.gameCleanup) { state.gameCleanup(); state.gameCleanup = null; }
    if (state.contentCleanup) { state.contentCleanup(); state.contentCleanup = null; }
    if (mountedSidebar && mountedSidebar._cleanup) mountedSidebar._cleanup();
    mountedSidebar = null;

    // 로그인 / 닉네임 설정 화면은 독립 레이아웃 (표준 네비/사이드바 없음)
    if (state.view === "login") {
      app.innerHTML = "";
      app.appendChild(loginView());
      return;
    }
    if (state.view === "nickname-setup") {
      app.innerHTML = "";
      app.appendChild(nicknameSetupView());
      return;
    }

    // 방에 참여 중이 아닌데 방 화면으로 온 경우 (새로고침 등) 로비로 되돌림
    if (state.view === "room" && !net.room) { state.view = "multi"; }

    let content, sidebar;
    if (state.view === "lobby") [content, sidebar] = lobbyView();
    else if (state.view === "solo") [content, sidebar] = soloView();
    else if (state.view === "game:spot") [content, sidebar] = spotGameView();
    else if (state.view === "game:vowel") [content, sidebar] = vowelGameView();
    else if (state.view === "game:word") [content, sidebar] = wordGameView();
    else if (state.view === "multi") [content, sidebar] = multiView();
    else if (state.view === "room") [content, sidebar] = roomView();

    state.contentCleanup = content && content._cleanup ? content._cleanup : null;
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
    shell.querySelector("#nav-profile")?.addEventListener("click", () => {
      if (!localStorage.getItem("mgh.token")) { toast("로그인 후 이용할 수 있습니다."); return; }
      openProfile();
    });
  }

  function go(view) { state.view = view; location.hash = view; render(); }

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
  const bootParams = new URLSearchParams(location.search);
  const tokenFromUrl = bootParams.get("token");
  if (tokenFromUrl) {
    localStorage.setItem("mgh.token", tokenFromUrl);
    GUEST_ID = bootParams.get("username") || GUEST_ID;
    localStorage.setItem("mgh.username", GUEST_ID);
    DISPLAY_NAME = bootParams.get("nickname") || GUEST_ID;
    localStorage.setItem("mgh.nickname", DISPLAY_NAME);
    DISPLAY_AVATAR = bootParams.get("avatar") || DEFAULT_AVATAR;
    localStorage.setItem("mgh.avatar", DISPLAY_AVATAR);
    history.replaceState(null, "", location.pathname + location.hash);
  }

  const initial = (location.hash || "").replace("#", "");
  if (["login", "lobby", "solo", "multi", "game:spot", "game:vowel", "game:word", "nickname-setup"].includes(initial)) state.view = initial;
  render();

  // BGM이 켜진 상태로 저장돼 있으면, 브라우저 자동재생 정책상 첫 클릭에서 재생 시작
  if (settings.bgmOn) {
    const kick = () => { audio.setBgm(settings.bgm / 100); audio.startBgm(); document.removeEventListener("click", kick); };
    document.addEventListener("click", kick);
  }
})();
