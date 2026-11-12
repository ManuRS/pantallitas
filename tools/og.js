// Genera og.png (1200×630) a partir de tools/og.html. Necesita Playwright (el de tests/: cd tests && npm install).
// Después lo aligera a 256 colores con Python + Pillow (de ~260 KB a ~100 KB: WhatsApp y otras redes descartan imágenes
// pesadas). Si no hay Pillow, se queda la imagen sin aligerar y avisa.
const path = require("path");
const { spawnSync } = require("child_process");
const { chromium } = require(path.join(__dirname, "../tests/node_modules/playwright"));
(async () => {
  const browser = await chromium.launch({ channel: "chrome" }) // el Chrome instalado, como las pruebas;
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await page.goto("file://" + path.join(__dirname, "og.html"));
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(__dirname, "../og.png") });
  await browser.close();
  const out = path.join(__dirname, "../og.png");
  const r = spawnSync("python3", ["-c",
    "import sys;from PIL import Image;i=Image.open(sys.argv[1]).convert('RGB');" +
    "i.quantize(colors=256,dither=Image.Dither.FLOYDSTEINBERG).save(sys.argv[1],optimize=True)", out]);
  if (r.status !== 0) console.warn("Aviso: sin Python con Pillow, og.png queda sin aligerar (pesa unos 260 KB).");
})();
