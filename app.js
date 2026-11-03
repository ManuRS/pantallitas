(() => {
  "use strict";

  const MAX = 8;
  const COUNTS = [4, 6, 8];
  const KEY = "tv-wall-v3";
  const OLD_KEYS = ["tv-wall-v2", "tv-wall-v1"]; // se aprovecha el estado de versiones anteriores
  const DEFAULT_ERR = "Esta cadena se ha puesto tonta y no arranca";
  const SWAP_MIME = "application/x-pantallitas-swap";
  const ATRES_ORIGIN = "https://www.atresplayer.com";
  const HINT_ATRES = "Pulsa «Directo» dentro del reproductor.";
  const HINT_NO_BRIDGE = HINT_ATRES + " Sin el puente de sonido, solo se mantiene en marcha la que tiene el foco.";
  const BRIDGE_WAIT_MS = 6000; // cuánto se espera al puente antes de darlo por no instalado
  let bridgeKnown = "unknown"; // "yes" si algún reproductor de Atresplayer ha avisado, "no" si ninguno lo hizo a tiempo
  let dragFrom = null; // índice de la pantallita que se está arrastrando

  const byId = Object.fromEntries(CHANNELS.map((c) => [c.id, c]));
  const isPlayable = (c) => !!(c.url || c.channelId || c.slug);
  const isAudioSlot = (i) => !!(byId[state.slots[i]] && byId[state.slots[i]].type === "audio"); // radio: sin imagen

  // ---------- Estado ----------
  function read(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
  }
  // Si solo hay estado antiguo se hereda, pero el modo foco arranca activado (ahora es el de por defecto)
  const saved = read(KEY) || (() => {
    const old = OLD_KEYS.map(read).find(Boolean);
    return old ? { ...old, focus: true } : {};
  })();
  const clamp01 = (v, d) => (typeof v === "number" && isFinite(v) ? Math.min(1, Math.max(0, v)) : d);

  const state = {
    count: COUNTS.includes(saved.count) ? saved.count : 6,
    slots: Array.from({ length: MAX }, (_, i) => {
      const id = saved.slots && saved.slots[i];
      return id && byId[id] && isPlayable(byId[id]) ? id : null;
    }),
    active: Number.isInteger(saved.active) && saved.active >= 0 && saved.active < MAX ? saved.active : 0,
    focus: saved.focus !== false,           // modo foco (activado por defecto)
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
  const fsBtn = document.getElementById("fsBtn");

  const screens = Array.from({ length: MAX }, (_, i) => createScreen(i));

  function createScreen(i) {
    const el = document.createElement("div");
    el.className = "screen is-empty";
    el.innerHTML = `
      <div class="media"></div>
      <div class="empty">Pantalla ${i + 1}<small>Vacía: échale una cadena</small></div>
      <div class="hint" aria-hidden="true"></div>
      <div class="paused">En pausa<small>Pulsa para reanudar (sin el puente de sonido, solo una a la vez)</small></div>
      <div class="radio" aria-hidden="true"><div class="eq"><i></i><i></i><i></i><i></i><i></i></div><span class="radio-name"></span></div>
      <div class="bar">
        <span class="num">${i + 1}</span>
        <span class="name"></span>
        <span class="aud" aria-hidden="true"></span>
        <div class="actions">
          <button type="button" class="b-full" title="Pantalla completa">⛶</button>
          <button type="button" class="b-clear" title="Quitar cadena">✕</button>
        </div>
      </div>
      <div class="err"><span class="err-msg">${DEFAULT_ERR}</span><a class="err-link" href="#" target="_blank" rel="noopener" hidden>Abrir en YouTube</a><button type="button">Reintentar</button></div>`;

    const s = {
      i, el,
      media: el.querySelector(".media"),
      nameEl: el.querySelector(".name"),
      hintEl: el.querySelector(".hint"),
      bridged: false, // ¿está el puente de sonido dentro del reproductor de Atresplayer?
      radioName: el.querySelector(".radio-name"),
      audEl: el.querySelector(".aud"),
      errMsg: el.querySelector(".err-msg"),
      errLink: el.querySelector(".err-link"),
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

    // Mover pantallitas: se agarra una con cadena y se suelta sobre otra (se intercambian)
    el.addEventListener("dragstart", (e) => {
      if (!state.slots[i]) { e.preventDefault(); return; }
      dragFrom = i;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData(SWAP_MIME, String(i));
      el.classList.add("dragging");
      app.classList.add("is-dragging"); // los iframes de YouTube no deben tragarse el "soltar"
    });
    el.addEventListener("dragend", () => {
      dragFrom = null;
      app.classList.remove("is-dragging");
      screens.forEach((x) => x.el.classList.remove("dragging", "dragover"));
    });

    // Soltar: otra pantallita (intercambio) o una cadena arrastrada desde la lista
    el.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = dragFrom !== null ? "move" : "copy";
      el.classList.add("dragover");
    });
    el.addEventListener("dragleave", () => el.classList.remove("dragover"));
    el.addEventListener("drop", (e) => {
      e.preventDefault();
      el.classList.remove("dragover");
      if (dragFrom !== null) {
        const from = dragFrom;
        dragFrom = null;
        if (from !== i) swap(from, i);
        return;
      }
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
      if (s.node.tagName === "VIDEO" || s.node.tagName === "AUDIO") { s.node.pause(); s.node.removeAttribute("src"); s.node.load(); }
      s.node = null;
    }
    s.media.innerHTML = "";
    s.bridged = false;
    s.el.classList.remove("has-error", "is-audio", "is-atres", "is-suspended");
  }

  const updateHint = (s) => { s.hintEl.textContent = s.bridged ? HINT_ATRES : HINT_NO_BRIDGE; };

  function showError(s, msg) {
    s.errMsg.textContent = msg || DEFAULT_ERR;
    s.el.classList.add("has-error");
  }

  // Errores que YouTube comunica desde dentro del iframe (hay que "escucharle" tras cargar)
  const YT_ERRORS = {
    100: "Este directo no está disponible ahora mismo (¿no está emitiendo?).",
    101: "El canal no deja incrustar su directo: es cosa suya, no de la web.",
    150: "El canal no deja incrustar su directo: es cosa suya, no de la web.",
    152: "El canal no deja incrustar su directo: es cosa suya, no de la web.",
    153: "YouTube no se fía de esta página (error 153). Suele pasar al abrirla como archivo local: ábrela por http(s).",
  };

  function ytListen(s) {
    if (s.node && s.node.contentWindow) {
      s.node.contentWindow.postMessage(JSON.stringify({ event: "listening", id: s.i, channel: "widget" }), "*");
    }
  }

  window.addEventListener("message", (e) => {
    if (e.origin === ATRES_ORIGIN) { // el puente de sonido avisa desde dentro del reproductor de Atresplayer
      const s = screens.find((x) => x.node && x.node.contentWindow === e.source);
      const d = e.data;
      if (s && d && typeof d === "object" && d.source === "pantallitas-bridge" && d.type === "ready") {
        s.bridged = true;
        bridgeKnown = "yes";
        updateHint(s);
        syncAtres(); // con puente no hace falta pausar nada: se reanuda lo que estuviera en pausa
        applyAudio();
      }
      return;
    }
    if (!/^https:\/\/(www\.)?youtube(-nocookie)?\.com$/.test(e.origin)) return;
    const s = screens.find((x) => x.node && x.node.contentWindow === e.source);
    if (!s) return;
    let d = e.data;
    if (typeof d === "string") { try { d = JSON.parse(d); } catch { return; } }
    if (d && d.event === "onError") showError(s, YT_ERRORS[d.info] || `YouTube devolvió el error ${d.info}.`);
  });

  function start(s) {
    stop(s);
    const ch = byId[state.slots[s.i]];
    s.el.classList.toggle("is-empty", !ch);
    s.el.draggable = !!ch; // solo se pueden mover las que tienen cadena
    s.nameEl.textContent = ch ? ch.name : "";
    s.radioName.textContent = ch ? ch.name : "";
    s.errMsg.textContent = DEFAULT_ERR;
    s.errLink.hidden = !(ch && ch.type === "youtube");
    if (ch && ch.type === "youtube") s.errLink.href = "https://www.youtube.com/channel/" + ch.channelId + "/live";
    if (!ch) { applyAudio(); return; }

    // Atresplayer sin puente: no se puede silenciar, así que solo corre la pantallita con foco
    if (ch.type === "atres" && bridgeKnown === "no" && s.i !== state.active) {
      s.el.classList.add("is-suspended");
      applyAudio();
      return;
    }

    if (ch.type === "youtube") {
      const f = document.createElement("iframe");
      f.title = ch.name;
      f.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen"; // 'allow' ya cubre el pantalla completa
      f.referrerPolicy = "strict-origin-when-cross-origin"; // YouTube necesita saber desde qué página se incrusta
      const origin = /^https?:$/.test(location.protocol) ? "&origin=" + encodeURIComponent(location.origin) : "";
      f.src = "https://www.youtube.com/embed/live_stream?channel=" + encodeURIComponent(ch.channelId) +
        "&autoplay=1&mute=1&playsinline=1&enablejsapi=1&rel=0" + origin;
      // el reproductor de YouTube tarda en estar listo: se reenvía el audio (y la escucha de errores) varias veces
      const sync = () => { if (s.node === f) { ytListen(s); applyAudio(); } };
      f.addEventListener("load", () => {
        sync();
        setTimeout(sync, 1500);
        setTimeout(sync, 4000);
      });
      s.media.appendChild(f);
      s.node = f;
    } else if (ch.type === "atres") {
      // Reproductor oficial de Atresplayer: trae sus propios términos, botón «Directo» y sonido,
      // que esta página no puede tocar (es de otro origen)
      const f = document.createElement("iframe");
      f.title = ch.name;
      f.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
      f.src = ATRES_ORIGIN + "/embed/live/" + encodeURIComponent(ch.slug) + "/";
      // el puente (si está instalado) tarda en arrancar: se le manda el sonido varias veces
      f.addEventListener("load", () => {
        const sync = () => { if (s.node === f) applyAudio(); };
        sync();
        setTimeout(sync, 1500);
        setTimeout(sync, 4000);
        setTimeout(() => { // ¿ha avisado el puente? Si no, se asume que no está instalado
          if (s.node === f && !s.bridged && bridgeKnown !== "yes") {
            bridgeKnown = "no";
            syncAtres();
          }
        }, BRIDGE_WAIT_MS);
      });
      s.media.appendChild(f);
      s.node = f;
      s.el.classList.add("is-atres");
      updateHint(s);
    } else if (ch.type === "audio") {
      // Solo audio: se ve un ecualizador de adorno
      const a = document.createElement("audio");
      a.muted = true;
      a.autoplay = true;
      a.preload = "none";
      a.addEventListener("error", () => { if (s.node === a) showError(s, "La radio no arranca (¿el stream ha cambiado?)."); });
      a.src = ch.url;
      s.media.appendChild(a);
      s.node = a;
      s.el.classList.add("is-audio");
      a.play().catch(() => {});
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
      const atres = s.el.classList.contains("is-atres");
      // Atresplayer: solo se sabe y se controla su sonido si el puente está dentro del reproductor
      s.audEl.textContent = focused && s.node && (!atres || s.bridged) ? (audible ? "🔊" : "🔇") : "";
      if (!s.node) return;

      if (atres) {
        if (s.node.contentWindow) {
          s.node.contentWindow.postMessage({ source: "pantallitas", type: "audio", muted: !audible, volume: vol }, ATRES_ORIGIN);
        }
        return;
      }

      if (s.node.tagName === "VIDEO" || s.node.tagName === "AUDIO") {
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
  // el puente de Atresplayer puede arrancar tarde o el reproductor recrear su <video>: se repite la orden
  setInterval(() => { if (screens.some((s) => s.el.classList.contains("is-atres"))) applyAudio(); }, 3000);

  // Primer gesto del usuario: a partir de ahí el navegador permite el sonido
  const markInteracted = () => {
    if (state.interacted) return;
    state.interacted = true;
    applyAudio();
  };
  ["pointerdown", "keydown"].forEach((ev) => document.addEventListener(ev, markInteracted, true));

  // ---------- Foco, asignación y rejilla ----------
  // Sin el puente, de las pantallitas de Atresplayer solo se mantiene en marcha la que tiene el foco;
  // las demás se pausan (se quita el iframe) y se reanudan al enfocarlas
  function syncAtres() {
    screens.forEach((s) => {
      const ch = byId[state.slots[s.i]];
      if (!ch || ch.type !== "atres" || s.i >= state.count) return;
      const suspended = s.el.classList.contains("is-suspended");
      if (suspended && (s.i === state.active || bridgeKnown === "yes")) start(s);
      else if (!suspended && bridgeKnown === "no" && s.i !== state.active) start(s); // start() la pausa
    });
  }

  function setActive(i) {
    if (i < 0 || i >= state.count) return;
    state.active = i;
    syncAtres();
    if (state.focus && !isAudioSlot(i)) promote(i); // una radio no se pone en grande: no tiene imagen
    screens.forEach((s) => s.el.classList.toggle("active", s.i === i));
    applyAudio();
    save();
  }

  function assign(i, id) {
    state.slots[i] = id;
    screens[i].retries = 0;
    start(screens[i]);
    placeFocus();
    renderList();
    save();
  }

  // Intercambia las cadenas de dos pantallitas. El foco se queda en su casilla
  // (como al elegir una cadena); los dos streams se recargan un instante.
  function swap(a, b) {
    [state.slots[a], state.slots[b]] = [state.slots[b], state.slots[a]];
    [a, b].forEach((k) => {
      screens[k].retries = 0;
      start(screens[k]);
    });
    placeFocus();
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

  // Una radio no debe ocupar la casilla grande: si le toca, cede el sitio a una pantallita con imagen
  function keepRadioOutOfBig() {
    const big = state.order[0];
    if (!isAudioSlot(big)) return;
    const p = state.order.findIndex((idx) => state.slots[idx] && !isAudioSlot(idx));
    if (p > 0) [state.order[0], state.order[p]] = [state.order[p], state.order[0]];
  }

  function placeFocus() {
    wall.classList.toggle("focus", state.focus);
    focusBtn.setAttribute("aria-pressed", String(state.focus));
    if (!state.focus) {
      screens.forEach((s) => s.el.style.removeProperty("--area"));
      return;
    }
    keepRadioOutOfBig();
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
        if (ch.note) {
          const t = document.createElement("span");
          t.className = "tag";
          t.textContent = ch.note;
          b.appendChild(t);
        }
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
        // La cadena va a la pantalla con foco, pasa a oírse y el foco se queda en ese hueco
        b.addEventListener("click", () => assign(state.active, ch.id));
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

  // Pantalla completa de toda la app (rejilla + menú), no de un stream suelto.
  // Así el menú se puede sacar y esconder también en pantalla completa.
  function toggleAppFullscreen() {
    if (document.fullscreenElement === app) document.exitFullscreen();
    else if (app.requestFullscreen) app.requestFullscreen().catch(() => {});
  }
  if (!app.requestFullscreen) fsBtn.hidden = true; // p. ej. iPhone
  fsBtn.addEventListener("click", toggleAppFullscreen);
  document.addEventListener("fullscreenchange", () => {
    fsBtn.setAttribute("aria-pressed", String(document.fullscreenElement === app));
  });

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
    else if (k === "p") toggleAppFullscreen();
    else if (k === "h") setMenuHidden(!state.menuHidden);
  });

  setMenuHidden(state.menuHidden);
  layout();
})();
