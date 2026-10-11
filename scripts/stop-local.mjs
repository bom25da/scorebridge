import { spawnSync } from "node:child_process";
import path from "node:path";
const pg = process.env.PG_BIN_DIR || "/opt/homebrew/opt/postgresql@17/bin";
spawnSync(
  path.join(pg, "pg_ctl"),
  ["-D", path.resolve(".local/postgres"), "-m", "fast", "stop"],
  { stdio: "inherit" },
);
spawnSync("/opt/homebrew/bin/redis-cli", ["-p", "56379", "shutdown"], {
  stdio: "inherit",
});
