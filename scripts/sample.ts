import { chromium } from "playwright";
import { readFile } from "node:fs/promises";
const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1300, height: 800 },
  deviceScaleFactor: 2,
});
await page.setContent(
  '<html><body style="margin:40px;background:white"><div id="score"></div></body></html>',
);
await page.addScriptTag({
  path: "node_modules/opensheetmusicdisplay/build/opensheetmusicdisplay.min.js",
});
await page.evaluate(
  async (xml) => {
    const osmd = new (
      window as any
    ).opensheetmusicdisplay.OpenSheetMusicDisplay(
      document.getElementById("score"),
      { backend: "svg", autoResize: false },
    );
    await osmd.load(xml);
    osmd.render();
  },
  await readFile("fixtures/scores/simple.musicxml", "utf8"),
);
await page.locator("#score").screenshot({ path: "fixtures/scores/simple.png" });
await page.pdf({
  path: "fixtures/scores/simple.pdf",
  format: "A4",
  landscape: true,
  printBackground: true,
});
await browser.close();
console.log("Self-authored PNG / PDF fixtures generated");
