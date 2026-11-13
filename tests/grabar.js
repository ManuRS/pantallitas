// Pruebas de grabar el audio: tele HLS sin foco, radio HLS, radio de enlace directo (con y sin permiso CORS),
// tele con audio y vídeo juntos (MediaRecorder), cambiar de cadena grabando y pestaña oculta sin suspender.
// Los archivos descargados se comprueban con ffprobe/ffmpeg.
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { BASE, PORT, launch, snapshot, sleep, screenAt, check, summary, hits, TEST_CHANNELS } = require("./lib");

// Otro origen (127.0.0.1 en vez de localhost): así la radio directa necesita permiso CORS, como en la vida real
const OTHER = `http://127.0.0.1:${PORT}`;
TEST_CHANNELS.push(
  { id: "radio-mp3", name: "Radio Directa", type: "audio", url: `${OTHER}/streams/radio.mp3` },
  { id: "radio-nocors", name: "Radio Cerrada", type: "audio", url: `${OTHER}/nocors/radio.mp3` },
  { id: "fmp4", name: "Tele MP4", type: "hls", url: `${BASE}/streams/fmp4/index.m3u8` },
);

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "pantallitas-rec-"));
function probe(file) {
  const j = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,codec_name:format=duration,start_time",
    "-of", "json", file]).toString());
  let decodeErr = "";
  try { execFileSync("ffmpeg", ["-v", "error", "-i", file, "-f", "null", "-"], { stdio: ["ignore", "ignore", "pipe"] }); } catch (e) { decodeErr = String(e.stderr || e); }
  const st = j.streams || [];
  // lo que contiene de verdad: hasta el final del último paquete de audio (la cabecera podría decir otra cosa)
  const pk = execFileSync("ffprobe", ["-v", "error", "-select_streams", "a:0", "-show_entries", "packet=pts_time,duration_time",
    "-of", "csv=p=0", file]).toString().trim().split("\n").map((l) => l.split(",").map(Number)).filter((x) => isFinite(x[0]));
  const real = pk.length ? Math.max(...pk.map(([pt, d]) => pt + (d || 0))) - pk[0][0] : 0;
  return {
    real,
    audio: st.filter((x) => x.codec_type === "audio").map((x) => x.codec_name), video: st.filter((x) => x.codec_type === "video").length,
    dur: Number(j.format && j.format.duration) || 0, start: Number(j.format && j.format.start_time) || 0, decodeErr: decodeErr.slice(0, 200),
  };
}

(async () => {
  const { browser, page, errors } = await launch({ context: { acceptDownloads: true } });
  await page.goto(BASE + "/");
  await sleep(6000);
  if ((await page.locator("#focusBtn").getAttribute("aria-pressed")) === "true") await page.click("#focusBtn"); // casillas fijas
  await screenAt(page, 0).click({ position: { x: 200, y: 200 } }); // primer gesto: foco en la 1
  await sleep(500);

  const recBtn = (pos) => screenAt(page, pos).locator(".b-rec");
  const recInfo = (pos) => screenAt(page, pos).evaluate((el) => {
    const b = el.querySelector(".b-rec");
    return { shown: getComputedStyle(b).display !== "none", pressed: b.getAttribute("aria-pressed"), text: b.textContent,
      rec: el.classList.contains("is-rec"), note: el.querySelector(".rec-note").hidden ? "" : el.querySelector(".rec-note").textContent };
  });
  const stopAndSave = async (pos) => {
    const dl = page.waitForEvent("download", { timeout: 15000 });
    await recBtn(pos).click({ force: true });
    const d = await dl;
    const file = path.join(TMP, d.suggestedFilename());
    await d.saveAs(file);
    return { name: d.suggestedFilename(), file };
  };
  const put = async (pos, name) => { // cadena en una casilla: se le da el foco y se elige en la lista
    await screenAt(page, pos).click({ position: { x: 100, y: 100 } });
    await page.locator("#channels .ch", { hasText: name }).first().click();
    await sleep(4000);
  };

  console.log("Tele HLS sin foco (la 2)");
  let r = await recInfo(1);
  check("las teles HLS enseñan ⏺", r.shown, r);
  check("YouTube no enseña ⏺", !(await recInfo(3)).shown);
  await page.setViewportSize({ width: 560, height: 420 }); // pantallitas pequeñas: calidad baja
  await sleep(9000);
  const vw0 = (await snapshot(page))[1].vw;
  const mediaOf = (pos) => screenAt(page, pos).evaluate((el) => {
    const m = el.querySelector("video, audio");
    return { t: m.currentTime, start: m.buffered.length ? m.buffered.start(0) : 0, end: m.buffered.length ? m.buffered.end(m.buffered.length - 1) : 0 };
  });
  const t0 = Date.now();
  const m0 = await mediaOf(1);
  await recBtn(1).click({ force: true });
  await sleep(2000);
  await page.setViewportSize({ width: 1400, height: 900 }); // grandes: hls.js cambia de calidad a mitad de grabación
  await sleep(6000);
  r = await recInfo(1);
  let s = await snapshot(page);
  check("grabando: en rojo con el tiempo", r.rec && r.pressed === "true" && /^⏺ 0:0[6-9]$/.test(r.text), r);
  check("cambia de calidad mientras graba", vw0 && s[1].vw > vw0, { antes: vw0, ahora: s[1].vw });
  check("graba sin quitarle el foco a la 1", s[0].cls.includes("active") && !s[1].cls.includes("active"), s.map((x) => x.cls));
  const m1 = await mediaOf(1);
  let out = await stopAndSave(1);
  const secs = (Date.now() - t0) / 1000;
  let p = probe(out.file);
  check("se descarga un .m4a con el nombre de la cadena y la hora", /^Sky News \d{4}-\d\d-\d\d \d\d-\d\d\.m4a$/.test(out.name), out.name);
  check("solo audio AAC, sin vídeo", p.audio.join() === "aac" && p.video === 0, p);
  check("empieza en 0 y se decodifica sin errores", p.start < 0.1 && !p.decodeErr, p);
  // empieza 30 s antes de pulsar (o al sintonizar, si hace menos) y llega hasta lo ya descargado por delante
  check("dura lo que estuvo grabando, más lo de antes y lo ya descargado por delante", p.real >= secs - 1.5 && p.real < secs + 30 + 32, { real: p.real, secs: Math.round(secs) });
  check("y la cabecera dice esa duración", Math.abs(p.dur - p.real) < 0.5, { cabecera: p.dur, real: p.real });
  // desde 30 s antes de lo que se oía al pulsar (o desde lo primero que hay) al final de lo descargado al parar
  const expected = m1.end - Math.max(m0.t - 30, m0.start);
  check("sin trozos repetidos ni perdidos al cambiar de calidad", Math.abs(p.real - expected) < 2.5, { real: p.real, expected });
  console.log("     (grabó " + secs.toFixed(1) + " s y el archivo dura " + p.real.toFixed(1) + " s; esperado " + expected.toFixed(1) + " s)");
  const inChrome = await page.evaluate(async (b64) => {
    const a = new Audio("data:audio/mp4;base64," + b64);
    return new Promise((res) => { a.onloadedmetadata = () => res(a.duration); a.onerror = () => res(-1); setTimeout(() => res(-2), 5000); });
  }, fs.readFileSync(out.file).toString("base64"));
  check("y el propio Chrome lo abre con esa duración", Math.abs(inChrome - p.real) < 0.5, { chrome: inChrome, real: p.real });
  check("al parar vuelve a ⏺", (await recInfo(1)).text === "⏺");

  console.log("Empieza 30 s antes de pulsar");
  await sleep(35000); // CNN (la 3) lleva ya más de 30 s sonando
  const c0 = await mediaOf(2);
  await recBtn(2).click({ force: true });
  await sleep(3000);
  const c1 = await mediaOf(2);
  out = await stopAndSave(2);
  p = probe(out.file);
  const exp30 = c1.end - (c0.t - 30);
  check("trae los 30 s de antes de pulsar", Math.abs(p.real - exp30) < 2.5 && p.real > 30 + 3, { real: p.real, esperado: exp30 });

  console.log("Radio HLS (la 3)");
  await put(2, "Radio Uno");
  await screenAt(page, 0).click({ position: { x: 200, y: 200 } }); // el foco vuelve a la 1
  await recBtn(2).click({ force: true });
  await sleep(5000);
  out = await stopAndSave(2);
  p = probe(out.file);
  check("radio HLS: .m4a de audio AAC que se decodifica", /\.m4a$/.test(out.name) && p.audio.join() === "aac" && !p.decodeErr && p.real > 4 && Math.abs(p.dur - p.real) < 0.5, { out: out.name, p });

  console.log("Radio de enlace directo (MP3, con permiso CORS)");
  await put(2, "Radio Directa");
  await screenAt(page, 0).click({ position: { x: 200, y: 200 } });
  check("enseña ⏺", (await recInfo(2)).shown);
  await recBtn(2).click({ force: true });
  await sleep(4000);
  check("está grabando", (await recInfo(2)).rec);
  out = await stopAndSave(2);
  p = probe(out.file);
  check("se descarga el MP3 tal cual", /\.mp3$/.test(out.name) && p.audio.join() === "mp3" && !p.decodeErr && p.real > 1, { out: out.name, p });

  console.log("Radio de enlace directo sin permiso CORS");
  await put(2, "Radio Cerrada");
  await screenAt(page, 0).click({ position: { x: 200, y: 200 } });
  s = await snapshot(page);
  check("la radio suena igual", s[2].tag === "AUDIO" && !s[2].paused, s[2]);
  await recBtn(2).click({ force: true });
  await sleep(1500);
  r = await recInfo(2);
  check("no graba y avisa de que la emisora no deja", !r.rec && r.text === "⏺" && /no deja grabarla/.test(r.note), r);

  console.log("Tele con audio y vídeo en el mismo trozo MP4 (MediaRecorder)");
  await put(2, "Tele MP4");
  await screenAt(page, 0).click({ position: { x: 200, y: 200 } });
  await recBtn(2).click({ force: true });
  await sleep(5000);
  out = await stopAndSave(2);
  p = probe(out.file);
  check("graba su audio (sin vídeo) y se decodifica", /\.(webm|m4a)$/.test(out.name) && p.audio.length === 1 && p.video === 0 && !p.decodeErr, { out: out.name, p });

  console.log("Una pantallita que graba no se cambia ni se quita");
  let downloads = 0;
  page.on("download", () => downloads++);
  await recBtn(1).click({ force: true });
  await sleep(2000);
  await screenAt(page, 1).click({ position: { x: 100, y: 100 } });
  await page.locator("#channels .ch", { hasText: "CNN" }).first().click();
  await sleep(1000);
  s = await snapshot(page);
  r = await recInfo(1);
  check("elegir otra cadena: no cambia, sigue grabando y avisa", s[1].name === "Sky News" && r.rec && /para la grabación antes de cambiarla/.test(r.note), { name: s[1].name, r });
  await screenAt(page, 1).locator(".b-clear").click({ force: true });
  await sleep(500);
  s = await snapshot(page);
  check("✕: no se quita y sigue grabando", s[1].name === "Sky News" && (await recInfo(1)).rec, s[1].name);
  await page.click('#count button[data-count="1"]');
  await sleep(800);
  r = await recInfo(1);
  check("pasar a 1 pantallita: no se quita y avisa", (await page.locator(".screen:visible").count()) >= 2 && r.rec && /antes de quitarla/.test(r.note), r);
  check("y no se ha descargado nada", downloads === 0, downloads);
  await page.click('#count button[data-count="6"]'); // más pantallitas sí
  await sleep(800);
  check("pasar a más pantallitas sí, sin cortarla", (await page.locator(".screen:visible").count()) === 6 && (await recInfo(1)).rec);
  await page.click('#count button[data-count="4"]');
  await sleep(800);
  out = await stopAndSave(1);
  p = probe(out.file);
  check("al pararla se descarga entera", /^Sky News /.test(out.name) && p.real > 4 && !p.decodeErr, { out: out.name, p });
  await screenAt(page, 0).click({ position: { x: 200, y: 200 } });

  console.log("Pestaña oculta: la que graba no se suspende");
  await put(2, "Radio Uno");
  await screenAt(page, 0).click({ position: { x: 200, y: 200 } });
  await recBtn(2).click({ force: true });
  await sleep(1000);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await sleep(33000); // se suspende a los 30 s
  const h1 = await hits();
  await sleep(6000);
  const h2 = await hits();
  s = await snapshot(page);
  check("la que no graba (sin foco) se ha suspendido", s[1].paused && h2.ccnn === h1.ccnn, { cnn: [h1.ccnn, h2.ccnn], paused: s[1].paused });
  check("la que graba sigue bajando audio", !s[2].paused && h2.cradio > h1.cradio, { radio: [h1.cradio, h2.cradio] });
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  out = await stopAndSave(2);
  p = probe(out.file);
  check("y su grabación va seguida (~40 s y lo de antes)", p.real > 38 && p.real < 95 && Math.abs(p.dur - p.real) < 0.5 && !p.decodeErr, p);

  const errs = errors.filter((e) => !/nocors\/radio\.mp3.*CORS policy/.test(e)); // el bloqueo de la radio cerrada es lo esperado
  check("sin errores en la consola", errs.length === 0, errs);
  await browser.close();
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(summary() ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
