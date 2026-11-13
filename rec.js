// Grabación del audio de una pantallita. Lo usa app.js; aquí no hay nada de la interfaz.
//
// Se guarda el audio tal cual llega del stream, sin volver a codificarlo (misma calidad, casi sin gastar CPU),
// así que se graba aunque esa pantallita esté sin foco y silenciada:
//   - HLS (teles m3u8 y radios m3u8): hls.js ya separa el audio en trozos MP4; se van juntando en un .m4a
//     (o .mp3, si la radio da MP3). Cada pantallita guarda además el último minuto y medio de audio: así la
//     grabación empieza en lo que se está oyendo al pulsar, no en lo que hls.js descarga por delante.
//   - Radios de enlace directo (.mp3/.aac, Icecast...): se abre una segunda conexión al stream y se guarda lo que
//     llega. Solo si la emisora lo permite (CORS).
//   - HLS con audio y vídeo en el mismo trozo (MP4 «muxed»): no se puede separar; se graba lo que suena con
//     MediaRecorder (.webm o .m4a, sí recodificado).
const Rec = (() => {
  "use strict";

  // ---------- Cajas MP4 ----------
  const u32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
  const boxType = (b, o) => String.fromCharCode(b[o + 4], b[o + 5], b[o + 6], b[o + 7]);
  function boxes(b, start, end) {
    const out = [];
    let o = start;
    while (o + 8 <= end) {
      let size = u32(b, o), hdr = 8;
      if (size === 1) { size = u32(b, o + 8) * 2 ** 32 + u32(b, o + 12); hdr = 16; } else if (size === 0) size = end - o;
      if (size < hdr || o + size > end) break;
      out.push({ type: boxType(b, o), start: o, hdr, end: o + size });
      o += size;
    }
    return out;
  }
  const kids = (b, box) => boxes(b, box.start + box.hdr, box.end);
  const kid = (b, box, t) => kids(b, box).find((c) => c.type === t) || null;
  const path = (b, box, ...ts) => ts.reduce((x, t) => (x ? kid(b, x, t) : null), box);
  const top = (b) => boxes(b, 0, b.length);
  const isInit = (b) => top(b).some((x) => x.type === "moov");
  const flags = (b, box) => (b[box.start + 9] << 16) | (b[box.start + 10] << 8) | b[box.start + 11];

  // Lo que identifica el formato del audio en un segmento de inicio: si cambia, el archivo no puede seguir igual
  function initKey(init) {
    const moov = top(init).find((x) => x.type === "moov");
    const trak = moov && kid(init, moov, "trak");
    const mdhd = trak && path(init, trak, "mdia", "mdhd");
    const stsd = trak && path(init, trak, "mdia", "minf", "stbl", "stsd");
    if (!mdhd || !stsd) return "";
    const ts = u32(init, mdhd.start + (init[mdhd.start + 8] === 1 ? 28 : 20));
    return ts + ":" + Array.from(init.subarray(stsd.start, stsd.end)).join(",");
  }
  function trexDuration(init) {
    const moov = top(init).find((x) => x.type === "moov");
    const trex = moov && path(init, moov, "mvex", "trex");
    return trex ? u32(init, trex.start + 20) : 0;
  }

  // La cabecera que da hls.js trae como duración la de toda la lista del directo: se pone la de lo grabado
  // (t, en la escala de tiempo de la pista), para que los reproductores enseñen bien cuánto dura y dejen saltar.
  function setDuration(init, t) {
    const b = init.slice();
    const put = (o, v, wide) => {
      if (wide) { const hi = Math.floor(v / 2 ** 32), lo = v % 2 ** 32; b.set([hi >>> 24, (hi >>> 16) & 255, (hi >>> 8) & 255, hi & 255], o); o += 4; v = lo; }
      b.set([v >>> 24, (v >>> 16) & 255, (v >>> 8) & 255, v & 255], o);
    };
    const moov = top(b).find((x) => x.type === "moov");
    const mvhd = moov && kid(b, moov, "mvhd"), trak = moov && kid(b, moov, "trak");
    const mdhd = trak && path(b, trak, "mdia", "mdhd"), tkhd = trak && kid(b, trak, "tkhd");
    if (!mvhd || !mdhd) return b;
    const v1 = (x) => b[x.start + 8] === 1;
    const trackScale = u32(b, mdhd.start + (v1(mdhd) ? 28 : 20)), movieScale = u32(b, mvhd.start + (v1(mvhd) ? 28 : 20));
    if (!trackScale || !movieScale) return b;
    const mt = Math.round(t * movieScale / trackScale);
    put(mdhd.start + (v1(mdhd) ? 32 : 24), Math.round(t), v1(mdhd));
    put(mvhd.start + (v1(mvhd) ? 32 : 24), mt, v1(mvhd));
    if (tkhd) put(tkhd.start + (v1(tkhd) ? 36 : 28), mt, v1(tkhd));
    const mehd = path(b, moov, "mvex", "mehd");
    if (mehd) put(mehd.start + 12, mt, v1(mehd));
    return b;
  }

  // Reescribe en el sitio la hora de cada trozo (tfdt) para que el archivo empiece en 0 y vaya seguido, aunque
  // el directo tenga saltos (anuncios, cortes, recargas). Devuelve la nueva hora tras el trozo.
  function retime(b, t, defDur, st) {
    for (const moof of top(b).filter((x) => x.type === "moof")) {
      for (const traf of kids(b, moof).filter((x) => x.type === "traf")) {
        const tfhd = kid(b, traf, "tfhd"), tfdt = kid(b, traf, "tfdt");
        if (!tfdt) continue;
        let dflt = defDur;
        if (tfhd) {
          const f = flags(b, tfhd);
          let o = tfhd.start + 16;
          if (f & 0x01) o += 8;
          if (f & 0x02) o += 4;
          if (f & 0x08) dflt = u32(b, o);
        }
        let dur = 0;
        for (const trun of kids(b, traf).filter((x) => x.type === "trun")) {
          const f = flags(b, trun), n = u32(b, trun.start + 12);
          let o = trun.start + 16;
          if (f & 0x01) o += 4;
          if (f & 0x04) o += 4;
          const step = [0x100, 0x200, 0x400, 0x800].filter((x) => f & x).length * 4;
          if (f & 0x100) for (let k = 0; k < n; k++) dur += u32(b, o + k * step);
          else dur += n * dflt;
        }
        const v1 = b[tfdt.start + 8] === 1, p = tfdt.start + 12;
        const orig = v1 ? u32(b, p) * 2 ** 32 + u32(b, p + 4) : u32(b, p);
        if (!dur) { // sin duraciones: se usa la hora original, desplazada para empezar en 0
          if (st.first === null) st.first = orig;
          t = Math.max(t, orig - st.first);
        }
        if (v1) {
          const hi = Math.floor(t / 2 ** 32), lo = t % 2 ** 32;
          b.set([hi >>> 24, (hi >>> 16) & 255, (hi >>> 8) & 255, hi & 255, lo >>> 24, (lo >>> 16) & 255, (lo >>> 8) & 255, lo & 255], p);
        } else {
          const lo = t % 2 ** 32;
          b.set([lo >>> 24, (lo >>> 16) & 255, (lo >>> 8) & 255, lo & 255], p);
        }
        t += dur;
      }
    }
    return t;
  }

  // ---------- Escucha de hls.js ----------
  // Se engancha a cada hls de una pantallita desde que arranca: guarda el segmento de inicio del audio y el último
  // minuto y medio de trozos, y reparte los nuevos a quien esté grabando.
  const KEEP_S = 90;
  function tap(hls) {
    const t = { container: "", init: null, muxed: false, frags: [], listener: null };
    hls.on(Hls.Events.BUFFER_CODECS, (_, tracks) => {
      if (tracks.audiovideo) t.muxed = true;
      if (tracks.audio) {
        t.muxed = false;
        t.container = tracks.audio.container || "audio/mp4";
        if (t.container === "audio/mpeg" && t.listener && !t.listener.cur) t.listener.open(null); // MP3 tal cual
      }
    });
    hls.on(Hls.Events.BUFFER_APPENDING, (_, d) => {
      if (d.type !== "audio" || !d.data || !d.data.byteLength) return;
      const data = d.data.slice(); // hls.js puede reutilizar el suyo
      const mp4 = t.container !== "audio/mpeg";
      if (mp4 && isInit(data)) {
        t.init = data;
        t.frags = []; // con otro inicio, los trozos de antes ya no casan
        if (t.listener) t.listener.onInit(data);
        return;
      }
      const f = d.frag || {};
      const item = {
        key: (f.sn ?? "x") + ":" + (d.part ? d.part.index : -1),
        start: Number(f.start) || 0,
        end: (Number(f.start) || 0) + (Number(f.duration) || 0),
        data,
      };
      t.frags.push(item);
      const last = t.frags[t.frags.length - 1].end;
      while (t.frags.length > 1 && t.frags[0].end < last - KEEP_S) t.frags.shift();
      if (t.listener) t.listener.onFrag(item);
    });
    return t;
  }

  // ---------- Grabadoras ----------
  // Todas tienen start(), stop() -> Promise<[{ blob, ext }]> y bytes (lo grabado hasta ahora).

  // Desde la escucha de hls.js. attach() se vuelve a llamar si la pantallita recarga el stream (misma cadena).
  class HlsRecorder {
    constructor() {
      this.files = [];     // partes ya cerradas (si el formato cambia a mitad)
      this.cur = null;     // { parts, init, key, mime, ext, t, defDur, st }
      this.seen = new Set();
      this.bytes = 0;
      this.tap = null;
    }

    attach(t, currentTime) {
      if (this.tap) this.tap.listener = null;
      this.tap = t;
      t.listener = this;
      if (t.container === "audio/mpeg") this.open(null);
      else if (t.init) this.onInit(t.init);
      // lo ya descargado desde lo que se está oyendo ahora (o lo que haya, si no se sabe)
      const from = typeof currentTime === "number" ? currentTime : -Infinity;
      t.frags.filter((f) => f.end > from).forEach((f) => this.onFrag(f));
    }

    open(init) {
      if (this.cur && this.cur.parts.length) this.files.push(this.cur);
      const mp3 = !init;
      this.cur = {
        parts: init ? [init] : [], init, key: init ? initKey(init) : "mp3",
        mime: mp3 ? "audio/mpeg" : "audio/mp4", ext: mp3 ? "mp3" : "m4a",
        t: 0, defDur: init ? trexDuration(init) : 0, st: { first: null }, frags: 0,
      };
    }

    onInit(init) {
      if (this.cur && this.cur.init && initKey(init) === this.cur.key) return; // el mismo formato: se sigue igual
      this.open(init);
    }

    onFrag(f) {
      if (!this.cur) return; // aún sin segmento de inicio
      // repetido: al cambiar de calidad o recargar, hls.js vuelve a pedir trozos que ya tenía (mismo número)
      if (this.seen.has(f.key)) return;
      this.seen.add(f.key);
      const data = f.data.slice();
      if (this.cur.init) this.cur.t = retime(data, this.cur.t, this.cur.defDur, this.cur.st);
      this.cur.parts.push(data);
      this.cur.frags++;
      this.bytes += data.byteLength;
    }

    start() {}

    stop() {
      if (this.tap) this.tap.listener = null;
      const all = [...this.files, this.cur].filter((c) => c && c.frags);
      return Promise.resolve(all.map((c) => {
        const parts = c.init ? [setDuration(c.init, c.t), ...c.parts.slice(1)] : c.parts;
        return { blob: new Blob(parts, { type: c.mime }), ext: c.ext };
      }));
    }
  }

  // Radio de enlace directo: segunda conexión al stream. Si se corta, se reconecta unas cuantas veces.
  const EXT_BY_TYPE = { "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/aac": "aac", "audio/aacp": "aac",
    "audio/x-aac": "aac", "audio/ogg": "ogg", "application/ogg": "ogg", "audio/opus": "opus", "audio/flac": "flac" };
  class StreamRecorder {
    constructor(url) {
      this.url = url;
      this.parts = [];
      this.bytes = 0;
      this.mime = "";
      this.ext = (/\.(mp3|aac|ogg|opus|flac)(\?|#|$)/i.exec(url) || [, "mp3"])[1].toLowerCase();
      this.ctrl = null;
      this.stopped = false;
      this.tries = 0;
    }

    // Se resuelve cuando ya llegan datos; falla si la emisora no deja leer el stream desde aquí
    async start() {
      this.ctrl = new AbortController();
      const r = await fetch(this.url, { signal: this.ctrl.signal, cache: "no-store" });
      if (!r.ok || !r.body) throw new Error("http " + r.status);
      const type = (r.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
      if (EXT_BY_TYPE[type]) { this.ext = EXT_BY_TYPE[type]; this.mime = type; }
      this.read(r.body.getReader());
    }

    async read(reader) {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          this.parts.push(value);
          this.bytes += value.byteLength;
          this.tries = 0;
        }
      } catch { /* corte de red o parada */ }
      if (this.stopped || ++this.tries > 5) return;
      setTimeout(() => { if (!this.stopped) this.start().catch(() => {}); }, 3000);
    }

    stop() {
      this.stopped = true;
      if (this.ctrl) this.ctrl.abort();
      const mime = this.mime || (this.ext === "aac" ? "audio/aac" : "audio/mpeg");
      return Promise.resolve(this.bytes ? [{ blob: new Blob(this.parts, { type: mime }), ext: this.ext }] : []);
    }
  }

  // Último recurso: lo que suena en el <video>/<audio> (sí se recodifica). El audio capturado no depende de que
  // la pantallita esté silenciada.
  const capture = (m) => (m.captureStream ? m.captureStream() : m.mozCaptureStream ? m.mozCaptureStream() : null);
  const canCapture = (m) => !!(m && window.MediaRecorder && (m.captureStream || m.mozCaptureStream));
  class CaptureRecorder {
    constructor(media) { this.media = media; this.parts = []; this.bytes = 0; this.mr = null; }

    start() {
      const tracks = capture(this.media).getAudioTracks();
      const mime = ["audio/mp4;codecs=mp4a.40.2", "audio/webm;codecs=opus", "audio/webm"].find((t) => MediaRecorder.isTypeSupported(t)) || "";
      this.mr = new MediaRecorder(new MediaStream(tracks), mime ? { mimeType: mime, audioBitsPerSecond: 160000 } : {});
      this.ext = /mp4/.test(this.mr.mimeType) ? "m4a" : "webm";
      this.mr.ondataavailable = (e) => { if (e.data.size) { this.parts.push(e.data); this.bytes += e.data.size; } };
      this.mr.start(1000);
    }

    stop() {
      return new Promise((resolve) => {
        const done = () => resolve(this.bytes ? [{ blob: new Blob(this.parts, { type: this.mr.mimeType }), ext: this.ext }] : []);
        if (!this.mr || this.mr.state === "inactive") { done(); return; }
        this.mr.onstop = done;
        this.mr.stop();
      });
    }
  }

  return { tap, HlsRecorder, StreamRecorder, CaptureRecorder, canCapture };
})();
