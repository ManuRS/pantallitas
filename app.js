(() => {
  "use strict";

  const MAX = 8;
  const COUNTS = [4, 6, 8];
  const KEY = "tv-wall-v1";

  const byId = Object.fromEntries(CHANNELS.map((c) => [c.id, c]));
  const isPlayable = (c) => !!(c.url || c.channelId);

  // ---------- Estado (el audio no se guarda: siempre se arranca en silencio) ----------
  function load() {
    try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
  }
  const saved = load();
  const state = {
    count: COUNTS.includes(saved.count) ? saved.count : 6,
    slots: Array.from({ length: MAX }, (_, i) => {
      const id = saved.slots && saved.slots[i];
      return id && byId[id] && isPlayable(byId[id]) ? id : null;
    }),
    active: Number.isInteger(saved.active) && saved.active >= 0 && saved.active < MAX ? saved.active : 0,
    audio: null, // índice de la pantalla con sonido
  };
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ count: state.count, slots: state.slots, active: state.active }));
    } catch { /* sin almacenamiento: no pasa nada */ }
  }

  // ---------- DOM ----------
  const wall = document.getElementById("wall");
  const countEl = document.getElementById("count");
  const listEl = document.getElementById("channels");

  const screens = Array.from({ length: MAX }, (_, i) => createScreen(i));

  function createScreen(i) {
    const el = document.createElement("div");
    el.className = "screen is-empty";
    el.innerHTML = `
      <div class="media"></div>
      <div class="empty">Pantalla ${i + 1}<small>Elige una cadena</small></div>
      <div class="bar">
        <span class="num">${i + 1}</span>
        <span class="name"></span>
        <div class="actions">
          <button type="button" class="b-audio" title="Activar / silenciar sonido">🔇</button>
          <button type="button" class="b-full" title="Pantalla completa">⛶</button>
          <button type="button" class="b-clear" title="Quitar cadena">✕</button>
        </div>
      </div>
      <div class="err"><span>No se pudo reproducir esta cadena</span><button type="button">Reintentar</button></div>`;

    const s = {
      i, el,
      media: el.querySelector(".media"),
      nameEl: el.querySelector(".name"),
      audioBtn: el.querySelector(".b-audio"),
      node: null,   // <video> o <iframe>
      hls: null,
      retries: 0,
    };

    el.addEventListener("click", () => setActive(i));
    s.audioBtn.addEventListener("click", (e) => { e.stopPropagation(); toggleAudio(i); });
    el.querySelector(".b-full").addEventListener("click", (e) => {
      e.stopPropagation();
      if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
    });
    el.querySelector(".b-clear").addEventListener("click", (e) => { e.stopPropagation(); assign(i, null); });
    el.querySelector(".err button").addEventListener("click", (e) => { e.stopPropagation(); s.retries = 0; start(s); });

    // Arrastrar una cadena desde la lista
    el.addEventListener("dragover", (e) => { e.preventDefault(); el.classList.add("dragover"); });
    el.addEventListener("dragleave", () => el.classList.remove("dragover"));
    el.addEventListener("drop", (e) => {
      e.preventDefault();
      el.classList.remove("dragover");
      const id = e.dataTransfer.getData("text/plain");
      if (byId[id] && isPlayable(byId[id])) { assign(i, id); setActive(i); }
    });

    wall.appendChild(el);
    return s;
  }

  // ---------- Reproducción ----------
  function stop(s) {
    if (s.hls) { s.hls.destroy(); s.hls = null; }
    if (s.node) {
      if (s.node.tagName === "VIDEO") { s.node.pause(); s.node.removeAttribute("src"); s.node.load(); }
      s.node = null;
    }
    s.media.innerHTML = "";
    s.el.classList.remove("has-error");
  }

  function showError(s) { s.el.classList.add("has-error"); }

  function start(s) {
    stop(s);
    const ch = byId[state.slots[s.i]];
    s.el.classList.toggle("is-empty", !ch);
    s.nameEl.textContent = ch ? ch.name : "";
    if (!ch) { applyAudio(); return; }

    if (ch.type === "youtube") {
      const f = document.createElement("iframe");
      f.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
      f.allowFullscreen = true;
      f.src = "https://www.youtube.com/embed/live_stream?channel=" + encodeURIComponent(ch.channelId) +
        "&autoplay=1&mute=1&playsinline=1&enablejsapi=1&rel=0";
      f.addEventListener("load", applyAudio);
      s.media.appendChild(f);
      s.node = f;
    } else {
      const v = document.createElement("video");
      v.muted = true;
      v.autoplay = true;
      v.playsInline = true;
      v.controls = false;
      s.media.appendChild(v);
      s.node = v;

      if (window.Hls && Hls.isSupported()) {
        const hls = new Hls();
        s.hls = hls;
        hls.loadSource(ch.url);
        hls.attachMedia(v);
        hls.on(Hls.Events.MANIFEST_PARSED, () => { v.play().catch(() => {}); });
        hls.on(Hls.Events.ERROR, (_, data) => {
          if (!data.fatal) return;
          if (s.retries < 3) {
            s.retries++;
            if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
            else setTimeout(() => s.hls === hls && hls.startLoad(), 2000);
          } else {
            showError(s);
          }
        });
      } else if (v.canPlayType("application/vnd.apple.mpegurl")) {
        v.src = ch.url; // Safari / iOS: HLS nativo
        v.addEventListener("error", () => showError(s));
        v.play().catch(() => {});
      } else {
        showError(s);
      }
    }
    applyAudio();
  }

  // ---------- Audio (solo una pantalla con sonido a la vez) ----------
  function toggleAudio(i) {
    state.audio = state.audio === i ? null : i;
    applyAudio();
  }

  function applyAudio() {
    screens.forEach((s) => {
      const muted = state.audio !== s.i;
      s.audioBtn.textContent = muted ? "🔇" : "🔊";
      if (!s.node) return;
      if (s.node.tagName === "VIDEO") {
        s.node.muted = muted;
        if (!muted) s.node.play().catch(() => {});
      } else if (s.node.contentWindow) {
        s.node.contentWindow.postMessage(
          JSON.stringify({ event: "command", func: muted ? "mute" : "unMute", args: [] }), "*");
      }
    });
  }

  // ---------- Selección, asignación y rejilla ----------
  function setActive(i) {
    if (i < 0 || i >= state.count) return;
    state.active = i;
    screens.forEach((s) => s.el.classList.toggle("active", s.i === i));
    save();
  }

  function assign(i, id) {
    state.slots[i] = id;
    if (state.audio === i && !id) state.audio = null;
    screens[i].retries = 0;
    start(screens[i]);
    renderList();
    save();
  }

  function layout() {
    wall.style.setProperty("--cols", state.count / 2);
    screens.forEach((s) => {
      const visible = s.i < state.count;
      s.el.hidden = !visible;
      if (!visible) {
        stop(s);
        if (state.audio === s.i) state.audio = null;
      } else if (!s.node && state.slots[s.i]) {
        start(s);
      } else if (!state.slots[s.i]) {
        s.el.classList.add("is-empty");
      }
    });
    if (state.active >= state.count) state.active = state.count - 1;
    setActive(state.active);
    [...countEl.children].forEach((b) => b.classList.toggle("on", Number(b.dataset.count) === state.count));
    applyAudio();
    renderList();
    save();
  }

  // ---------- Lista de cadenas ----------
  function renderList() {
    listEl.innerHTML = "";
    CHANNELS.forEach((ch) => {
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.type = "button";
      const playable = isPlayable(ch);
      b.disabled = !playable;

      const label = document.createElement("span");
      label.className = "label";
      label.textContent = ch.name;
      b.appendChild(label);

      if (!playable) {
        const t = document.createElement("span");
        t.className = "tag";
        t.textContent = "pendiente";
        b.appendChild(t);
      } else {
        const badges = document.createElement("span");
        badges.className = "badges";
        for (let i = 0; i < state.count; i++) {
          if (state.slots[i] === ch.id) {
            const n = document.createElement("span");
            n.className = "badge";
            n.textContent = i + 1;
            badges.appendChild(n);
          }
        }
        b.appendChild(badges);
        b.draggable = true;
        b.addEventListener("dragstart", (e) => e.dataTransfer.setData("text/plain", ch.id));
        b.addEventListener("click", () => {
          assign(state.active, ch.id);
          setActive((state.active + 1) % state.count); // salta a la siguiente pantalla
        });
      }
      li.appendChild(b);
      listEl.appendChild(li);
    });
  }

  // ---------- Eventos globales ----------
  countEl.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-count]");
    if (!b) return;
    state.count = Number(b.dataset.count);
    layout();
  });

  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const n = Number(e.key);
    if (n >= 1 && n <= MAX) setActive(n - 1);
  });

  layout();
})();
