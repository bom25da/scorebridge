import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { zipSync, strToU8 } from "fflate";
import { musicXml } from "../src/music.ts";
test("MusicXML and MXL preserve the score", async () => {
  const original = await readFile("fixtures/scores/simple.musicxml");
  const xml = musicXml(original);
  assert.match(xml, /<score-partwise/);
  const compressed = zipSync({
    "META-INF/container.xml": strToU8(
      '<container><rootfiles><rootfile full-path="score.xml"/></rootfiles></container>',
    ),
    "score.xml": original,
  });
  assert.equal(musicXml(Buffer.from(compressed)), xml);
});
test("malformed XML and custom entities are rejected", () => {
  assert.throws(() => musicXml(Buffer.from("<score-partwise>")));
  assert.throws(() =>
    musicXml(
      Buffer.from(
        '<!DOCTYPE score [<!ENTITY x SYSTEM "file:///etc/passwd">]><score-partwise>&x;</score-partwise>',
      ),
    ),
  );
});
