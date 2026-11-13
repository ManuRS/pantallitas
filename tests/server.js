// Servidor de pruebas: sirve el repo y los streams locales, con fallos provocados por clave.
//   /streams-x/<clave>/...  -> mismos ficheros que /streams/..., pero la clave puede tener fallos activos
//   /__ctl?key=K&mode=ok|all|manifest&n=N  -> mode=all: todo 404; mode=manifest: los próximos N master.m3u8 dan 404
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.env.PORT || 8123);
const STREAMS = path.join(__dirname, "streams");
const rules = {}; // key -> { mode, n }
const hits = {};  // key -> nº de peticiones servidas (para saber si una pantallita sigue bajando)

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css",
  ".svg": "image/svg+xml", ".json": "application/json", ".m3u8": "application/vnd.apple.mpegurl", ".ts": "video/mp2t", ".png": "image/png",
  ".mp3": "audio/mpeg", ".m4s": "video/iso.segment", ".mp4": "video/mp4" };

http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  // /nocors/...: lo mismo que /streams/..., pero sin permiso para leerlo desde otra web (como algunas emisoras)
  const nocors = u.pathname.startsWith("/nocors/");
  if (!nocors) res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");
  if (u.pathname === "/__ctl") {
    const key = u.searchParams.get("key");
    rules[key] = { mode: u.searchParams.get("mode"), n: Number(u.searchParams.get("n") || 0) };
    res.end("ok");
    return;
  }
  if (u.pathname === "/__hits") { res.end(JSON.stringify(hits)); return; }
  let file;
  const m = /^\/streams-x\/([^/]+)\/(.+)$/.exec(u.pathname);
  if (m) {
    const key = m[1], r = rules[key];
    if (key.startsWith("dead")) { res.statusCode = 404; res.end(); return; }
    if (r && r.mode === "all") { res.statusCode = 404; res.end(); return; }
    if (r && r.mode === "manifest" && r.n > 0 && /(master|radio)\.m3u8$/.test(m[2])) { r.n--; res.statusCode = 404; res.end(); return; }
    hits[key] = (hits[key] || 0) + 1;
    file = path.join(STREAMS, m[2]);
  } else if (nocors) {
    file = path.join(STREAMS, u.pathname.slice(8));
  } else if (u.pathname.startsWith("/streams/")) {
    file = path.join(STREAMS, u.pathname.slice(9));
  } else {
    file = path.join(ROOT, u.pathname === "/" ? "index.html" : u.pathname);
  }
  fs.readFile(file, (err, data) => {
    if (err) { res.statusCode = 404; res.end(); return; }
    res.setHeader("Content-Type", TYPES[path.extname(file)] || "application/octet-stream");
    res.end(data);
  });
}).listen(PORT, () => console.log("servidor de pruebas en el puerto", PORT));
