import { mkdir, writeFile, cp, access } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
if (process.platform !== "darwin")
  throw new Error(
    "이 설치 스크립트는 macOS 전용입니다. 다른 OS에서는 AUDIVERIS_BIN을 설정하세요.",
  );
const version = "5.11.0",
  arch = process.arch === "arm64" ? "arm64" : "x86_64";
const local = path.resolve(".local"),
  mount = path.join(local, "engine-mount");
await mkdir(local, { recursive: true });
try {
  await access(path.join(local, "Audiveris.app"));
  console.log("Audiveris already installed");
  process.exit(0);
} catch {}
console.log(
  `Installing Audiveris ${version}. License: https://github.com/Audiveris/audiveris/blob/master/LICENSE`,
);
const r = await fetch(
  `https://github.com/Audiveris/audiveris/releases/download/${version}/Audiveris-${version}-macosx-${arch}.dmg`,
);
if (!r.ok) throw new Error("Engine download failed");
const dmg = path.join(local, "audiveris.dmg");
await writeFile(dmg, Buffer.from(await r.arrayBuffer()));
const attach = spawnSync(
  "hdiutil",
  ["attach", dmg, "-nobrowse", "-mountpoint", mount],
  { input: "Y\n", encoding: "utf8" },
);
if (attach.status !== 0)
  throw new Error(attach.stderr || "Engine mount failed");
try {
  await cp(
    path.join(mount, "Audiveris.app"),
    path.join(local, "Audiveris.app"),
    { recursive: true },
  );
} finally {
  spawnSync("hdiutil", ["detach", mount], { stdio: "ignore" });
}
console.log(
  "Audiveris installed. Run pnpm setup:local to create the CLI wrapper.",
);
