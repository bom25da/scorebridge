import { spawn, type ChildProcess } from "node:child_process";
const active = new Set<ChildProcess>();
function terminate(child: ChildProcess) {
  try {
    if (child.pid && process.platform !== "win32")
      process.kill(-child.pid, "SIGKILL");
    else child.kill("SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
}
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    for (const child of active) terminate(child);
    process.exit(0);
  });
}
export function run(
  command: string,
  args: string[],
  timeout = 180000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    active.add(child);
    let text = "";
    let done = false;
    const finish = (error?: Error) => {
      if (done) return;
      done = true;
      active.delete(child);
      clearTimeout(timer);
      error ? reject(error) : resolve(text);
    };
    const timer = setTimeout(() => {
      terminate(child);
      finish(
        new Error(
          "처리 시간이 초과되었습니다. 더 선명하거나 작은 악보로 다시 시도하세요.",
        ),
      );
    }, timeout);
    child.stdout.on("data", (d) => (text = (text + d).slice(-20000)));
    child.stderr.on("data", (d) => (text = (text + d).slice(-20000)));
    child.on("error", (e) => finish(e));
    child.on("close", (code) =>
      finish(
        code === 0
          ? undefined
          : new Error(`인식 엔진 실행에 실패했습니다 (종료 코드 ${code}).`),
      ),
    );
  });
}
