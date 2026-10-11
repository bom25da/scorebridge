import { test } from "node:test";
import assert from "node:assert/strict";
import { run } from "../src/process.ts";
test("subprocess timeout and nonzero exit reject", async () => {
  await assert.rejects(
    run(process.execPath, ["-e", "setInterval(()=>{},1000)"], 100),
    /초과/,
  );
  await assert.rejects(
    run(process.execPath, ["-e", "process.exit(3)"]),
    /코드 3/,
  );
});
