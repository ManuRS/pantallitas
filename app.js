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
  const KNOWN_KEY = "tv-wall-known"; // copia de las cadenas de Tele/Radio en uso (pantallitas, orden guardado y favoritas)
  const HTTPS = location.protocol === "https:";

  // «Creator»: la lista personal (channels.js), con los enlaces a mano. Las de TDTChannels se añaden después.
  const byId = Object.assign(Object.create(null), Object.fromEntries(CHANNELS.map((c) => [c.id, c]))); // sin prototipo: ningún id raro cuela
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

  // «Guardar orden»: una foto fija de las cadenas, su orden y el foco que se recupera siempre al abrir la página.
  // Sin ella se recupera lo último que había al cerrar.
  function cleanPin(p) {
    if (!p || typeof p !== "object" || !COUNTS.includes(p.count) || !Array.isArray(p.slots)) return null;
    return {
      count: p.count,
      slots: Array.from({ length: MAX }, (_, i) => (typeof p.slots[i] === "string" ? p.slots[i] : null)),
      active: Number.isInteger(p.active) && p.active >= 0 && p.active < MAX ? p.active : 0,
      focus: p.focus !== false,
    };
  }
  // La primera vez (sin nada guardado): 4 pantallitas, sin modo foco, con cuatro cadenas de Creator
  const FIRST_RUN = { count: 4, focus: false, active: 0, slots: ["24h", "sky-news", "cnn", "la-septima"] };
  const first = Object.keys(saved).length === 0;
  const pin = cleanPin(saved.pinned);
  const base = pin ? { ...saved, ...pin } : first ? FIRST_RUN : saved; // con el orden guardado, mandan sus valores

  const state = {
    count: COUNTS.includes(base.count) ? base.count : 6,
    // ids de cadena; se validan cuando están cargadas las listas (sanitizeSlots)
    slots: Array.from({ length: MAX }, (_, i) => {
      const id = base.slots && base.slots[i];
      return typeof id === "string" ? id : null;
    }),
    view: VIEWS.includes(saved.view) ? saved.view : "creator", // qué lista se ve en el menú
    active: Number.isInteger(base.active) && base.active >= 0 && base.active < MAX ? base.active : 0,
    focus: base.focus !== false,            // modo foco (activado por defecto)
    menuHidden: saved.menuHidden === true,  // menú lateral oculto
    volume: clamp01(saved.volume, 0.8),
    muted: saved.muted === true,
    pinned: pin,        // orden guardado (o null)
    interacted: false,  // el navegador no deja sonar hasta el primer gesto
  };

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({
        count: state.count, slots: state.slots, active: state.active,
        focus: state.focus, menuHidden: state.menuHidden, view: state.view,
        volume: state.volume, muted: state.muted, pinned: state.pinned,
      }));
    } catch { /* sin almacenamiento: no pasa nada */ }
    saveKnown();
  }
  // Al mover el volumen se guarda una vez al soltar, no en cada paso
  let saveTimer = 0;
  function saveSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 300);
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
  const pipBtn = document.getElementById("pipBtn");
  const pinBtn = document.getElementById("pinBtn");

  // ventana flotante de documento (Chrome/Edge de escritorio): ahí sí cabe el iframe de YouTube
  const DOC_PIP = "documentPictureInPicture" in window && window.isSecureContext;

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
          <button type="button" class="b-pip" aria-pressed="false" title="Imagen en imagen" aria-label="Imagen en imagen">⧉</button>
          <button type="button" class="b-touch" aria-pressed="false" aria-label="Ocultar los controles del reproductor">🖱</button>
          <button type="button" class="b-full" title="Pantalla completa" aria-label="Pantalla completa">⛶</button>
          <button type="button" class="b-clear" title="Quitar cadena" aria-label="Quitar cadena">✕</button>
        </div>
      </div>
      <div class="err"><span class="err-msg">${DEFAULT_ERR}</span><a class="err-link" href="#" target="_blank" rel="noopener" hidden>Abrir en YouTube</a><button type="button">Reintentar</button></div>`;

    const s = {
      i, el,
      media: el.querySelector(".media"),
      numEl: el.querySelector(".num"),
      emptyEl: el.querySelector(".empty"),
      nameEl: el.querySelector(".name"),
      hintEl: el.querySelector(".hint"),
      bridged: false, // ¿está el puente de sonido dentro del reproductor de Atresplayer?
      radioName: el.querySelector(".radio-name"),
      audEl: el.querySelector(".aud"),
      errMsg: el.querySelector(".err-msg"),
      errLink: el.querySelector(".err-link"),
      touchBtn: el.querySelector(".b-touch"),
      pipBtn: el.querySelector(".b-pip"),
      node: null,   // <video> o <iframe>
      hls: null,
      retries: 0,
      lastErr: 0,     // cuándo fue el último error grave del stream
      parked: false,  // carga parada mientras la pestaña está oculta
      ytReady: false, // ¿ha contestado ya el reproductor de YouTube?
      ytTimer: 0,
    };

    el.style.setProperty("--pos", i); // el sitio en la rejilla se da con CSS (order), no con el orden en el DOM
    // OJO: s.i puede cambiar (swap intercambia pantallitas sin recargarlas), por eso aquí no se usa i
    el.addEventListener("click", () => setActive(s.i));
    el.querySelector(".b-full").addEventListener("click", (e) => {
      e.stopPropagation();
      if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
    });
    el.querySelector(".b-clear").addEventListener("click", (e) => { e.stopPropagation(); assign(s.i, null); });
    s.touchBtn.addEventListener("click", (e) => { e.stopPropagation(); el.classList.toggle("no-touch"); syncTouch(s); });
    if (document.pictureInPictureEnabled || DOC_PIP) {
      s.pipBtn.addEventListener("click", (e) => { e.stopPropagation(); togglePip(s); });
    } else {
      s.pipBtn.remove(); // el navegador no tiene imagen en imagen (p. ej. Firefox móvil)
      s.pipBtn = null;
    }
    el.querySelector(".err button").addEventListener("click", (e) => { e.stopPropagation(); s.retries = 0; start(s); });
    s.errLink.addEventListener("click", (e) => e.stopPropagation()); // abrir el enlace no es elegir la pantallita

    // Mover pantallitas: se agarra una con cadena y se suelta sobre otra (se intercambian)
    el.addEventListener("dragstart", (e) => {
      if (!state.slots[s.i]) { e.preventDefault(); return; }
      dragFrom = s.i;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData(SWAP_MIME, String(s.i));
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
        if (from !== s.i) swap(from, s.i);
        return;
      }
      const id = e.dataTransfer.getData("text/plain");
      if (byId[id] && isPlayable(byId[id])) {
        const at = assign(s.i, id);
        setActive(at);
      }
    });

    wall.appendChild(el);
    return s;
  }

  // ---------- Reproducción ----------
  // Imagen en imagen. Las cadenas de vídeo (HLS) usan la normal. YouTube va en un iframe de otro dominio, que no
  // se puede sacar así: en Chrome/Edge de escritorio se mete el iframe en una ventana flotante de documento
  // (Document Picture-in-Picture). Al entrar y al salir el reproductor se recarga (es un directo: no se pierde nada).
  // Atresplayer no: su puente de sonido no se fía de la ventana flotante.
  let docPip = null; // { win, s, f } mientras YouTube está en la ventana flotante

  const isVideoPip = (s) => !!(s && s.node && s.node.tagName === "VIDEO" && s.node.readyState > 0 && document.pictureInPictureEnabled);
  const isYtPip = (s) => !!(DOC_PIP && s && s.node && s.el.classList.contains("is-yt"));
  const canPip = (s) => s.i < state.count && (isVideoPip(s) || isYtPip(s));
  const inPip = (s) => !!(s && s.node && (document.pictureInPictureElement === s.node || (docPip && docPip.s === s)));

  function closePip() {
    if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {});
    if (docPip) docPip.win.close();
  }

  async function openPip(s) {
    if (isVideoPip(s)) {
      if (docPip) docPip.win.close();
      return s.node.requestPictureInPicture();
    }
    if (!isYtPip(s)) return undefined;
    if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {});
    if (docPip) docPip.win.close();
    const f = s.node;
    const win = await window.documentPictureInPicture.requestWindow({ width: 640, height: 360 });
    if (s.node !== f) { win.close(); return undefined; } // mientras se abría, la pantallita cambió de cadena
    win.document.title = s.nameEl.textContent || "Pantallitas";
    const css = win.document.createElement("style");
    css.textContent = "html,body{margin:0;height:100%;background:#000;overflow:hidden}iframe{display:block;width:100%;height:100%;border:0}";
    win.document.head.appendChild(css);
    // La ventana es un documento en blanco: si YouTube se cargara directamente ahí no sabría desde qué página va
    // (error 153). Se mete dentro de pip.html, una página vacía de esta web, que sí se lo dice.
    const holder = win.document.createElement("iframe");
    holder.src = new URL("pip.html", location.href).href;
    holder.title = s.nameEl.textContent || "Pantallitas";
    holder.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
    docPip = { win, s, f };
    s.el.classList.add("in-pip");
    syncPipState();
    holder.addEventListener("load", () => {
      if (!docPip || docPip.win !== win || s.node !== f) return;
      const hw = holder.contentWindow;
      hw.addEventListener("message", onFrameMessage); // YouTube avisa a la página en la que está
      hw.document.body.appendChild(f);
    }, { once: true });
    win.document.body.appendChild(holder);
    win.addEventListener("pagehide", () => {
      if (!docPip || docPip.win !== win) return;
      docPip = null;
      s.el.classList.remove("in-pip");
      if (s.node === f) s.media.appendChild(f); // vuelve a su pantallita
      syncPipState();
    });
    return win;
  }

  function togglePip(s) {
    if (inPip(s)) closePip();
    else openPip(s).catch(() => {});
  }

  function stop(s) {
    if (s.node && document.pictureInPictureElement === s.node) document.exitPictureInPicture().catch(() => {});
    if (docPip && docPip.s === s) docPip.win.close();
    if (s.hls) { s.hls.destroy(); s.hls = null; }
    clearInterval(s.ytTimer);
    s.ytReady = false;
    s.parked = false;
    if (s.node) {
      if (s.node.tagName === "VIDEO" || s.node.tagName === "AUDIO") { s.node.pause(); s.node.removeAttribute("src"); s.node.load(); }
      s.node = null;
    }
    s.media.innerHTML = "";
    s.bridged = false;
    s.el.classList.remove("has-error", "is-audio", "is-atres", "is-suspended", "no-touch", "is-video", "is-yt", "in-pip");
    if (s.pipBtn) s.pipBtn.setAttribute("aria-pressed", "false");
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
    s.touchBtn.setAttribute("aria-label", off ? "Volver a usar los controles del reproductor" : "Ocultar los controles del reproductor");
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

  function onFrameMessage(e) {
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
    if (!d || typeof d !== "object") return;
    // En cuanto el reproductor contesta (tarde lo que tarde: anuncios, red lenta) se le manda el sonido
    if (!s.ytReady || d.event === "onReady") {
      s.ytReady = true;
      clearInterval(s.ytTimer);
      applyAudioTo(s);
    }
    if (d.event === "onError") showError(s, YT_ERRORS[d.info] || `YouTube devolvió el error ${d.info}.`);
  }
  window.addEventListener("message", onFrameMessage);

  // hls.js: cada pantallita baja la calidad que le cabe (las pequeñas, poca; la grande, toda), guarda poco vídeo
  // en memoria y, si se queda muy atrás del directo, vuelve a él
  const HLS_VIDEO = {
    capLevelToPlayerSize: true,
    backBufferLength: 30,
    maxBufferLength: 15,
    maxMaxBufferLength: 30,
    liveSyncDurationCount: 3,        // (el valor de serie; hls.js exige darlo junto al siguiente)
    liveMaxLatencyDurationCount: 10,
  };
  const HLS_AUDIO = { ...HLS_VIDEO, capLevelToPlayerSize: false };
  // Reintentos ante un error grave. Una cadena que nunca llegó a arrancar se da por mala pronto (3 intentos, ~10 s).
  // Una que ya estaba sonando merece más paciencia: lo normal es un corte de red, así que se insiste cada vez más
  // despacio durante minuto y medio antes de rendirse.
  const HLS_RETRY_NEW = [2000, 2000, 2000];
  const HLS_RETRY_PLAYED = [2000, 4000, 8000, 15000, 30000, 30000];
  const HLS_HEALTHY_MS = 30000; // tras este rato sin errores graves, el stream vuelve a tener todos sus reintentos

  function playHls(s, media, url, config, errMsg) {
    const hls = new Hls(config);
    let played = false; // ¿ha llegado a cargar vídeo alguna vez?
    s.hls = hls;
    hls.loadSource(url);
    hls.attachMedia(media);
    hls.on(Hls.Events.MANIFEST_PARSED, () => { if (!s.parked) media.play().catch(() => {}); });
    hls.on(Hls.Events.FRAG_BUFFERED, () => {
      played = true;
      if (s.retries && Date.now() - s.lastErr > HLS_HEALTHY_MS) s.retries = 0;
    });
    hls.on(Hls.Events.ERROR, (_, data) => {
      if (!data.fatal || s.hls !== hls) return;
      s.lastErr = Date.now();
      const waits = played ? HLS_RETRY_PLAYED : HLS_RETRY_NEW;
      if (s.retries >= waits.length) {
        hls.stopLoad();
        showError(s, errMsg);
        return;
      }
      const wait = waits[s.retries++];
      if (data.type === Hls.ErrorTypes.MEDIA_ERROR) { hls.recoverMediaError(); return; }
      // si lo que falló fue la lista (el manifiesto), hay que volver a pedirla: startLoad() no lo hace
      const D = Hls.ErrorDetails;
      const manifest = [D.MANIFEST_LOAD_ERROR, D.MANIFEST_LOAD_TIMEOUT, D.MANIFEST_PARSING_ERROR].includes(data.details);
      setTimeout(() => {
        if (s.hls !== hls) return;
        if (manifest) hls.loadSource(url); else hls.startLoad();
      }, wait);
    });
    return hls;
  }

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
      // el reproductor de YouTube tarda en estar listo (y más con anuncios): se le pide que avise, una vez por
      // segundo, hasta que contesta; entonces se le manda el sonido (ver el listener de "message")
      f.addEventListener("load", () => {
        if (s.node !== f) return;
        clearInterval(s.ytTimer);
        s.ytReady = false;
        let tries = 0;
        const ask = () => {
          if (s.node !== f || s.ytReady || ++tries > 60) { clearInterval(s.ytTimer); return; }
          ytListen(s);
          applyAudioTo(s);
        };
        ask();
        s.ytTimer = setInterval(ask, 1000);
      });
      s.media.appendChild(f);
      s.node = f;
      s.el.classList.add("is-yt");
    } else if (ch.type === "atres") {
      // Reproductor oficial de Atresplayer: trae sus propios términos, botón «Directo» y sonido,
      // que esta página no puede tocar (es de otro origen)
      const f = document.createElement("iframe");
      f.title = ch.name;
      f.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
      f.src = ATRES_ORIGIN + "/embed/live/" + encodeURIComponent(ch.slug) + "/";
      // el puente (si está instalado) tarda en arrancar: se le manda el sonido varias veces
      f.addEventListener("load", () => {
        const sync = () => { if (s.node === f) applyAudioTo(s); };
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
        playHls(s, a, ch.url, HLS_AUDIO, "La radio no arranca (¿el stream ha cambiado?).");
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
      // en la ventana flotante el vídeo puede verse más grande que su pantallita: ahí no se limita la calidad
      v.addEventListener("enterpictureinpicture", () => {
        if (s.pipBtn) s.pipBtn.setAttribute("aria-pressed", "true");
        if (s.hls && s.node === v) s.hls.capLevelToPlayerSize = false;
      });
      v.addEventListener("leavepictureinpicture", () => {
        if (s.pipBtn) s.pipBtn.setAttribute("aria-pressed", "false");
        if (s.hls && s.node === v) s.hls.capLevelToPlayerSize = true;
      });
      v.addEventListener("loadedmetadata", updateMediaSession);
      s.media.appendChild(v);
      s.node = v;
      s.el.classList.add("is-video");

      if (window.Hls && Hls.isSupported()) {
        playHls(s, v, ch.url, HLS_VIDEO);
      } else if (v.canPlayType("application/vnd.apple.mpegurl")) {
        v.src = ch.url; // Safari / iOS: HLS nativo
        v.addEventListener("error", () => { if (s.node === v) showError(s); });
        v.play().catch(() => {});
      } else {
        showError(s);
      }
    }
    applyAudio();
  }

  // Vuelve la conexión: las cadenas que se habían rendido se reintentan solas
  window.addEventListener("online", () => {
    screens.forEach((s) => {
      if (s.i < state.count && s.hls && s.el.classList.contains("has-error")) { s.retries = 0; start(s); }
    });
  });

  // ---------- Audio: solo suena la pantalla con foco ----------
  function applyAudioTo(s) {
    const vol = state.volume;
    const focused = s.i === state.active && s.i < state.count;
    const audible = focused && state.interacted && !state.muted && vol > 0;
    const atres = s.el.classList.contains("is-atres");
    // Atresplayer: solo se sabe y se controla su sonido si el puente está dentro del reproductor
    const icon = focused && s.node && (!atres || s.bridged) ? (audible ? "🔊" : "🔇") : "";
    if (s.audEl.textContent !== icon) s.audEl.textContent = icon;
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
  }

  function applyAudio() {
    const vol = state.volume;
    screens.forEach(applyAudioTo);

    // Controles del menú. Hasta el primer gesto el navegador no deja sonar: se enseña el altavoz tachado y la
    // barra a cero, para que se vea que hay que pinchar algo
    const locked = !state.interacted;
    const shown = locked ? 0 : vol;
    volRange.value = Math.round(shown * 100);
    volOut.textContent = Math.round(shown * 100);
    const off = locked || state.muted || vol === 0;
    muteBtn.textContent = off ? "🔇" : "🔊";
    muteBtn.setAttribute("aria-pressed", String(off));
    muteBtn.title = locked ? "Pincha aquí (o en cualquier sitio) para activar el sonido" : off ? "Activar el sonido (M)" : "Silenciar (M)";
    updateMediaSession();
  }

  // El primer gesto solo despierta el sonido: si fue sobre el altavoz (o la tecla M), no debe además silenciarlo
  let justUnlocked = false;

  function toggleMute() {
    if (justUnlocked) { justUnlocked = false; return; }
    state.muted = !state.muted;
    if (!state.muted && state.volume === 0) state.volume = 0.5;
    applyAudio();
    save();
  }

  volRange.addEventListener("input", () => {
    state.volume = Number(volRange.value) / 100;
    if (state.volume > 0) state.muted = false;
    applyAudio();
    saveSoon();
  });
  muteBtn.addEventListener("click", toggleMute);
  // el puente de Atresplayer puede arrancar tarde o el reproductor recrear su <video>: se repite la orden
  setInterval(() => { screens.forEach((s) => { if (s.el.classList.contains("is-atres")) applyAudioTo(s); }); }, 3000);

  // Primer gesto del usuario: a partir de ahí el navegador permite el sonido. OJO: no todo lo que se toca cuenta.
  // Con el dedo, apoyarlo (pointerdown) o deslizar no valen: cuenta al levantarlo tras un toque. Y quitar el silencio
  // antes de tiempo hace que el navegador pare el vídeo. Por eso se le pregunta al navegador (userActivation) y,
  // si no sabe contestar, se va a lo seguro.
  const markInteracted = (e) => {
    if (state.interacted) {
      if (e.type === "pointerdown" || e.type === "keydown") justUnlocked = false; // empieza otro gesto
      return;
    }
    const ua = navigator.userActivation;
    const ok = ua
      ? ua.hasBeenActive
      : e.type === "pointerdown" ? e.pointerType === "mouse" : e.type !== "keydown" || e.key !== "Escape";
    if (!ok) return;
    state.interacted = true;
    justUnlocked = !state.muted && state.volume > 0;
    applyAudio();
  };
  ["pointerdown", "pointerup", "keydown", "click"].forEach((ev) => document.addEventListener(ev, markInteracted, true));

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

  // En modo foco, la pantallita elegida se cambia de sitio con la grande: pasa a ser la 1 y la que estaba
  // pasa a ocupar su casilla (el número lo marca la casilla, así que los números se intercambian con ellas).
  // Una radio no se pone en grande: no tiene imagen. promote=false: solo se da el foco, sin mover nada.
  function setActive(i, promote = true) {
    if (i < 0 || i >= state.count) return;
    if (promote && state.focus && state.count > 1 && i !== 0 && !isAudioSlot(i)) {
      state.active = 0; // el foco se va con lo que se mueve
      swap(i, 0);
    } else {
      state.active = i;
    }
    syncAtres();
    screens.forEach((s) => s.el.classList.toggle("active", s.i === state.active));
    applyAudio();
    save();
  }

  const focusOn = () => state.focus && state.count > 1;
  const isAudioId = (id) => !!(byId[id] && byId[id].type === "audio");

  // Una radio nunca ocupa la pantalla grande del modo foco. Si le tocaba, va a un huequito: uno que ya tenga
  // radio, si no uno vacío y si no el último.
  function radioSlot() {
    const small = Array.from({ length: state.count - 1 }, (_, k) => k + 1);
    const pick = small.find((k) => isAudioSlot(k)) || small.find((k) => !state.slots[k]) || state.count - 1;
    return pick;
  }

  // Devuelve la casilla en la que ha quedado la cadena (puede no ser la pedida: ver radioSlot)
  function assign(i, id) {
    let moved = false;
    if (id && i === 0 && focusOn() && isAudioId(id)) {
      i = radioSlot();
      moved = state.active === 0;
      if (moved) state.active = i; // el foco (y el sonido) se van con la radio a su huequito
    }
    state.slots[i] = id;
    screens[i].retries = 0;
    start(screens[i]);
    if (moved) syncAtres();
    screens.forEach((s) => s.el.classList.toggle("active", s.i === state.active));
    placeFocus();
    applyAudio();
    renderBadges();
    save();
    return i;
  }

  // Si al entrar en modo foco (o al abrir la página) la grande tiene una radio, se cambia por la primera
  // pantallita con imagen (o, si no hay, por una vacía). El foco se va con lo que se mueve.
  function fixRadioInBig() {
    if (!focusOn() || !isAudioSlot(0)) return;
    const small = Array.from({ length: state.count - 1 }, (_, k) => k + 1);
    const j = small.find((k) => state.slots[k] && !isAudioSlot(k)) || small.find((k) => !state.slots[k]);
    if (!j) return; // todo son radios: no hay nada mejor que poner
    if (state.active === 0) state.active = j;
    else if (state.active === j) state.active = 0;
    swap(0, j);
  }

  // Intercambia dos pantallitas SIN recargarlas: los reproductores no se tocan (un iframe se reiniciaría y en
  // Atresplayer habría que aceptar los términos y pulsar «Directo» otra vez). Lo que cambia es qué casilla
  // ocupa cada una. El foco se queda en su casilla (como al elegir una cadena).
  function swap(a, b) {
    // arrastrando tampoco se cuela una radio en la grande del modo foco
    if (focusOn() && ((a === 0 && isAudioSlot(b)) || (b === 0 && isAudioSlot(a))) && !isAudioSlot(0)) return;
    [state.slots[a], state.slots[b]] = [state.slots[b], state.slots[a]];
    [screens[a], screens[b]] = [screens[b], screens[a]];
    screens.forEach((s, k) => {
      s.i = k;
      s.el.style.setProperty("--pos", k);
      s.numEl.textContent = k + 1;
      s.emptyEl.firstChild.nodeValue = "Pantalla " + (k + 1);
    });
    screens.forEach((s) => s.el.classList.toggle("active", s.i === state.active)); // el halo se queda en la casilla con foco
    placeFocus();
    syncAtres();   // sin puente, la que acaba en la casilla con foco se reanuda y la otra se pausa
    applyAudio();  // suena la que ha quedado en la casilla con foco
    renderBadges();
    save();
  }

  // Atresplayer con el puente de sonido: al ocultar la pantallita (menos pantallitas) sigue corriendo, en silencio,
  // para no tener que aceptar términos y pulsar «Directo» otra vez al volver. Sin puente no se puede silenciar: se para.
  const keepHidden = (s) => {
    const ch = byId[state.slots[s.i]];
    return !!(ch && ch.type === "atres" && s.node && s.bridged);
  };

  function layout() {
    wall.style.setProperty("--cols", Math.ceil(state.count / 2));
    wall.style.setProperty("--rows", state.count === 1 ? 1 : 2);
    wall.classList.toggle("single", state.count === 1);
    screens.forEach((s) => {
      const visible = s.i < state.count;
      s.el.hidden = !visible;
      if (!visible) {
        if (!keepHidden(s)) stop(s);
      } else if (!s.node && state.slots[s.i]) {
        start(s);
      } else if (!state.slots[s.i]) {
        s.el.classList.add("is-empty");
      }
    });
    if (state.active >= state.count) state.active = state.count - 1;
    fixRadioInBig();
    placeFocus();
    setActive(state.active, false); // al arrancar o cambiar el número de pantallitas no se mueve nada
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

  // El número de cada pantallita lo da su casilla: la 1 es siempre la grande, la columna de la derecha va de arriba
  // abajo (2, 3, 4...) y la fila de abajo de izquierda a derecha. Lo que cambia de sitio es el contenido (setActive).
  function placeFocus() {
    const on = focusOn(); // con una sola pantallita no hay nada que enfocar
    wall.classList.toggle("focus", on);
    focusBtn.setAttribute("aria-pressed", String(state.focus));
    if (!on) {
      screens.forEach((s) => {
        s.el.style.removeProperty("--area");
        s.el.classList.remove("is-big");
      });
      return;
    }
    const g = focusGeometry(state.count);
    wall.style.setProperty("--f-cols", g.cols);
    wall.style.setProperty("--f-rows", g.rows);
    screens.forEach((s, k) => {
      if (k < state.count) s.el.style.setProperty("--area", g.areas[k]); // escritorio: sitio en la rejilla
      else s.el.style.removeProperty("--area");
      s.el.classList.toggle("is-big", k === 0); // móvil: la grande va arriba, a todo el ancho
    });
  }

  function setFocusMode(on) {
    state.focus = on;
    placeFocus();
    if (on) {
      setActive(state.active); // la que tiene el foco pasa a la casilla grande
      fixRadioInBig();
    }
    save();
  }

  // ---------- Imagen en imagen desde el menú ----------
  // El botón del menú saca (o cierra) la ventana flotante de la pantallita con foco. Solo si la del foco no tiene
  // imagen (radio, vacía) se saca otra: la primera que se pueda. Si la del foco tiene imagen pero el navegador no
  // deja sacarla (YouTube fuera de Chrome/Edge, Atresplayer), no se saca otra en su lugar.
  function pickPipScreen() {
    const f = screens[state.active];
    if (f && canPip(f)) return f;
    if (f && f.node && (f.node.tagName === "VIDEO" || f.node.tagName === "IFRAME")) return null;
    return screens.find(canPip) || null;
  }
  // Para Media Session (título, play/pausa): el <video> de la pantallita elegida, si lo es
  function pickPipVideo() {
    const s = pickPipScreen();
    return s && s.node.tagName === "VIDEO" ? s.node : null;
  }

  function togglePipMenu() {
    if (document.pictureInPictureElement || docPip) { closePip(); return; }
    const s = pickPipScreen();
    if (s) openPip(s).catch(() => {});
  }

  const PIP_TITLE = pipBtn.title;
  function syncPipBtn() {
    const on = !!document.pictureInPictureElement || !!docPip;
    pipBtn.setAttribute("aria-pressed", String(on));
    pipBtn.disabled = !on && !pickPipScreen();
    const f = screens[state.active];
    pipBtn.title = pipBtn.disabled && f && f.node && f.node.tagName === "IFRAME"
      ? (f.el.classList.contains("is-yt")
        ? "Este navegador no deja sacar YouTube a una ventana flotante (en Chrome o Edge de escritorio sí)"
        : "Atresplayer no se puede sacar a una ventana flotante")
      : PIP_TITLE;
  }

  function syncPipState() {
    screens.forEach((s) => { if (s.pipBtn) s.pipBtn.setAttribute("aria-pressed", String(inPip(s))); });
    syncPipBtn();
  }

  // Imagen en imagen automática de Chrome: se deja registrada la acción de Media Session por si el navegador la usa
  // (en las pruebas reales no salta sola, pero no estorba). Vídeo elegido por esa vía: se cierra al volver a la pestaña.
  let autoPipVideo = null;

  function setupMediaSession() {
    try {
      if (!("mediaSession" in navigator) || !(document.pictureInPictureEnabled || DOC_PIP)) return;
      const ms = navigator.mediaSession;
      ms.setActionHandler("enterpictureinpicture", () => {
        const s = pickPipScreen();
        if (!s || document.pictureInPictureElement || docPip) return undefined;
        return openPip(s).then((w) => { if (w) autoPipVideo = s.node; return w; });
      });
      ms.setActionHandler("play", () => {
        const v = pickPipVideo();
        return v ? v.play() : undefined;
      });
      ms.setActionHandler("pause", () => {
        const v = pickPipVideo();
        if (v) v.pause();
      });
      updateMediaSession();
    } catch { /* acción no admitida (Firefox, Safari...) */ }
  }

  // Metadatos de reproducción: nombre de la cadena con foco, para que el navegador vea un reproductor
  let lastMediaTitle = null;
  function updateMediaSession() {
    syncPipBtn();
    try {
      if (!("mediaSession" in navigator)) return;
      const v = pickPipVideo();
      const s = v && screens.find((x) => x.node === v);
      const title = (s && s.nameEl.textContent) || "Pantallitas";
      if (title === lastMediaTitle) return;
      lastMediaTitle = title;
      navigator.mediaSession.metadata = new MediaMetadata({
        title,
        artist: "Pantallitas",
        artwork: [{ src: "logo.svg", sizes: "any", type: "image/svg+xml" }],
      });
    } catch { /* sin Media Session */ }
  }

  // Al volver a la pestaña, se cierra la ventana flotante que sacó la acción automática
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible" || !autoPipVideo) return;
    const v = autoPipVideo;
    autoPipVideo = null;
    if (document.pictureInPictureElement === v) document.exitPictureInPicture().catch(() => {});
    else if (docPip && docPip.f === v) docPip.win.close();
  });
  // Pestaña oculta: pasado un rato, las cadenas HLS que no suenan dejan de bajar vídeo (la que tiene el foco y la
  // de la ventana flotante siguen). Al volver se reanudan y saltan al directo.
  const PARK_AFTER_MS = 30000;
  let parkTimer = 0;

  function park() {
    if (document.visibilityState === "visible") return;
    screens.forEach((s) => {
      if (!s.hls || s.parked || s.i === state.active || s.node === document.pictureInPictureElement) return;
      if (s.el.classList.contains("has-error")) return;
      s.parked = true;
      s.hls.stopLoad();
      s.node.pause();
    });
  }

  function unpark() {
    screens.forEach((s) => {
      if (!s.parked) return;
      s.parked = false;
      const hls = s.hls, media = s.node;
      if (!hls || !media) return;
      hls.once(Hls.Events.LEVEL_UPDATED, () => { // con la lista ya refrescada se sabe dónde está el directo
        if (s.hls !== hls || s.parked) return;
        const live = hls.liveSyncPosition;
        if (typeof live === "number" && isFinite(live) && live > media.currentTime) media.currentTime = live;
      });
      hls.startLoad();
      media.play().catch(() => {});
    });
  }

  document.addEventListener("visibilitychange", () => {
    clearTimeout(parkTimer);
    if (document.visibilityState === "visible") unpark();
    else parkTimer = setTimeout(park, PARK_AFTER_MS);
  });
  // los eventos de imagen en imagen se disparan en el <video> y suben hasta el documento
  document.addEventListener("enterpictureinpicture", syncPipBtn, true);
  document.addEventListener("leavepictureinpicture", () => { if (!docPip) autoPipVideo = null; syncPipBtn(); }, true);

  // ---------- Guardar orden ----------
  function syncPinBtn() {
    const on = !!state.pinned;
    pinBtn.setAttribute("aria-pressed", String(on));
    pinBtn.textContent = on ? "Orden guardado" : "Guardar orden";
    pinBtn.title = on
      ? "Al abrir la página siempre vuelve este orden. Pulsa para soltarlo y recuperar lo último que dejes"
      : "Guarda las cadenas, su orden y el foco para recuperarlos siempre al abrir la página";
  }

  function togglePin() {
    state.pinned = state.pinned ? null : cleanPin({ count: state.count, slots: state.slots, active: state.active, focus: state.focus });
    syncPinBtn();
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
    saveKnown();
  }

  // Las cadenas de Tele y Radio se identifican por su nombre en TDTChannels. Si allí la renombran o la retiran,
  // desaparecería de tus pantallitas y de Favs sin avisar. Para que no pase, se guarda una copia de las que tienes
  // en uso; si la lista ya no la trae, se sigue usando la copia (y si ya no emite, la pantallita lo dirá).
  let knownJson = null;
  let knownReady = false; // hasta leer las listas y la copia no se escribe (se machacaría con una vacía)
  function saveKnown() {
    if (!knownReady) return;
    const ids = new Set([...state.slots, ...(state.pinned ? state.pinned.slots : []), ...favs]);
    const known = [...ids].map((id) => byId[id]).filter((c) => c && c.kind && isPlayable(c)); // kind: solo las de TDTChannels
    const json = JSON.stringify(known);
    if (json === knownJson) return;
    knownJson = json;
    try { localStorage.setItem(KNOWN_KEY, json); } catch { /* sin almacenamiento */ }
  }
  function loadKnown() {
    const a = read(KNOWN_KEY);
    knownReady = true;
    if (!Array.isArray(a)) return;
    a.forEach((c) => {
      if (c && typeof c === "object" && typeof c.id === "string" && typeof c.name === "string" &&
          (c.kind === "tv" || c.kind === "radio") && !byId[c.id] && isPlayable(c)) byId[c.id] = c;
    });
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
      b.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("text/plain", ch.id);
        app.classList.add("is-dragging"); // que el iframe de la pantallita con foco no se trague el "soltar"
      });
      b.addEventListener("dragend", () => {
        app.classList.remove("is-dragging");
        screens.forEach((x) => x.el.classList.remove("dragover"));
      });
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
  pipBtn.addEventListener("click", togglePipMenu);
  pinBtn.addEventListener("click", togglePin);
  hideBtn.addEventListener("click", () => setMenuHidden(true));
  showBtn.addEventListener("click", () => setMenuHidden(false));

  // Pantalla completa de toda la app (rejilla + menú), no de un stream suelto.
  // Así el menú se puede sacar y esconder también en pantalla completa.
  function toggleAppFullscreen() {
    if (document.fullscreenElement === app) document.exitFullscreen().catch(() => {});
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
    const k = String(e.key || "").toLowerCase();
    const n = Number(k);
    if (n >= 1 && n <= MAX) setActive(n - 1);
    else if (k === "m") toggleMute();
    else if (k === "f") setFocusMode(!state.focus);
    else if (k === "p") toggleAppFullscreen();
    else if (k === "h") setMenuHidden(!state.menuHidden);
  });

  // Arranque: se leen las listas guardadas, se monta la rejilla y, si hace falta, se bajan las nuevas por detrás
  setMenuHidden(state.menuHidden);
  pipBtn.hidden = !document.pictureInPictureEnabled && !DOC_PIP; // sin imagen en imagen en el navegador, no se enseña
  if (DOC_PIP) document.documentElement.classList.add("doc-pip"); // las pantallitas de YouTube enseñan su ⧉
  setupMediaSession();
  syncPinBtn();
  listSel.value = state.view;
  Object.keys(catalogs).forEach(loadCatalog);
  loadKnown(); // después de las listas: lo que ellas traen manda sobre la copia
  sanitizeSlots();
  renderList();
  layout();
  Object.keys(catalogs).forEach(refreshCatalog);
})();
