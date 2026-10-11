import path from "node:path";
import os from "node:os";
import { existsSync } from "node:fs";
export const root = process.cwd();
export const data = path.resolve(root, ".local/data");
export const database =
  process.env.DATABASE_URL || "postgresql://localhost:55432/scorebridge";
export const redis = {
  host: "127.0.0.1",
  port: Number(process.env.REDIS_PORT || 56379),
};
export const audiveris =
  process.env.AUDIVERIS_BIN || path.join(root, ".local/audiveris");
const bundledPdf = path.join(
  os.homedir(),
  ".cache/codex-runtimes/codex-primary-runtime/dependencies/bin/override/pdftoppm",
);
export const pdfbin =
  process.env.PDFTOPPM_BIN ||
  (existsSync(bundledPdf) ? bundledPdf : "pdftoppm");
