import { mkdirSync, existsSync, writeFileSync, chmodSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
const local = path.join(process.cwd(), ".local");
mkdirSync(local, { recursive: true });
const pg = process.env.PG_BIN_DIR || "/opt/homebrew/opt/postgresql@17/bin";
function run(bin, args) {
  const r = spawnSync(bin, args, { stdio: "inherit" });
  if (r.error || r.status !== 0) throw r.error || new Error(`${bin} failed`);
}
const cluster = path.join(local, "postgres");
if (!existsSync(path.join(cluster, "PG_VERSION")))
  run(path.join(pg, "initdb"), [
    "-D",
    cluster,
    "--encoding=UTF8",
    "--locale=C",
    "--auth-local=trust",
    "--auth-host=trust",
  ]);
if (
  spawnSync(path.join(pg, "pg_ctl"), ["-D", cluster, "status"], {
    stdio: "ignore",
  }).status !== 0
)
  run(path.join(pg, "pg_ctl"), [
    "-D",
    cluster,
    "-l",
    path.join(local, "postgres.log"),
    "-o",
    `-p 55432 -h 127.0.0.1 -k ${local}`,
    "start",
  ]);
if (
  spawnSync(
    path.join(pg, "psql"),
    ["-h", "127.0.0.1", "-p", "55432", "-d", "scorebridge", "-c", "SELECT 1"],
    { stdio: "ignore" },
  ).status !== 0
)
  run(path.join(pg, "createdb"), [
    "-h",
    "127.0.0.1",
    "-p",
    "55432",
    "scorebridge",
  ]);
const redis = process.env.REDIS_BIN || "/opt/homebrew/bin/redis-server";
const cli = redis.replace("redis-server", "redis-cli");
if (spawnSync(cli, ["-p", "56379", "ping"], { stdio: "ignore" }).status !== 0)
  run(redis, [
    "--bind",
    "127.0.0.1",
    "--port",
    "56379",
    "--daemonize",
    "yes",
    "--appendonly",
    "yes",
    "--appendfsync",
    "everysec",
    "--dir",
    local,
    "--logfile",
    path.join(local, "redis.log"),
    "--pidfile",
    path.join(local, "redis.pid"),
    "--maxmemory",
    "256mb",
    "--maxmemory-policy",
    "noeviction",
  ]);
console.log("PostgreSQL :55432 / Redis :56379 ready. Run pnpm dev.");
if (existsSync(path.join(local, "Audiveris.app"))) {
  const wrapper = path.join(local, "audiveris");
  writeFileSync(
    wrapper,
    '#!/bin/sh\nBASE="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/Audiveris.app/Contents"\nexec "$BASE/runtime/Contents/Home/bin/java" -Djava.awt.headless=true -Xmx4G --add-exports=java.desktop/sun.awt.image=ALL-UNNAMED --enable-native-access=ALL-UNNAMED -Dfile.encoding=UTF-8 -cp "$BASE/app/*" Audiveris "$@"\n',
  );
  chmodSync(wrapper, 0o755);
}
