// Catálogo de TDTChannels (https://github.com/LaQuay/TDTChannels): convierte sus listas JSON
// (tv.json y radio.json), o su catálogo en Markdown si el JSON no se puede leer, en canales que
// Pantallitas sabe reproducir. Ver CREDITOS.md.
//
// Esquema de entrada:  countries[] > ambits[] > channels[] { name, web, logo, epg_id, options[], extra_info[] }
//   options[]: { format: m3u8 | youtube | mp3 | aac | stream | ..., url, geo2, res, lang }
// Salida: { channels: [{ id, kind, name, ambit, type, url | channelId | videoId, web }], hidden, generated }
//   type: "hls" | "youtube" | "audio"  (los mismos que usa app.js)
const Catalog = (() => {
  "use strict";

  // Canales que no sirven en un navegador: sin emisión online, que no funcionan en web o que piden
  // cabeceras (Referer / User-Agent) que una página no puede poner
  const BAD_INFO = /^(NOEM|NONAV|REF.*|UAG.*)$/;

  // Formatos que se intentan, de más a menos preferido
  const ORDER = {
    tv: ["m3u8", "youtube"],
    radio: ["mp3", "aac", "m3u8", "stream"], // en radio, «stream» suele ser un directo de audio (Icecast, Shoutcast...)
  };

  // YouTube: /channel/UC... (directo del canal) o un vídeo concreto (watch?v=, youtu.be/, /live/ID)
  function youtube(url) {
    let m = /youtube\.com\/channel\/(UC[\w-]{22})/.exec(url);
    if (m) return { channelId: m[1] };
    m = /(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|live\/|embed\/)|youtu\.be\/)([\w-]{11})/.exec(url);
    if (m) return { videoId: m[1] };
    return null;
  }

  const isUsable = (url, https) =>
    typeof url === "string" &&
    /^https?:\/\//i.test(url) &&
    !(https && /^http:/i.test(url)) &&       // una página https no puede cargar streams http
    !/^https?:\/\/[^/]*@/.test(url);          // nada con usuario y contraseña dentro

  // Elige la mejor opción reproducible de un canal (o null)
  function pick(options, kind, https) {
    const order = ORDER[kind];
    const candidates = [];
    (options || []).forEach((o, i) => {
      if (!o || !isUsable(o.url, https)) return;
      const rank = order.indexOf(o.format);
      if (rank < 0) return;
      let target = null;
      if (o.format === "youtube") {
        const y = youtube(o.url);
        if (!y) return;
        target = { type: "youtube", ...y };
      } else if (kind === "radio") {
        target = { type: "audio", url: o.url };
      } else {
        target = { type: "hls", url: o.url };
      }
      // Mejor sin bloqueo regional ni marcadores de plantilla ([IP], [UA]...) en la URL
      const penalty = (o.geo2 ? 10 : 0) + (/\[[A-Z_]+\]/.test(o.url) ? 20 : 0);
      candidates.push({ target, score: rank * 100 + penalty + i });
    });
    candidates.sort((a, b) => a.score - b.score);
    return candidates.length ? candidates[0].target : null;
  }

  function normalize(raw, kind, opts) {
    const https = !opts || opts.https !== false;
    const channels = [];
    const seen = new Map();
    let hidden = 0;
    const ambits = [];
    ((raw && raw.countries) || []).forEach((c) => (c.ambits || []).forEach((a) => ambits.push(a)));
    ambits.forEach((a) => {
      (a.channels || []).forEach((c) => {
        if (!c || !c.name) return;
        const bad = c.referer || (c.extra_info || []).some((t) => BAD_INFO.test(t));
        const t = bad ? null : pick(c.options, kind, https);
        if (!t) { hidden++; return; }
        // id estable entre actualizaciones: tipo + nombre (si se repite, #2, #3...)
        const base = kind + "|" + c.name;
        const n = (seen.get(base) || 0) + 1;
        seen.set(base, n);
        const ch = { id: n > 1 ? base + "#" + n : base, kind, name: c.name, ambit: a.name || "", ...t };
        if (typeof c.web === "string" && /^https?:\/\//i.test(c.web)) ch.web = c.web;
        channels.push(ch);
      });
    });
    return { channels, hidden, generated: (raw && raw.generated) || null };
  }

  // Respaldo: el catálogo en Markdown de TDTChannels (TELEVISION.md / RADIO.md), que GitHub sirve con CORS abierto.
  // Se convierte al mismo esquema que el JSON para pasar por normalize().
  //   | Canal | [m3u8 # GEO # HD](url) - [youtube](url) | [web](url) | [logo](url) | EPG | GEO,EMB |
  function parseMarkdown(md) {
    const ambits = [];
    let cur = null;
    const LINK = /\[([a-z0-9]+)((?: # [^\]]*?)?)\]\((.*?)\)(?= - \[|$)/g;
    String(md).split("\n").forEach((raw) => {
      const line = raw.replace(/\r$/, "");
      const h = /^(#{2,3}) (.+)$/.exec(line);
      if (h) { cur = { name: h[2].trim(), channels: [] }; ambits.push(cur); return; }
      if (!cur || !line.startsWith("| ") || line.startsWith("| -") || /^\| (Canal|Emisoras) \|/.test(line)) return;
      const cells = (line.endsWith(" |") ? line.slice(2, -2) : line.slice(2)).split(" | ").map((c) => c.trim());
      if (cells.length < 6) return;
      const [name, opts, web, logo, epg, info] = cells;
      const options = [];
      if (opts !== "-") {
        for (const m of opts.matchAll(LINK)) {
          let geo2 = null, res = null, lang = null;
          m[2].split("#").map((x) => x.trim()).filter(Boolean).forEach((t) => {
            if (t.startsWith("GEO")) geo2 = t.slice(3) || "SP";
            else if (/^(HD|SD|4K|FHD)$/.test(t)) res = t;
            else if (/^[A-Z]{2}$/.test(t)) lang = t;
          });
          options.push({ format: m[1], url: m[3], geo2, res, lang });
        }
      }
      const w = /^\[web\]\((.*)\)$/.exec(web);
      cur.channels.push({
        name, web: w ? w[1] : null, epg_id: epg === "-" ? null : epg, options,
        extra_info: info === "-" ? [] : info.split(","),
      });
    });
    return { countries: [{ name: "TDTChannels", ambits: ambits.filter((a) => a.channels.length) }] };
  }

  const api = { normalize, pick, youtube, parseMarkdown };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  return api;
})();
