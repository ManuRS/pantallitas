(() => {
  "use strict";

  const MAX = 8;
  const COUNTS = [1, 4, 6, 8];
  const KEY = "tv-wall-v3";
  const OLD_KEYS = ["tv-wall-v2", "tv-wall-v1"]; // se aprovecha el estado de versiones anteriores
  const DEFAULT_ERR = "Esta cadena se ha puesto tonta y no arranca";
  const SWAP_MIME = "application/x-pantallitas-swap";
  const ATRES_ORIGIN = "https://www.atresplayer.com";
  const HINT_NO_BRIDGE = "Sin el puente de sonido, solo se mantiene en marcha la que tiene el foco."; // con puente no se avisa de nada
  const BRIDGE_WAIT_MS = 6000; // cuánto se espera al puente antes de darlo por no instalado
  let bridgeKnown = "unknown"; // "yes" si algún reproductor de Atresplayer ha avisado, "no" si ninguno lo hizo a tiempo
  let dragFrom = null; // índice de la pantallita que se está arrastrando

  // Listas de TDTChannels (ver CREDITOS.md): se bajan de su web y se guardan en el navegador;
  // si tienen más de 7 días se vuelven a bajar. Si su JSON no se deja leer desde aquí, se usa su catálogo
  // en Markdown de GitHub (mismo proyecto, mismos datos).
  const VIEWS = ["tv", "radio", "favs", "creator"];
  const REMOTE = "https://www.tdtchannels.com/lists/";
  const REMOTE_MD = {
    tv: "https://raw.githubusercontent.com/LaQuay/TDTChannels/master/TELEVISION.md",
    radio: "https://raw.githubusercontent.com/LaQuay/TDTChannels/master/RADIO.md",
  };
  const LIST_MAX_AGE = 7 * 24 * 3600 * 1000;
  const RETRY_AFTER = 6 * 3600 * 1000; // si la descarga falla, no se insiste hasta pasadas unas horas
  const LIST_KEY = (kind) => "tv-wall-list-" + kind;
  const FAVS_KEY = "tv-wall-favs";
  const HTTPS = location.protocol === "https:";

  // «Creator»: la lista personal (channels.js), con los enlaces a mano. Las de TDTChannels se añaden después.
  const byId = Object.fromEntries(CHANNELS.map((c) => [c.id, c]));
  const isPlayable = (c) => !!(c.url || c.channelId || c.videoId || c.slug);
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
    // ids de cadena; se validan cuando están cargadas las listas (sanitizeSlots)
    slots: Array.from({ length: MAX }, (_, i) => {
      const id = saved.slots && saved.slots[i];
      return typeof id === "string" ? id : null;
    }),
    view: VIEWS.includes(saved.view) ? saved.view : "creator", // qué lista se ve en el menú
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
        focus: state.focus, menuHidden: state.menuHidden, view: state.view,
        volume: state.volume, muted: state.muted,
      }));
    } catch { /* sin almacenamiento: no pasa nada */ }
  }

  // ---------- DOM ----------
  const app = document.getElementById("app");
  const wall = document.getElementById("wall");
  const countEl = document.getElementById("count");
  const listEl = document.getElementById("channels");
  const listSel = document.getElementById("listSel");
  const listFilter = document.getElementById("listFilter");
  const listInfo = document.getElementById("listInfo");
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
          <button type="button" class="b-touch" aria-pressed="false">🖱</button>
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
      touchBtn: el.querySelector(".b-touch"),
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
    s.touchBtn.addEventListener("click", (e) => { e.stopPropagation(); el.classList.toggle("no-touch"); syncTouch(s); });
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
    s.el.classList.remove("has-error", "is-audio", "is-atres", "is-suspended", "no-touch");
    syncTouch(s);
  }

  const updateHint = (s) => { s.hintEl.textContent = s.bridged ? "" : HINT_NO_BRIDGE; };

  // Los reproductores incrustados (Atresplayer) enseñan sus controles mientras les llega el ratón. Este botón hace
  // que el ratón no les llegue (se ocultan) o que vuelva a llegarles (aceptar términos, «Directo»...)
  function syncTouch(s) {
    const off = s.el.classList.contains("no-touch");
    s.touchBtn.setAttribute("aria-pressed", String(off));
    s.touchBtn.title = off
      ? "Controles del reproductor ocultos. Pulsa para volver a usarlos (aceptar términos, «Directo»…)"
      : "Ocultar los controles del reproductor";
  }

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
    // Si falla, se ofrece abrirla donde sí funciona: YouTube o la web de la cadena
    const link = !ch ? null : ch.type === "youtube"
      ? (ch.videoId ? "https://www.youtube.com/watch?v=" + ch.videoId : "https://www.youtube.com/channel/" + ch.channelId + "/live")
      : ch.web || null;
    s.errLink.hidden = !link;
    if (link) {
      s.errLink.href = link;
      s.errLink.textContent = ch.type === "youtube" ? "Abrir en YouTube" : "Abrir su web";
    }
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
      f.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen"; // 'allow' ya cubre el pantalla completo
      f.referrerPolicy = "strict-origin-when-cross-origin"; // YouTube necesita saber desde qué página se incrusta
      const origin = /^https?:$/.test(location.protocol) ? "&origin=" + encodeURIComponent(location.origin) : "";
      const base = ch.videoId
        ? "https://www.youtube.com/embed/" + encodeURIComponent(ch.videoId) + "?"
        : "https://www.youtube.com/embed/live_stream?channel=" + encodeURIComponent(ch.channelId) + "&";
      f.src = base + "autoplay=1&mute=1&playsinline=1&enablejsapi=1&rel=0" + origin;
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
      s.media.appendChild(a);
      s.node = a;
      s.el.classList.add("is-audio");
      if (/\.m3u8(\?|#|$)/i.test(ch.url) && window.Hls && Hls.isSupported()) {
        // radio en HLS (muchas de TDTChannels): hls.js sobre el <audio>
        const hls = new Hls();
        s.hls = hls;
        hls.loadSource(ch.url);
        hls.attachMedia(a);
        hls.on(Hls.Events.MANIFEST_PARSED, () => { a.play().catch(() => {}); });
        hls.on(Hls.Events.ERROR, (_, data) => {
          if (!data.fatal) return;
          if (s.retries < 3) {
            s.retries++;
            if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
            else setTimeout(() => s.hls === hls && hls.startLoad(), 2000);
          } else {
            showError(s, "La radio no arranca (¿el stream ha cambiado?).");
          }
        });
      } else {
        a.src = ch.url;
      }
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
    renderBadges();
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
    renderBadges();
    save();
  }

  function layout() {
    wall.style.setProperty("--cols", Math.ceil(state.count / 2));
    wall.style.setProperty("--rows", state.count === 1 ? 1 : 2);
    wall.classList.toggle("single", state.count === 1);
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
    renderBadges();
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
    const on = state.focus && state.count > 1; // con una sola pantallita no hay nada que enfocar
    wall.classList.toggle("focus", on);
    focusBtn.setAttribute("aria-pressed", String(state.focus));
    if (!on) {
      screens.forEach((s) => {
        s.el.style.removeProperty("--area");
        s.el.style.removeProperty("--ord");
        s.el.classList.remove("is-big");
      });
      return;
    }
    keepRadioOutOfBig();
    const g = focusGeometry(state.count);
    wall.style.setProperty("--f-cols", g.cols);
    wall.style.setProperty("--f-rows", g.rows);
    state.order.forEach((idx, k) => {
      const el = screens[idx].el;
      el.style.setProperty("--area", g.areas[k]); // escritorio: sitio en la rejilla
      el.style.setProperty("--ord", k);           // móvil: orden (la grande va primero)
      el.classList.toggle("is-big", k === 0);
    });
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

  // ---------- Listas de cadenas ----------
  // Creator: channels.js, a mano. Tele y Radio: TDTChannels (se bajan y se refrescan a los 7 días).
  // Favs: las que se marcan con la estrella en Tele o Radio.
  const catalogs = { tv: null, radio: null }; // { v, h, t, channels, hidden, tryAt, loading }
  const openAmbits = new Set();               // ámbitos desplegados (clave: lista|ámbito)
  const VIEW_NAME = { tv: "Tele", radio: "Radio" };
  let favs = (() => {
    const a = read(FAVS_KEY);
    return Array.isArray(a) ? a.filter((x) => typeof x === "string") : [];
  })();
  let filterText = "";

  const fold = (t) => String(t).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const register = (list) => list.forEach((ch) => { byId[ch.id] = ch; });

  function saveFavs() {
    try { localStorage.setItem(FAVS_KEY, JSON.stringify(favs)); } catch { /* sin almacenamiento */ }
  }
  function toggleFav(id) {
    const i = favs.indexOf(id);
    if (i >= 0) favs.splice(i, 1); else favs.push(id);
    saveFavs();
    return i < 0;
  }

  function readCache(kind) {
    const o = read(LIST_KEY(kind));
    return o && o.v === 1 && o.h === HTTPS && Array.isArray(o.channels) ? o : null;
  }
  function writeCache(kind, c) {
    try { localStorage.setItem(LIST_KEY(kind), JSON.stringify(c)); } catch { /* sin almacenamiento */ }
  }
  function makeCache(kind, raw) {
    const r = Catalog.normalize(raw, kind, { https: HTTPS });
    return { v: 1, h: HTTPS, t: Date.now(), channels: r.channels, hidden: r.hidden };
  }

  // La lista guardada en el navegador (vacía la primera vez; se baja justo después de arrancar)
  function loadCatalog(kind) {
    const c = readCache(kind) || { v: 1, h: HTTPS, t: 0, channels: [], hidden: 0 };
    catalogs[kind] = c;
    register(c.channels);
  }

  async function get(url, as) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    try {
      const res = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
      if (!res.ok) throw new Error(res.status);
      return await (as === "json" ? res.json() : res.text());
    } finally {
      clearTimeout(timer);
    }
  }

  // El JSON de tdtchannels.com y, si no se puede, el catálogo Markdown de su GitHub
  async function download(kind) {
    const attempts = [
      async () => get(REMOTE + kind + ".json", "json"),
      async () => Catalog.parseMarkdown(await get(REMOTE_MD[kind], "text")),
    ];
    for (const attempt of attempts) {
      try {
        const c = makeCache(kind, await attempt());
        if (c.channels.length >= 20) return c; // menos: algo va mal con esa fuente
      } catch { /* se prueba la siguiente */ }
    }
    throw new Error("no se pudo bajar la lista");
  }

  // Baja la lista si no hay ninguna o si tiene más de 7 días
  async function refreshCatalog(kind) {
    const c = catalogs[kind];
    const now = Date.now();
    if (c.channels.length) {
      if (now - c.t < LIST_MAX_AGE) return;
      if (c.tryAt && now - c.tryAt < RETRY_AFTER) return; // ya falló hace poco
    }
    c.loading = true;
    renderList(true);
    try {
      const nc = await download(kind);
      catalogs[kind] = nc;
      register(nc.channels); // las antiguas se quedan registradas por si están en una pantallita
      writeCache(kind, nc);
    } catch {
      c.loading = false;
      c.tryAt = now;
      if (c.channels.length) writeCache(kind, c);
    }
    renderList(true);
  }

  // Tras cargar las listas se descartan las cadenas guardadas que ya no existen
  function sanitizeSlots() {
    state.slots = state.slots.map((id) => (id && byId[id] && isPlayable(byId[id]) ? id : null));
  }

  function viewChannels() {
    if (state.view === "creator") return CHANNELS;
    if (state.view === "favs") return favs.map((id) => byId[id]).filter((c) => c && isPlayable(c));
    return catalogs[state.view] ? catalogs[state.view].channels : [];
  }

  function ageText(c) {
    if (!c || !c.t) return "";
    const days = Math.floor((Date.now() - c.t) / 86400000);
    const when = days <= 0 ? "de hoy" : days === 1 ? "de ayer" : `de hace ${days} días`;
    return "lista " + when;
  }

  function setStar(btn, on) {
    btn.textContent = on ? "★" : "☆";
    btn.setAttribute("aria-pressed", String(on));
    btn.title = on ? "Quitar de favoritos" : "Añadir a favoritos";
  }

  function makeRow(ch, stars) {
    const row = document.createElement("div");
    row.className = "row";
    row.dataset.id = ch.id;
    const b = document.createElement("button");
    b.type = "button";
    b.className = "ch";
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
      const note = ch.note || (state.view === "favs" ? VIEW_NAME[ch.kind] : "");
      if (note) {
        const t = document.createElement("span");
        t.className = "tag";
        t.textContent = note;
        b.appendChild(t);
      }
      const badges = document.createElement("span");
      badges.className = "badges";
      b.appendChild(badges);
      b.draggable = true;
      b.addEventListener("dragstart", (e) => e.dataTransfer.setData("text/plain", ch.id));
      // La cadena va a la pantalla con foco, pasa a oírse y el foco se queda en ese hueco
      b.addEventListener("click", () => assign(state.active, ch.id));
    }
    row.appendChild(b);

    if (stars && playable) {
      const star = document.createElement("button");
      star.type = "button";
      star.className = "star";
      setStar(star, favs.includes(ch.id));
      star.addEventListener("click", () => {
        const on = toggleFav(ch.id);
        if (state.view === "favs") renderList(true); else setStar(star, on);
      });
      row.appendChild(star);
    }
    return row;
  }

  // keepScroll: al marcar una estrella o actualizar la lista no se pierde el sitio por el que ibas
  function renderList(keepScroll) {
    const top = listEl.scrollTop;
    const view = state.view;
    const stars = view !== "creator";
    const q = fold(filterText.trim());
    const all = viewChannels();
    const list = q ? all.filter((c) => fold(c.name + " " + (c.ambit || "")).includes(q)) : all;

    listEl.innerHTML = "";
    listFilter.hidden = view === "creator";

    const cat = catalogs[view];
    let info = "";
    if (view === "tv" || view === "radio") {
      if (!all.length) info = cat && cat.loading ? "Descargando la lista…" : "No se ha podido cargar la lista.";
      else {
        info = `${all.length} canales · ${ageText(cat)}`;
        if (cat.hidden) info += ` · ${cat.hidden} sin emisión compatible, ocultos`;
        if (cat.tryAt && Date.now() - cat.tryAt < RETRY_AFTER) info += " · no se pudo actualizar";
      }
    } else if (view === "favs" && !all.length) {
      info = "Marca la estrella ☆ de una cadena en Tele o Radio y saldrá aquí.";
    }
    if (q && !list.length) info = `Nada que coincida con «${filterText.trim()}».`;
    listInfo.textContent = info;
    listInfo.hidden = !info;

    if (view === "tv" || view === "radio") {
      // Agrupadas por ámbito (Nacionales, Andalucía...), plegadas salvo al buscar
      const groups = new Map();
      list.forEach((ch) => {
        const k = ch.ambit || "Otras";
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(ch);
      });
      groups.forEach((chs, name) => {
        const key = view + "|" + name;
        const d = document.createElement("details");
        d.open = !!q || openAmbits.has(key);
        const sum = document.createElement("summary");
        sum.textContent = `${name} (${chs.length})`;
        d.appendChild(sum);
        d.addEventListener("toggle", () => {
          if (q) return;
          if (d.open) openAmbits.add(key); else openAmbits.delete(key);
        });
        chs.forEach((ch) => d.appendChild(makeRow(ch, stars)));
        listEl.appendChild(d);
      });
    } else {
      list.forEach((ch) => listEl.appendChild(makeRow(ch, stars)));
    }
    renderBadges();
    if (keepScroll) listEl.scrollTop = top;
  }

  // Los números de pantallita junto a cada cadena (se actualizan sin recomponer toda la lista)
  function renderBadges() {
    listEl.querySelectorAll(".row").forEach((row) => {
      const badges = row.querySelector(".badges");
      if (!badges) return;
      badges.innerHTML = "";
      for (let i = 0; i < state.count; i++) {
        if (state.slots[i] === row.dataset.id) {
          const n = document.createElement("span");
          n.className = "badge";
          n.textContent = i + 1;
          badges.appendChild(n);
        }
      }
    });
  }

  function setView(v) {
    state.view = v;
    listSel.value = v;
    filterText = "";        // cada lista empieza sin búsqueda
    listFilter.value = "";
    renderList();
    save();
  }

  // ---------- Eventos globales ----------
  countEl.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-count]");
    if (!b) return;
    state.count = Number(b.dataset.count);
    layout();
  });

  listSel.addEventListener("change", () => setView(listSel.value));
  listFilter.addEventListener("input", () => { filterText = listFilter.value; renderList(); });

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
    if (t && (t.tagName === "TEXTAREA" || t.tagName === "SELECT" || (t.tagName === "INPUT" && t.type !== "range"))) return;
    const k = e.key.toLowerCase();
    const n = Number(k);
    if (n >= 1 && n <= MAX) setActive(n - 1);
    else if (k === "m") toggleMute();
    else if (k === "f") setFocusMode(!state.focus);
    else if (k === "p") toggleAppFullscreen();
    else if (k === "h") setMenuHidden(!state.menuHidden);
  });

  // Arranque: se leen las listas guardadas, se monta la rejilla y, si hace falta, se bajan las nuevas por detrás
  setMenuHidden(state.menuHidden);
  listSel.value = state.view;
  Object.keys(catalogs).forEach(loadCatalog);
  sanitizeSlots();
  renderList();
  layout();
  Object.keys(catalogs).forEach(refreshCatalog);
})();
