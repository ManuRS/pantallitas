// Pruebas lentas: errores de HLS, pestaña oculta y móvil (dedo)
const fs = require("fs");
const path = require("path");
const { BASE, REPO, launch, snapshot, sleep, screenAt, check, summary, ctl, hits } = require("./lib");
const ONLY = process.env.ONLY || "";

// hls.js con un chivato: apunta sus instancias para poder provocarles errores graves desde la prueba
const HLS_SRC = fs.readFileSync(path.join(REPO, "vendor/hls.min.js"), "utf8") + `
;(() => { const t = Hls.prototype.trigger; window.__hls = new Set();
  Hls.prototype.trigger = function (ev, data) { window.__hls.add(this); return t.call(this, ev, data); }; })();`;
const routeHls = (context) => context.route("**/vendor/hls.min.js*", (r) => r.fulfill({ contentType: "text/javascript", body: HLS_SRC }));
// error grave de red provocado en la instancia de hls.js que está reproduciendo esa URL
const fatal = (page, key) => page.evaluate((k) => {
  for (const h of window.__hls) {
    if (h.url && h.url.includes("/" + k + "/")) h.trigger(Hls.Events.ERROR, { type: Hls.ErrorTypes.NETWORK_ERROR, details: Hls.ErrorDetails.FRAG_LOAD_ERROR, fatal: true });
  }
}, key);

async function errores() {
  const { browser, context, page, errors } = await launch();
  await routeHls(context);
  await ctl("flaky", "manifest", 3);
  await page.goto(BASE + "/");
  await sleep(1500);
  await screenAt(page, 0).click({ position: { x: 200, y: 200 } });

  console.log("La lista (manifiesto) falla al principio y luego vuelve");
  await page.keyboard.press("2");
  await page.locator("#channels .ch", { hasText: "Flaky" }).click();
  await page.keyboard.press("3");
  await page.locator("#channels .ch", { hasText: "Dead" }).click();
  await sleep(9000);
  let s = await snapshot(page);
  check("la cadena cuyo manifiesto falló 3 veces acaba arrancando sola", s[1].name === "Flaky" && !s[1].paused && s[1].t > 0 && !s[1].err, s[1]);
  await sleep(9000);
  s = await snapshot(page);
  check("la cadena muerta acaba en el aviso de error, sin bucle infinito", s[2].name === "Dead" && !!s[2].err, s[2]);

  console.log("Errores graves repartidos en una sesión larga");
  await sleep(3000);
  for (let i = 0; i < 6; i++) { await fatal(page, "c24h"); await sleep(700); }
  s = await snapshot(page);
  check("tras 6 errores graves seguidos sigue reproduciendo", !s[0].err && !s[0].paused, s[0]);
  const t0 = s[0].t;
  console.log("  (35 s de reproducción normal...)");
  await sleep(35000);
  for (let i = 0; i < 6; i++) { await fatal(page, "c24h"); await sleep(700); }
  s = await snapshot(page);
  check("tras un rato sana, otros 6 errores no la matan (antes moría al cuarto de toda la sesión)", !s[0].err && !s[0].paused && s[0].t > t0 + 30, s[0]);
  await fatal(page, "c24h"); await sleep(500);
  s = await snapshot(page);
  check("pero un séptimo error seguido sí enseña el aviso", !!s[0].err, s[0]);
  await screenAt(page, 0).locator(".err button").click();
  await sleep(4000);
  s = await snapshot(page);
  check("«Reintentar» la vuelve a arrancar", !s[0].err && !s[0].paused && s[0].t > 0, s[0]);

  console.log("Corte de red real de 12 s en una cadena");
  await page.keyboard.press("4");
  await page.locator("#channels .ch", { hasText: "Cut" }).click();
  await sleep(6000);
  await ctl("cut", "all");
  await sleep(12000);
  await ctl("cut", "ok");
  await sleep(14000);
  s = await snapshot(page);
  const tc = s[3].t;
  await sleep(3000);
  s = await snapshot(page);
  check("tras el corte se recupera sola y sigue avanzando", s[3].name === "Cut" && !s[3].err && s[3].t > tc + 2, [tc, s[3]]);
  check("sin errores de JavaScript", errors.length === 0, errors);
  await browser.close();
}

async function oculta() {
  const { browser, context, page, errors } = await launch();
  await routeHls(context);
  await page.goto(BASE + "/");
  await sleep(1500);
  await screenAt(page, 0).click({ position: { x: 200, y: 200 } });
  await sleep(8000);

  console.log("Pestaña oculta");
  const setVis = (v) => page.evaluate((vis) => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => vis });
    document.dispatchEvent(new Event("visibilitychange"));
  }, v);
  await setVis("hidden");
  await sleep(10000);
  let s = await snapshot(page);
  check("a los 10 s de ocultarla todo sigue igual (un cambio rápido de pestaña no cuesta nada)", [0, 1, 2].every((i) => !s[i].paused), s.map((x) => x.paused));
  await sleep(23000);
  s = await snapshot(page);
  check("a los 30 s las que no suenan se paran", s[1].paused && s[2].paused, s.map((x) => x.paused));
  check("la que tiene el foco sigue sonando", !s[0].paused && !s[0].muted, s[0]);
  const h1 = await hits(); await sleep(8000); const h2 = await hits();
  check("las paradas no bajan nada de la red", h2.csky === h1.csky && h2.ccnn === h1.ccnn, [h1.csky, h2.csky, h1.ccnn, h2.ccnn]);
  check("la del foco sí sigue bajando", h2.c24h > h1.c24h, [h1.c24h, h2.c24h]);
  await sleep(15000); // que se queden bien atrás del directo
  const behind = (await snapshot(page)).map((x) => x.t);
  await setVis("visible");
  await sleep(7000);
  s = await snapshot(page);
  const t1 = s.map((x) => x.t);
  await sleep(2000);
  s = await snapshot(page);
  check("al volver se reanudan", !s[1].paused && !s[2].paused && s[1].t > t1[1] + 1 && s[2].t > t1[2] + 1, [t1, s.map((x) => x.t)]);
  check("y saltan al directo (no siguen 50 s atrás)", s[1].t - behind[1] > 20 && Math.abs(s[1].t - s[0].t) < 12, { antes: behind.slice(0, 3), ahora: s.slice(0, 3).map((x) => x.t) });
  check("sin errores de JavaScript", errors.length === 0, errors);
  await browser.close();
}

async function movil() {
  const { browser, context, page, errors } = await launch({ context: { viewport: { width: 400, height: 800 }, hasTouch: true, isMobile: true } });
  await routeHls(context);
  await page.goto(BASE + "/");
  await sleep(7000);
  let s; // OJO: nada de page.evaluate antes del gesto: Playwright lo ejecuta como si fuera un gesto del usuario

  console.log("Primer gesto con el dedo: deslizar");
  const cdp = await context.newCDPSession(page);
  const swipe = async (from, to) => {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 200, y: from }] });
    const step = from > to ? -15 : 15;
    for (let y = from + step; (to - y) * step >= 0; y += step) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 200, y }] }); await sleep(16); }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  };
  await swipe(200, 20);
  await sleep(1200);
  s = await snapshot(page);
  const scrolled = await page.evaluate(() => window.scrollY);
  check("la página se ha deslizado", scrolled > 50, scrolled);
  check("deslizar no para la pantallita con foco", !s[0].paused, s[0]);
  check("ni marca el sonido como activado (sigue a 0 hasta un toque de verdad)", (await page.locator("#volOut").textContent()) === "0" && s[0].muted, [await page.locator("#volOut").textContent(), s[0].muted]);
  await swipe(100, 500);
  await sleep(800);

  console.log("Toque de verdad");
  await screenAt(page, 0).tap({ position: { x: 100, y: 60 } });
  await sleep(800);
  s = await snapshot(page);
  check("un toque activa el sonido y sigue reproduciendo", !s[0].muted && !s[0].paused && (await page.locator("#volOut").textContent()) === "80", [s[0], await page.locator("#volOut").textContent()]);

  console.log("Modo foco en móvil");
  await page.locator('#count button[data-count="6"]').tap();
  await page.locator("#focusBtn").tap();
  await sleep(500);
  s = await snapshot(page);
  const vis = s.filter((x) => !x.hidden);
  check("la grande arriba a todo el ancho", vis[0].w > 380 && vis.slice(1).every((x) => x.y > vis[0].y), vis.map((x) => [x.x, x.y, x.w]));
  check("el resto debajo, de dos en dos y en orden", vis[1].y === vis[2].y && vis[3].y === vis[4].y && vis[1].x < vis[2].x && vis[3].y > vis[1].y && vis[1].w < 200, vis.map((x) => [x.x, x.y, x.w]));
  await screenAt(page, 2).tap({ position: { x: 60, y: 60 } });
  await sleep(600);
  const s3 = await snapshot(page);
  check("tocar una pequeña la sube arriba", s3[0].name === s[2].name && s3[2].name === s[0].name && s3[0].w > 380, [s3[0].name, s3[2].name]);
  check("sin errores de JavaScript", errors.length === 0, errors);
  await browser.close();
}

(async () => {
  if (!ONLY || ONLY === "errores") await errores();
  if (!ONLY || ONLY === "oculta") await oculta();
  if (!ONLY || ONLY === "movil") await movil();
  process.exit(summary() ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
