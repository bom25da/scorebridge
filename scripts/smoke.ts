import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { XMLParser } from "fast-xml-parser";
const base = "http://127.0.0.1:3001";
async function submit(filename: string, buffer: Buffer) {
  const body = new FormData();
  body.append("file", new Blob([new Uint8Array(buffer)]), filename);
  const r = await fetch(`${base}/api/jobs`, { method: "POST", body });
  assert.equal(r.status, 202);
  return (await r.json()).id as string;
}
async function wait(id: string) {
  for (let i = 0; i < 200; i++) {
    const j = await (await fetch(`${base}/api/jobs/${id}`)).json();
    if (["COMPLETED", "PARTIAL", "FAILED"].includes(j.state)) return j;
    await sleep(1000);
  }
  throw new Error("Recognition timeout");
}
const image = await submit(
  "smoke.png",
  await readFile("fixtures/scores/simple.png"),
);
const j = await wait(image);
assert.equal(j.state, "COMPLETED", JSON.stringify(j));
const download = await fetch(
  `${base}/api/jobs/${image}/pages/${j.pages[0].id}/musicxml?download=1`,
);
assert.equal(download.status, 200);
assert.match(download.headers.get("content-disposition")!, /attachment/);
const xml = await download.text();
const score = new XMLParser().parse(xml)["score-partwise"];
assert.equal(score.part.measure.length, 4);
console.log(
  "PNG + MusicXML download + 4 measures PASS",
  j.pages[0].duration_ms,
);
const pdf = await submit(
  "smoke.pdf",
  await readFile("fixtures/scores/simple.pdf"),
);
const jp = await wait(pdf);
assert.equal(jp.state, "COMPLETED", JSON.stringify(jp));
console.log("PDF real recognition PASS");
const bad = new FormData();
bad.append("file", new Blob(["not an image"]), "fake.png");
assert.equal(
  (await fetch(`${base}/api/jobs`, { method: "POST", body: bad })).status,
  400,
);
console.log("Invalid input rejected PASS");
assert.equal(
  (
    await fetch(`${base}/api/jobs`, {
      headers: { Origin: "https://example.com" },
    })
  ).status,
  403,
);
console.log("Cross-origin requests rejected PASS");
for (const id of [image, pdf]) {
  assert.equal(
    (await fetch(`${base}/api/jobs/${id}`, { method: "DELETE" })).status,
    202,
  );
  await sleep(1500);
  assert.equal((await fetch(`${base}/api/jobs/${id}`)).status, 404);
}
console.log("Deletion PASS");
