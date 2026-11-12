// Utilidades comunes de las pruebas de Pantallitas
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 8123);
const BASE = `http://localhost:${PORT}`;
const REPO = path.resolve(__dirname, "..");
const hlsUrl = (key) => `${BASE}/streams-x/${key}/master.m3u8`;

// Lista «Creator» de prueba: mismos tipos que la real, pero con streams locales
const TEST_CHANNELS = [
  { id: "24h", name: "24h", type: "hls", url: hlsUrl("c24h") },
  { id: "sky-news", name: "Sky News", type: "hls", url: hlsUrl("csky") },
  { id: "cnn", name: "CNN", type: "hls", url: hlsUrl("ccnn") },
  { id: "la-septima", name: "La Séptima", type: "youtube", channelId: "UCfast000000000000000000" },
  { id: "la1", name: "La 1", type: "hls", url: hlsUrl("cla1") },
  { id: "tv3", name: "TV3", type: "hls", url: hlsUrl("ctv3") },
  { id: "cbs", name: "CBS", type: "hls", url: hlsUrl("ccbs") },
  { id: "bloom", name: "Bloomberg", type: "hls", url: hlsUrl("cbloom") },
  { id: "pais", name: "El País", type: "hls", url: hlsUrl("cpais") },
  { id: "yt-slow", name: "YT lento", type: "youtube", channelId: "UCslow000000000000000000" },
  { id: "antena3", name: "Antena 3", type: "atres", slug: "antena3" },
  { id: "radio1", name: "Radio Uno", type: "audio", url: `${BASE}/streams-x/cradio/radio.m3u8` },
  { id: "radio2", name: "Radio Dos", type: "audio", url: `${BASE}/streams-x/cradio2/radio.m3u8` },
  { id: "flaky", name: "Flaky", type: "hls", url: hlsUrl("flaky") },
  { id: "dead", name: "Dead", type: "hls", url: hlsUrl("dead") },
  { id: "cut", name: "Cut", type: "hls", url: hlsUrl("cut") },
];

// Reproductor de YouTube de pega: tarda `delay` ms en escuchar, contesta a "listening" con onReady
// y apunta en window.cmds las órdenes que recibe
const fakeYouTube = (delay) => `<!doctype html><body style="margin:0;background:#300;color:#fff">YT<script>
  window.cmds = []; window.listening = 0;
  setTimeout(() => {
    window.up = true;
    addEventListener("message", (e) => {
      let d; try { d = JSON.parse(e.data); } catch { return; }
      if (d.event === "listening") {
        window.listening++;
        parent.postMessage(JSON.stringify({ event: "initialDelivery", id: d.id, info: {} }), "*");
        parent.postMessage(JSON.stringify({ event: "onReady", id: d.id }), "*");
      } else if (d.event === "command") window.cmds.push(d.func);
    });
  }, ${delay});
</script></body>`;

// YouTube de pega cuando no le llega el Referer: contesta a "listening" con el error 153
const fakeYouTube153 = () => `<!doctype html><body>153<script>
  window.cmds = []; window.err153 = true;
  addEventListener("message", (e) => {
    let d; try { d = JSON.parse(e.data); } catch { return; }
    if (d.event === "listening") parent.postMessage(JSON.stringify({ event: "onError", id: d.id, info: 153 }), "*");
  });
</script></body>`;

// Reproductor de Atresplayer de pega, con el puente de sonido real dentro. Como el de verdad: aviso de cookies
// (Didomi) que tapa el reproductor y botón «Directo»; apunta en window.clicks lo que se pulsa y en qué orden
const fakeAtres = () => `<!doctype html><body style="margin:0;background:#030;color:#fff">ATRES<video id="v"></video>
<button aria-label="Directo" class="button-primary" tabindex="0"><p class="button--text">Directo</p></button>
<div id="aviso" style="position:fixed;inset:0;background:#000c">
  <button id="didomi-notice-agree-button" aria-label="Aceptar"><span>Aceptar</span></button></div>
<script>
  window.clicks = [];
  document.getElementById("didomi-notice-agree-button").addEventListener("click", () => {
    window.clicks.push("aceptar"); document.getElementById("aviso").remove();
  });
  document.querySelector('button[aria-label="Directo"]').addEventListener("click", (e) => {
    window.clicks.push(document.getElementById("aviso") ? "directo-con-aviso" : "directo");
    e.currentTarget.remove();
  });
</script>
<script>${fs.readFileSync(REPO + "/puente/puente-pantallitas.user.js", "utf8")}</script></body>`;

// Lista de TDTChannels de pega (>= 20 canales, que es lo mínimo que la página acepta)
function tdtFixture(kind, renameFirst) {
  const channels = Array.from({ length: 24 }, (_, i) => ({
    name: i === 0 && renameFirst ? "Canal Renombrado" : `${kind === "tv" ? "Canal" : "Emisora"} ${i + 1}`,
    web: "https://example.com/", logo: "", epg_id: null, extra_info: [],
    options: [{ format: "m3u8", url: kind === "tv" ? hlsUrl("tdt" + i) : `${BASE}/streams-x/tdtr${i}/radio.m3u8`, geo2: null, res: null, lang: null }],
  }));
  return { countries: [{ name: "Spain", ambits: [{ name: "Nacionales", channels }] }] };
}

async function launch(opts = {}) {
  // Hace falta Google Chrome (el Chromium que trae Playwright no reproduce H.264/AAC). CHROME_PATH para indicar otro.
  const browser = await chromium.launch({
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: "chrome" }),
    headless: true, args: ["--no-sandbox"],
  });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, ...opts.context });
  const fx = { renameFirst: false, ytDelay: { UCfast000000000000000000: 300, UCslow000000000000000000: 7000 } };
  const errors = [];
  await context.route("**/channels.js*", (r) => r.fulfill({ contentType: "text/javascript", body: "const CHANNELS = " + JSON.stringify(TEST_CHANNELS) + ";" }));
  await context.route("https://www.youtube.com/embed/**", (r) => {
    const ch = new URL(r.request().url()).searchParams.get("channel");
    // como el de verdad: sin saber desde qué página se incrusta (Referer), error 153
    if (!r.request().headers()["referer"]) return r.fulfill({ contentType: "text/html", body: fakeYouTube153() });
    r.fulfill({ contentType: "text/html", body: fakeYouTube(fx.ytDelay[ch] ?? 300) });
  });
  await context.route("https://www.atresplayer.com/embed/**", (r) => r.fulfill({ contentType: "text/html", body: fakeAtres() }));
  await context.route("https://www.tdtchannels.com/lists/*.json", (r) => {
    const kind = /tv\.json/.test(r.request().url()) ? "tv" : "radio";
    r.fulfill({ contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(tdtFixture(kind, fx.renameFirst)) });
  });
  await context.route("https://raw.githubusercontent.com/**", (r) => r.abort());
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/404|Failed to load resource/.test(m.text())) errors.push("console: " + m.text()); });
  return { browser, context, page, fx, errors };
}

// Estado de las pantallitas, por casilla
const snapshot = (page) => page.evaluate(() => {
  const out = [];
  document.querySelectorAll(".screen").forEach((el) => {
    const pos = Number(el.style.getPropertyValue("--pos"));
    const m = el.querySelector("video, audio");
    out[pos] = {
      pos, hidden: el.hidden, cls: el.className.replace("screen", "").trim(),
      name: el.querySelector(".name").textContent, num: el.querySelector(".num").textContent,
      aud: el.querySelector(".aud").textContent, err: el.classList.contains("has-error") ? el.querySelector(".err-msg").textContent : "",
      tag: m ? m.tagName : el.querySelector("iframe") ? "IFRAME" : "",
      t: m ? m.currentTime : null, paused: m ? m.paused : null, muted: m ? m.muted : null, vw: m && m.videoWidth, ready: m ? m.readyState : null,
      live: m && m.seekable.length ? m.seekable.end(m.seekable.length - 1) - m.currentTime : null,
      w: Math.round(el.getBoundingClientRect().width), x: Math.round(el.getBoundingClientRect().x), y: Math.round(el.getBoundingClientRect().y),
    };
  });
  return out;
});
const stored = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("tv-wall-v3")));
const ctl = (key, mode, n = 0) => fetch(`${BASE}/__ctl?key=${key}&mode=${mode}&n=${n}`).then((r) => r.text());
const hits = () => fetch(`${BASE}/__hits`).then((r) => r.json());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const screenAt = (page, pos) => page.locator(`.screen[style*="--pos: ${pos};"], .screen[style*="--pos:${pos};"]`).first();

let failed = 0;
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok });
  if (!ok) failed++;
  console.log((ok ? "  ok   " : "  FALLA ") + name + (ok || detail === undefined ? "" : "  -> " + JSON.stringify(detail)));
}
const summary = () => { console.log(`\n${results.length - failed}/${results.length} comprobaciones bien`); return failed; };

module.exports = { BASE, REPO, PORT, launch, snapshot, stored, ctl, hits, sleep, screenAt, check, summary, TEST_CHANNELS };
