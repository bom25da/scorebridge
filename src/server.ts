import Fastify from "fastify";
import multipart from "@fastify/multipart";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { db, migrate } from "./db.ts";
import { data } from "./config.ts";
const app = Fastify({ logger: true, bodyLimit: 21 * 1024 * 1024 });
await migrate();
await mkdir(data, { recursive: true });
await app.register(multipart, {
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
});
app.addHook("onRequest", async (req, reply) => {
  const host = req.headers.host;
  if (!host || !/^localhost:|^127\.0\.0\.1:/.test(host))
    return reply.code(403).send({ message: "로컬에서만 사용할 수 있습니다." });
  const origin = req.headers.origin;
  if (origin && !/^http:\/\/(localhost|127\.0\.0\.1):(5173|3001)$/.test(origin))
    return reply.code(403).send({ message: "허용되지 않은 요청입니다." });
});
const idSchema = {
  type: "object",
  properties: { id: { type: "string", format: "uuid" } },
  required: ["id"],
};
app.get("/api/health", async () => {
  await db.query("SELECT 1");
  return { ok: true };
});
app.get("/api/jobs", async () => {
  return (
    await db.query("SELECT * FROM jobs ORDER BY created_at DESC LIMIT 50")
  ).rows;
});
app.get<{ Params: { id: string } }>(
  "/api/jobs/:id",
  { schema: { params: idSchema } },
  async (req, reply) => {
    const j = (
      await db.query("SELECT * FROM jobs WHERE id=$1", [req.params.id])
    ).rows[0];
    if (!j)
      return reply.code(404).send({ message: "작업을 찾을 수 없습니다." });
    j.pages = (
      await db.query(
        "SELECT id,index,state,stage,error,duration_ms,has_result FROM pages WHERE job_id=$1 ORDER BY index",
        [j.id],
      )
    ).rows;
    return j;
  },
);
app.post("/api/jobs", async (req, reply) => {
  const file = await req.file();
  if (!file)
    return reply.code(400).send({ message: "악보 파일을 선택하세요." });
  const buffer = await file.toBuffer();
  const isPdf = buffer.subarray(0, 5).toString() === "%PDF-";
  if (!isPdf) {
    const meta = await sharp(buffer, { limitInputPixels: 30_000_000 })
      .metadata()
      .catch(() => null);
    if (!meta || !["png", "jpeg"].includes(meta.format || ""))
      return reply
        .code(400)
        .send({ message: "JPG, PNG 또는 PDF만 지원합니다." });
  }
  const id = randomUUID();
  const dir = path.join(data, id);
  await mkdir(dir);
  await writeFile(path.join(dir, isPdf ? "input.pdf" : "input.image"), buffer);
  await db.query("INSERT INTO jobs(id,filename,state) VALUES($1,$2,$3)", [
    id,
    path.basename(file.filename).slice(0, 200),
    "PREPARING",
  ]);
  return reply.code(202).send({ id });
});
app.post<{ Params: { id: string } }>(
  "/api/jobs/:id/retry",
  { schema: { params: idSchema } },
  async (req, reply) => {
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const rows = (
        await client.query(
          "UPDATE pages SET state='QUEUED',stage='대기',error=null,generation=generation+1 WHERE job_id=$1 AND state='FAILED' RETURNING id,generation",
          [req.params.id],
        )
      ).rows;
      if (!rows.length) {
        await client.query("ROLLBACK");
        return reply
          .code(409)
          .send({ message: "재시도할 실패 페이지가 없습니다." });
      }
      for (const p of rows)
        await client.query(
          "INSERT INTO outbox(page_id,generation) VALUES($1,$2)",
          [p.id, p.generation],
        );
      await client.query("UPDATE jobs SET state='PROCESSING' WHERE id=$1", [
        req.params.id,
      ]);
      await client.query("COMMIT");
      return { ok: true };
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  },
);
app.get<{ Params: { id: string; pageId: string; kind: string } }>(
  "/api/jobs/:id/pages/:pageId/:kind",
  {
    schema: {
      params: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          pageId: { type: "string", format: "uuid" },
          kind: { enum: ["image", "musicxml"] },
        },
        required: ["id", "pageId", "kind"],
      },
    },
  },
  async (req, reply) => {
    const { id, pageId, kind } = req.params;
    const p = (
      await db.query(
        "SELECT p.* FROM pages p JOIN jobs j ON j.id=p.job_id WHERE p.id=$1 AND p.job_id=$2 AND j.state<>'DELETING'",
        [pageId, id],
      )
    ).rows[0];
    if (!p || (kind === "musicxml" && !p.has_result))
      return reply.code(404).send({ message: "결과를 찾을 수 없습니다." });
    const file = path.join(
      data,
      id,
      pageId,
      kind === "image" ? "input.png" : `result-${p.generation}.musicxml`,
    );
    if (kind === "musicxml" && req.query && "download" in (req.query as object))
      reply.header(
        "Content-Disposition",
        `attachment; filename="scorebridge-page-${p.index + 1}.musicxml"`,
      );
    reply.type(
      kind === "image" ? "image/png" : "application/vnd.recordare.musicxml+xml",
    );
    return await readFile(file);
  },
);
app.delete<{ Params: { id: string } }>(
  "/api/jobs/:id",
  { schema: { params: idSchema } },
  async (req, reply) => {
    const exists = (
      await db.query(
        "UPDATE jobs SET state='DELETING' WHERE id=$1 RETURNING id",
        [req.params.id],
      )
    ).rowCount;
    if (!exists)
      return reply.code(404).send({ message: "작업을 찾을 수 없습니다." });
    await db.query("UPDATE pages SET generation=generation+1 WHERE job_id=$1", [
      req.params.id,
    ]);
    return reply.code(202).send({ ok: true });
  },
);
app.setErrorHandler((error, req, reply) => {
  const e = error as { statusCode?: number; code?: string };
  req.log.error(error);
  reply
    .code(e.statusCode || 400)
    .send({
      message:
        e.code === "FST_REQ_FILE_TOO_LARGE"
          ? "파일은 20MB 이하로 업로드하세요."
          : "요청을 처리하지 못했습니다. 파일 형식과 크기를 확인하세요.",
    });
});
await app.listen({ host: "127.0.0.1", port: 3001 });
