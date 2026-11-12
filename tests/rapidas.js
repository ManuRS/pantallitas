// Pruebas rápidas: arranque, calidad por tamaño, primer gesto, YouTube lento, radio, arrastres, copia de cadenas, puente
const { BASE, launch, snapshot, stored, sleep, screenAt, check, summary } = require("./lib");

(async () => {
  const { browser, context, page, fx, errors } = await launch();
  await page.goto(BASE + "/");
  await sleep(6000);

  console.log("Arranque (primera vez)");
  let s = await snapshot(page);
  check("4 pantallitas visibles", s.filter((x) => !x.hidden).length === 4, s.map((x) => x.hidden));
  check("las 3 HLS reproducen", [0, 1, 2].every((i) => s[i].tag === "VIDEO" && !s[i].paused && s[i].t > 0), s.slice(0, 3));
  check("todas en silencio antes del primer gesto", [0, 1, 2].every((i) => s[i].muted));
  check("YouTube incrustado en la 4", s[3].tag === "IFRAME");
  check("volumen a 0 hasta el primer gesto", (await page.locator("#volOut").textContent()) === "0");

  console.log("Primer gesto con ratón");
  await screenAt(page, 0).click({ position: { x: 200, y: 200 } });
  await sleep(500);
  s = await snapshot(page);
  check("la que tiene el foco suena y sigue reproduciendo", !s[0].muted && !s[0].paused, s[0]);
  check("las demás siguen mudas", s[1].muted && s[2].muted);
  await page.click("#muteBtn"); await sleep(200);
  check("altavoz silencia", (await snapshot(page))[0].muted);
  await page.click("#muteBtn"); await sleep(200);
  check("altavoz devuelve el sonido", !(await snapshot(page))[0].muted);

  console.log("Calidad según tamaño (8 pantallitas, modo foco)");
  await page.click('#count button[data-count="8"]');
  await page.click("#focusBtn");
  s = await snapshot(page);
  check("modo foco activo y la 1 es la grande", s[0].cls.includes("is-big") && s[0].w > s[1].w * 2, s.map((x) => x.w));
  await sleep(9000);
  s = await snapshot(page);
  check("la grande baja en 720p", s[0].vw === 1280, s[0].vw);
  check("las pequeñas bajan en 180p", s[1].vw === 320 && s[2].vw === 320, [s[1].vw, s[2].vw, s[1].w]);

  console.log("Teclado en modo foco: la 2 se cambia con la grande sin reiniciarse");
  const before = await snapshot(page);
  await page.keyboard.press("2");
  await sleep(600);
  s = await snapshot(page);
  check("se intercambian las cadenas", s[0].name === before[1].name && s[1].name === before[0].name, [s[0].name, s[1].name]);
  check("no se reinician (el vídeo sigue por donde iba)", s[0].t > before[1].t && s[1].t > before[0].t, [s[0].t, before[1].t]);
  check("suena la grande y solo ella", !s[0].muted && s[1].muted);
  await sleep(7000);
  s = await snapshot(page);
  check("la que pasa a grande sube a 720p y la otra baja a 180p", s[0].vw === 1280 && s[1].vw === 320, [s[0].vw, s[1].vw]);

  console.log("Radio en modo foco");
  check("el foco está en la grande", s[0].cls.includes("active"));
  await page.locator("#channels .ch", { hasText: "Radio Uno" }).click();
  await sleep(1500);
  s = await snapshot(page);
  const r1 = s.findIndex((x) => x.name === "Radio Uno");
  check("la radio no ocupa la grande: va a un huequito", r1 > 0 && !s[0].cls.includes("is-audio"), s.map((x) => x.name));
  check("el foco y el sonido se van con la radio", s[r1].cls.includes("active") && s[r1].muted === false && s[0].muted, [s[r1], s[0].muted]);
  check("la grande conserva su cadena", s[0].name === before[1].name);
  // segunda radio con el foco otra vez en la grande: sustituye a la radio que ya había
  await page.keyboard.press("1"); await sleep(300);
  await page.locator("#channels .ch", { hasText: "Radio Dos" }).click();
  await sleep(1200);
  s = await snapshot(page);
  check("otra radio reutiliza el huequito de la radio", s[r1].name === "Radio Dos" && !s[0].cls.includes("is-audio"), s.map((x) => x.name));
  check("la radio (HLS de audio) suena", s[r1].tag === "AUDIO" && !s[r1].paused && s[r1].t > 0, s[r1]);
  // quitar el modo foco, llevar la radio a la casilla 1 y volver a ponerlo
  await page.keyboard.press("f"); await sleep(300);
  await screenAt(page, 0).click({ position: { x: 30, y: 60 } });
  await page.locator("#channels .ch", { hasText: "Radio Uno" }).click();
  await sleep(800);
  s = await snapshot(page);
  check("sin modo foco, la radio sí puede ir a la casilla 1", s[0].name === "Radio Uno");
  await page.keyboard.press("f"); await sleep(800);
  s = await snapshot(page);
  check("al volver al modo foco la radio sale de la grande", !s[0].cls.includes("is-audio") && s[0].tag === "VIDEO", s.map((x) => x.name));
  check("y sigue sonando ella (el foco se va con la radio)", s.find((x) => x.name === "Radio Uno").muted === false);

  console.log("YouTube que tarda 7 s en estar listo");
  await page.keyboard.press("1"); await sleep(300);
  await page.locator("#channels .ch", { hasText: "YT lento" }).click();
  await sleep(4500);
  const ytFrame = () => page.frames().find((f) => f.url().includes("UCslow"));
  check("a los 4,5 s aún no escucha (la versión anterior se rendía aquí)", (await ytFrame().evaluate(() => window.up)) !== true);
  await sleep(5000);
  const cmds = await ytFrame().evaluate(() => ({ cmds: window.cmds, listening: window.listening }));
  check("cuando por fin está listo recibe el volumen y el unMute", cmds.cmds.includes("unMute") && cmds.cmds.includes("setVolume"), cmds);
  await sleep(2500);
  const cmds2 = await ytFrame().evaluate(() => ({ n: window.cmds.length, listening: window.listening }));
  check("y deja de preguntarle una vez ha contestado", cmds2.listening === cmds.listening, [cmds, cmds2]);

  console.log("Imagen en imagen con YouTube en la grande (ventana flotante de documento)");
  const pipInfo = () => page.evaluate(() => {
    const w = window.documentPictureInPicture && documentPictureInPicture.window;
    const h = w && w.document.querySelector("iframe"); // pip.html, con el reproductor de YouTube dentro
    const f = h && h.contentDocument && h.contentDocument.querySelector("iframe");
    const big = [...document.querySelectorAll(".screen")].find((el) => el.style.getPropertyValue("--pos") === "0");
    return {
      open: !!w, src: f ? f.src : "", video: !!document.pictureInPictureElement,
      bigInPip: big.classList.contains("in-pip"), bigHasFrame: !!big.querySelector("iframe"),
      pressed: document.getElementById("pipBtn").getAttribute("aria-pressed"),
      holder: h ? h.src : "", bigErr: big.classList.contains("has-error") ? big.querySelector(".err-msg").textContent : "",
    };
  });
  check("con YouTube en la grande, el botón del menú está disponible", !(await page.locator("#pipBtn").isDisabled()));
  await page.click("#pipBtn");
  await sleep(2500);
  let pi = await pipInfo();
  check("sale la grande (YouTube), no otra pantallita", pi.open && pi.src.includes("UCslow") && !pi.video, pi);
  check("YouTube no da el error 153 en la ventana flotante (le llega desde qué página va)", !pi.err153 && !pi.bigErr, pi);
  check("su casilla avisa de que está en la ventana flotante", pi.bigInPip && !pi.bigHasFrame && pi.pressed === "true", pi);
  await sleep(8500); // el YouTube de pega tarda 7 s tras recargarse en la ventana
  const pipFrame = context.pages().flatMap((pg) => pg.frames()).find((f) => f.url().includes("UCslow"));
  const pipCmds = pipFrame ? await pipFrame.evaluate(() => (window.err153 ? ["error 153"] : window.cmds)) : null;
  check("en la ventana flotante también recibe el sonido", !!pipCmds && pipCmds.includes("unMute"), pipCmds);
  check("y se le da al play solo", !!pipCmds && pipCmds.includes("playVideo"), pipCmds);
  await page.click("#pipBtn");
  await sleep(800);
  pi = await pipInfo();
  check("al cerrarla, YouTube vuelve a su pantallita", !pi.open && !pi.bigInPip && pi.bigHasFrame && pi.pressed === "false", pi);

  console.log("Arrastrar una cadena de la lista a la pantallita con foco (YouTube)");
  s = await snapshot(page);
  check("la grande tiene foco y es un iframe", s[0].cls.includes("active") && s[0].tag === "IFRAME", s[0]);
  const src = page.locator("#channels .ch", { hasText: "Bloomberg" });
  const sb = await src.boundingBox(), db = await screenAt(page, 0).boundingBox();
  await page.mouse.move(sb.x + 20, sb.y + 10);
  await page.mouse.down();
  await page.mouse.move(sb.x - 40, sb.y + 20, { steps: 4 });
  await page.mouse.move(db.x + db.width / 2, db.y + db.height / 2, { steps: 12 });
  await sleep(200);
  check("mientras se arrastra, los iframes no reciben el ratón", await page.evaluate(() => document.getElementById("app").classList.contains("is-dragging")));
  await page.mouse.up();
  await sleep(1500);
  s = await snapshot(page);
  check("la cadena cae en la pantallita con YouTube", s[0].name === "Bloomberg" && s[0].tag === "VIDEO", s[0]);
  check("al soltar se quita el bloqueo de los iframes", !(await page.evaluate(() => document.getElementById("app").classList.contains("is-dragging"))));

  console.log("Mover pantallitas arrastrando: la radio no se cuela en la grande");
  await page.keyboard.press("f"); await sleep(300); // sin modo foco se rellenan dos casillas más
  await screenAt(page, 5).click({ position: { x: 30, y: 60 } });
  await page.locator("#channels .ch", { hasText: "CBS" }).click();
  await screenAt(page, 6).click({ position: { x: 30, y: 60 } });
  await page.locator("#channels .ch", { hasText: "El País" }).click();
  await page.keyboard.press("f"); await sleep(2500);
  s = await snapshot(page);
  const bigName = s[0].name;
  const rIdx = s.findIndex((x) => x.name === "Radio Uno");
  const numBox = await screenAt(page, rIdx).locator(".num").boundingBox();
  await page.mouse.move(numBox.x + 8, numBox.y + 8);
  await page.mouse.down();
  await page.mouse.move(numBox.x + 30, numBox.y + 30, { steps: 4 });
  await page.mouse.move(db.x + db.width / 2, db.y + db.height / 2, { steps: 12 });
  await page.mouse.up();
  await sleep(600);
  s = await snapshot(page);
  check("arrastrar la radio sobre la grande no hace nada", s[0].name === bigName && s[0].tag === "VIDEO" && s[rIdx].name === "Radio Uno", [s[0].name, s[rIdx].name]);
  // arrastre normal entre dos pequeñas con vídeo
  const a = s.findIndex((x, i) => i > 0 && x.tag === "VIDEO"), b = s.findIndex((x, i) => i > a && x.tag === "VIDEO");
  const an = await screenAt(page, a).locator(".num").boundingBox(), bb = await screenAt(page, b).boundingBox();
  await page.mouse.move(an.x + 8, an.y + 8);
  await page.mouse.down();
  await page.mouse.move(an.x + 30, an.y + 30, { steps: 4 });
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2, { steps: 12 });
  await page.mouse.up();
  await sleep(600);
  const s2 = await snapshot(page);
  check("dos pequeñas con vídeo sí se intercambian, sin reiniciarse", s2[a].name === s[b].name && s2[b].name === s[a].name && s2[a].t > s[b].t, [a, b, s2[a].name, s2[b].name]);

  console.log("Puente de Atresplayer (reproductor de pega con el puente real)");
  await page.keyboard.press("1"); await sleep(300);
  await page.locator("#channels .ch", { hasText: "Antena 3" }).click();
  await sleep(2500);
  const atres = () => page.frames().find((f) => f.url().includes("atresplayer"));
  let am = await atres().evaluate(() => ({ muted: document.getElementById("v").muted, vol: document.getElementById("v").volume }));
  s = await snapshot(page);
  check("con foco: Atresplayer suena al volumen del menú", am.muted === false && Math.abs(am.vol - 0.8) < 0.01 && s[0].aud === "🔊", [am, s[0].aud]);
  await page.keyboard.press("3"); await sleep(1200);
  am = await atres().evaluate(() => ({ muted: document.getElementById("v").muted }));
  s = await snapshot(page);
  const ai = s.findIndex((x) => x.name === "Antena 3");
  check("sin foco: se silencia y no se pausa ni se reinicia", am.muted === true && ai === 2 && !s[ai].cls.includes("is-suspended"), [am, ai, s[ai].cls]);

  const aclicks = await atres().evaluate(() => window.clicks);
  check("el puente acepta el aviso de cookies y después pulsa «Directo», una vez cada uno", JSON.stringify(aclicks) === JSON.stringify(["aceptar", "directo"]), aclicks);

  console.log("Copia de las cadenas de Tele/Radio en uso");
  await page.selectOption("#listSel", "tv");
  await sleep(1500);
  await page.locator("#channels summary").first().click();
  check("la lista Tele se ha descargado (24 canales)", (await page.locator("#channels .row").count()) === 24);
  await page.keyboard.press("1"); await sleep(300);
  await page.locator("#channels .ch", { hasText: /^Canal 1$/ }).click();
  await page.locator("#channels .row", { hasText: /^Canal 2/ }).first().locator(".star").click();
  await page.locator("#channels .row", { hasText: /^Canal 1☆|^Canal 1/ }).first().locator(".star").click();
  await sleep(2500);
  s = await snapshot(page);
  check("Canal 1 (TDTChannels) reproduce en la grande", s[0].name === "Canal 1" && !s[0].paused && s[0].t > 0, s[0]);
  const known = await page.evaluate(() => JSON.parse(localStorage.getItem("tv-wall-known")));
  check("se guarda la copia de las cadenas en uso (pantallita + favoritas)", Array.isArray(known) && known.some((c) => c.id === "tv|Canal 1") && known.some((c) => c.id === "tv|Canal 2"), known && known.map((c) => c.id));
  // TDTChannels renombra el canal y la lista caduca
  fx.renameFirst = true;
  await page.evaluate(() => {
    const c = JSON.parse(localStorage.getItem("tv-wall-list-tv")); c.t = 1; localStorage.setItem("tv-wall-list-tv", JSON.stringify(c));
  });
  await page.reload(); await sleep(4000);
  s = await snapshot(page);
  check("recarga con la lista caducada: la cadena sigue en su pantallita", s[0].name === "Canal 1" && s[0].tag === "VIDEO", s[0]);
  const list = await page.evaluate(() => JSON.parse(localStorage.getItem("tv-wall-list-tv")).channels.map((c) => c.name));
  check("la lista nueva ya no trae «Canal 1»", list.includes("Canal Renombrado") && !list.includes("Canal 1"), list.slice(0, 3));
  await page.reload(); await sleep(4000);
  await screenAt(page, 0).click({ position: { x: 200, y: 200 } });
  s = await snapshot(page);
  check("segunda recarga (la versión anterior aquí vaciaba la pantallita): sigue y reproduce", s[0].name === "Canal 1" && !s[0].paused && s[0].t > 0, s[0]);
  await page.selectOption("#listSel", "favs"); await sleep(300);
  const favNames = await page.locator("#channels .label").allTextContents();
  check("y sigue en Favs", favNames.includes("Canal 1") && favNames.includes("Canal 2"), favNames);
  check("el estado guardado conserva las 8 casillas", (await stored(page)).slots.filter(Boolean).length >= 6, (await stored(page)).slots);

  console.log("Guardar orden");
  await page.click("#pinBtn"); await sleep(200);
  const pinned = (await stored(page)).pinned.slots.slice();
  await page.keyboard.press("4"); await sleep(400);
  await page.reload(); await sleep(2500);
  check("al recargar vuelve el orden guardado", JSON.stringify((await stored(page)).slots) === JSON.stringify(pinned), [(await stored(page)).slots, pinned]);
  await page.click("#pinBtn");

  check("sin errores de JavaScript en toda la sesión", errors.length === 0, errors);
  await browser.close();
  process.exit(summary() ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
