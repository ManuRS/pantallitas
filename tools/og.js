// Genera og.png (1200×630) a partir de tools/og.html. Necesita Playwright (el de tests/: cd tests && npm install).
const path = require("path");
const { chromium } = require(path.join(__dirname, "../tests/node_modules/playwright"));
(async () => {
  const browser = await chromium.launch({ channel: "chrome" }) // el Chrome instalado, como las pruebas;
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await page.goto("file://" + path.join(__dirname, "og.html"));
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(__dirname, "../og.png") });
  await browser.close();
})();
