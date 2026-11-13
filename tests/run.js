// Lanza todo: streams de prueba (ffmpeg), servidor local y las pruebas. Uso: `npm test` (o `node run.js rapidas`)
const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const STREAMS = path.join(__dirname, "streams");
const PORT = process.env.PORT || "8123";
const only = process.argv[2]; // rapidas | lentas | grabar | (nada: todas)
const kids = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function bg(cmd, args) {
  const p = spawn(cmd, args, { cwd: __dirname, stdio: ["ignore", "ignore", "inherit"], env: { ...process.env, PORT } });
  p.on("error", (e) => { console.error(`No se pudo lanzar ${cmd}: ${e.message}`); stop(2); });
  kids.push(p);
  return p;
}
function stop(code) {
  kids.forEach((p) => { try { p.kill("SIGKILL"); } catch { /* ya no estaba */ } });
  process.exit(code);
}
const run = (file, env = {}) => new Promise((resolve) => {
  const p = spawn(process.execPath, [file], { cwd: __dirname, stdio: "inherit", env: { ...process.env, PORT, ...env } });
  kids.push(p);
  p.on("exit", (code) => resolve(code === null ? 1 : code));
});

(async () => {
  fs.rmSync(STREAMS, { recursive: true, force: true });
  fs.mkdirSync(STREAMS, { recursive: true });

  // Una «tele» en directo con dos calidades (720p y 180p) y una «radio», las dos en HLS
  bg("ffmpeg", ["-hide_banner", "-loglevel", "error", "-re",
    "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=25", "-f", "lavfi", "-i", "sine=frequency=440",
    "-filter_complex", "[0:v]split=2[a][b];[b]scale=320:180[b2]",
    "-map", "[a]", "-map", "1:a", "-map", "[b2]", "-map", "1:a",
    "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-g", "50", "-keyint_min", "50", "-sc_threshold", "0",
    "-b:v:0", "2000k", "-b:v:1", "200k", "-c:a", "aac", "-b:a", "64k",
    "-f", "hls", "-hls_time", "2", "-hls_list_size", "60", "-hls_flags", "delete_segments+independent_segments",
    "-master_pl_name", "master.m3u8", "-var_stream_map", "v:0,a:0 v:1,a:1", "streams/v%v/stream.m3u8"]);
  bg("ffmpeg", ["-hide_banner", "-loglevel", "error", "-re", "-f", "lavfi", "-i", "sine=frequency=660",
    "-c:a", "aac", "-b:a", "64k", "-f", "hls", "-hls_time", "2", "-hls_list_size", "30", "-hls_flags", "delete_segments",
    "streams/radio.m3u8"]);
  // Para las pruebas de grabar: una radio de enlace directo (MP3) y una tele en HLS con audio y vídeo en el mismo
  // trozo MP4 (no se puede separar el audio: se graba con MediaRecorder). Las dos son fijas: se hacen de una vez.
  const once = (args) => spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { cwd: __dirname, stdio: "inherit" });
  once(["-f", "lavfi", "-i", "sine=frequency=550:duration=90", "-c:a", "libmp3lame", "-b:a", "96k", "streams/radio.mp3"]);
  fs.mkdirSync(path.join(STREAMS, "fmp4"), { recursive: true });
  once(["-f", "lavfi", "-i", "testsrc2=size=320x180:rate=25:duration=40", "-f", "lavfi", "-i", "sine=frequency=330:duration=40",
    "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-g", "50", "-c:a", "aac", "-b:a", "64k",
    "-f", "hls", "-hls_time", "2", "-hls_playlist_type", "vod", "-hls_segment_type", "fmp4", "streams/fmp4/index.m3u8"]);
  bg(process.execPath, ["server.js"]);

  process.stdout.write("Preparando los streams de prueba");
  const ready = () => ["master.m3u8", "radio.m3u8", "radio.mp3", "fmp4/index.m3u8", "v0/stream.m3u8", "v1/stream.m3u8"].every((f) => fs.existsSync(path.join(STREAMS, f)));
  for (let i = 0; i < 40 && !ready(); i++) { process.stdout.write("."); await sleep(500); }
  if (!ready()) { console.error("\nffmpeg no ha generado los streams (¿está instalado, con libx264?)"); stop(2); }
  await sleep(6000); // unos cuantos segmentos de ventaja
  console.log(" listo\n");

  let failed = 0;
  if (!only || only === "rapidas") failed += await run("rapidas.js") ? 1 : 0;
  if (!only || only === "lentas") {
    // las tres tandas lentas son independientes: van a la vez
    const codes = await Promise.all(["errores", "oculta", "movil"].map((o) => run("lentas.js", { ONLY: o })));
    failed += codes.filter(Boolean).length;
  }
  if (!only || only === "grabar") failed += await run("grabar.js") ? 1 : 0;
  console.log(failed ? `\n✗ ${failed} tanda(s) con fallos` : "\n✓ Todo bien");
  stop(failed ? 1 : 0);
})();

process.on("SIGINT", () => stop(130));
