(() => {
  "use strict";

  const MAX = 8;
  const COUNTS = [4, 6, 8];
  const KEY = "tv-wall-v2";
  const OLD_KEY = "tv-wall-v1"; // se aprovecha el estado de la v1 si existe

  const byId = Object.fromEntries(CHANNELS.map((c) => [c.id, c]));
  const isPlayable = (c) => !!(c.url || c.channelId);

  // ---------- Estado ----------
  function read(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
  }
  const saved = read(KEY) || read(OLD_KEY) || {};
  const clamp01 = (v, d) => (typeof v === "number" && isFinite(v) ? Math.min(1, Math.max(0, v)) : d);

  const state = {
    count: COUNTS.includes(saved.count) ? saved.count : 6,
    slots: Array.from({ length: MAX }, (_, i) => {
      const id = saved.slots && saved.slots[i];
      return id && byId[id] && isPlayable(byId[id]) ? id : null;
    }),
    active: Number.isInteger(saved.active) && saved.active >= 0 && saved.active < MAX ? saved.active : 0,
    focus: saved.focus === true,            // modo foco
    menuHidden: saved.menuHidden === true,  // menú lateral oculto
    volume: clamp01(saved.volume, 0.8),
    muted: saved.muted === true,
    order: [],          // modo foco: order[0] es la pantalla grande
    interacted: false,  // el navegador no deja sonar hasta el primer gesto
  };

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({
        count: state.count, slots: state.slots, active: state.active,
        focus: state.focus, menuHidden: state.menuHidden,
        volume: state.volume, muted: state.muted,
      }));
    } catch { /* sin almacenamiento: no pasa nada */ }
  }

  // ---------- DOM ----------
  const app = document.getElementById("app");
  const wall = document.getElementById("wall");
  const countEl = document.getElementById("count");
  const listEl = document.getElementById("channels");
  const focusBtn = document.getElementById("focusBtn");
  const volRange = document.getElementById("volume");
  const volOut = document.getElementById("volOut");
  const muteBtn = document.getElementById("muteBtn");
  const hideBtn = document.getElementById("hideMenu");
  const showBtn = document.getElementById("showMenu");
  const infoBtn = document.getElementById("infoBtn");
  const infoDlg = document.getElementById("info");

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
        <span class="aud" aria-hidden="true"></span>
        <div class="actions">
          <button type="button" class="b-full" title="Pantalla completa">⛶</button>
          <button type="button" class="b-clear" title="Quitar cadena">✕</button>
        </div>
      </div>
      <div class="err"><span>No se pudo reproducir esta cadena</span><button type="button">Reintentar</button></div>`;

    const s = {
      i, el,
      media: el.querySelector(".media"),
      nameEl: el.querySelector(".name"),
      audEl: el.querySelector(".aud"),
      node: null,   // <video> o <iframe>
      hls: null,
      retries: 0,
    };

    el.addEventListener("click", () => setActive(i));
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
      // el reproductor de YouTube tarda en estar listo: se reenvía el audio un par de veces
      f.addEventListener("load", () => {
        applyAudio();
        setTimeout(applyAudio, 1500);
        setTimeout(applyAudio, 4000);
      });
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

  // ---------- Audio: solo suena la pantalla con foco ----------
  function applyAudio() {
    const vol = state.volume;
    screens.forEach((s) => {
      const focused = s.i === state.active && s.i < state.count;
      const audible = focused && state.interacted && !state.muted && vol > 0;
      s.audEl.textContent = focused && s.node ? (audible ? "🔊" : "🔇") : "";
      if (!s.node) return;

      if (s.node.tagName === "VIDEO") {
        s.node.volume = vol;
        s.node.muted = !audible;
        if (audible) s.node.play().catch(() => {});
      } else if (s.node.contentWindow) {
        const send = (func, args) => s.node.contentWindow.postMessage(
          JSON.stringify({ event: "command", func, args }), "*");
        send("setVolume", [Math.round(vol * 100)]);
        send(audible ? "unMute" : "mute", []);
      }
    });

    // Controles del menú
    volRange.value = Math.round(vol * 100);
    volOut.textContent = Math.round(vol * 100);
    const off = state.muted || vol === 0;
    muteBtn.textContent = off ? "🔇" : "🔊";
    muteBtn.setAttribute("aria-pressed", String(off));
  }

  function toggleMute() {
    state.muted = !state.muted;
    if (!state.muted && state.volume === 0) state.volume = 0.5;
    applyAudio();
    save();
  }

  volRange.addEventListener("input", () => {
    state.volume = Number(volRange.value) / 100;
    if (state.volume > 0) state.muted = false;
    applyAudio();
    save();
  });
  muteBtn.addEventListener("click", toggleMute);

  // Primer gesto del usuario: a partir de ahí el navegador permite el sonido
  const markInteracted = () => {
    if (state.interacted) return;
    state.interacted = true;
    applyAudio();
  };
  ["pointerdown", "keydown"].forEach((ev) => document.addEventListener(ev, markInteracted, true));

  // ---------- Foco, asignación y rejilla ----------
  function setActive(i) {
    if (i < 0 || i >= state.count) return;
    state.active = i;
    if (state.focus) promote(i);
    screens.forEach((s) => s.el.classList.toggle("active", s.i === i));
    applyAudio();
    save();
  }

  function assign(i, id) {
    state.slots[i] = id;
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
      } else if (!s.node && state.slots[s.i]) {
        start(s);
      } else if (!state.slots[s.i]) {
        s.el.classList.add("is-empty");
      }
    });
    if (state.active >= state.count) state.active = state.count - 1;
    resetOrder();
    placeFocus();
    setActive(state.active);
    [...countEl.children].forEach((b) => b.classList.toggle("on", Number(b.dataset.count) === state.count));
    renderList();
    save();
  }

  // ---------- Modo foco ----------
  // Una pantalla grande (arriba a la izquierda), una columna a la derecha y una fila
  // abajo con el resto. 6 pantallas = rejilla de 3×3 con la grande ocupando 2×2.
  function focusGeometry(n) {
    const others = n - 1;
    const R = n <= 4 ? 0 : Math.floor(others / 2); // miniaturas en la columna derecha
    const B = others - R;                          // miniaturas en la fila de abajo
    const bigRows = Math.max(R, 1);
    const rows = bigRows + 1;
    const bigCols = R > 0 ? B - 1 : B;
    const areas = [`1 / 1 / ${bigRows + 1} / ${bigCols + 1}`];            // la grande
    for (let r = 1; r <= R; r++) areas.push(`${r} / ${B} / ${r + 1} / ${B + 1}`);        // derecha
    for (let c = 1; c <= B; c++) areas.push(`${rows} / ${c} / ${rows + 1} / ${c + 1}`);  // abajo
    return {
      cols: `repeat(${B}, minmax(0, 1fr))`,
      rows: R === 0 ? "minmax(0, 2fr) minmax(0, 1fr)" : `repeat(${rows}, minmax(0, 1fr))`,
      areas,
    };
  }

  function resetOrder() {
    state.order = Array.from({ length: state.count }, (_, k) => k);
    const p = state.order.indexOf(state.active);
    if (p > 0) [state.order[0], state.order[p]] = [state.order[p], state.order[0]];
  }

  // La pantalla enfocada pasa a ser la grande y la grande ocupa su hueco
  function promote(i) {
    const p = state.order.indexOf(i);
    if (p > 0) [state.order[0], state.order[p]] = [state.order[p], state.order[0]];
    placeFocus();
  }

  function placeFocus() {
    wall.classList.toggle("focus", state.focus);
    focusBtn.setAttribute("aria-pressed", String(state.focus));
    if (!state.focus) {
      screens.forEach((s) => s.el.style.removeProperty("--area"));
      return;
    }
    const g = focusGeometry(state.count);
    wall.style.setProperty("--f-cols", g.cols);
    wall.style.setProperty("--f-rows", g.rows);
    state.order.forEach((idx, k) => screens[idx].el.style.setProperty("--area", g.areas[k]));
  }

  function setFocusMode(on) {
    state.focus = on;
    resetOrder();
    placeFocus();
    save();
  }

  // ---------- Menú lateral ----------
  function setMenuHidden(hidden) {
    state.menuHidden = hidden;
    app.classList.toggle("menu-hidden", hidden);
    showBtn.hidden = !hidden;
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
          // En la rejilla el foco salta a la siguiente pantalla; en modo foco se queda en la grande
          if (!state.focus) setActive((state.active + 1) % state.count);
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

  focusBtn.addEventListener("click", () => setFocusMode(!state.focus));
  hideBtn.addEventListener("click", () => setMenuHidden(true));
  showBtn.addEventListener("click", () => setMenuHidden(false));

  infoBtn.addEventListener("click", () => infoDlg.showModal());
  infoDlg.addEventListener("click", (e) => { if (e.target === infoDlg) infoDlg.close(); }); // clic en el fondo

  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || infoDlg.open) return;
    const t = e.target;
    if (t && (t.tagName === "TEXTAREA" || (t.tagName === "INPUT" && t.type !== "range"))) return;
    const k = e.key.toLowerCase();
    const n = Number(k);
    if (n >= 1 && n <= MAX) setActive(n - 1);
    else if (k === "m") toggleMute();
    else if (k === "f") setFocusMode(!state.focus);
    else if (k === "h") setMenuHidden(!state.menuHidden);
  });

  setMenuHidden(state.menuHidden);
  layout();
})();
