import { Queue, Worker } from "bullmq";
import { randomUUID } from "node:crypto";
import {
  mkdir,
  readdir,
  readFile,
  writeFile,
  rm,
  access,
} from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { db, migrate, summarize } from "./db.ts";
import { data, redis, audiveris, pdfbin } from "./config.ts";
import { run } from "./process.ts";
import { musicXml } from "./music.ts";
await migrate();
const queue = new Queue("recognition", { connection: redis });
async function filesRecursive(dir: string): Promise<string[]> {
  let files: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    files.push(...(e.isDirectory() ? await filesRecursive(p) : [p]));
  }
  return files;
}
const worker = new Worker(
  "recognition",
  async (task) => {
    const { pageId, generation } = task.data;
    const row = (
      await db.query(
        "UPDATE pages SET state='PROCESSING',stage='이미지 준비',heartbeat=now() WHERE id=$1 AND generation=$2 AND state='QUEUED' RETURNING *",
        [pageId, generation],
      )
    ).rows[0];
    if (!row) return;
    const start = Date.now();
    const dir = path.join(data, row.job_id, pageId);
    const output = path.join(dir, `attempt-${generation}`);
    const beat = setInterval(
      () =>
        void db
          .query(
            "UPDATE pages SET heartbeat=now() WHERE id=$1 AND generation=$2",
            [pageId, generation],
          )
          .catch(console.error),
      5000,
    );
    try {
      await access(audiveris);
      await mkdir(output, { recursive: true });
      await db.query(
        "UPDATE pages SET stage='음표 인식' WHERE id=$1 AND generation=$2",
        [pageId, generation],
      );
      const log = await run(audiveris, [
        "-batch",
        "-export",
        "-output",
        output,
        "--",
        path.join(dir, "input.png"),
      ]);
      await writeFile(path.join(output, "engine.log"), log);
      await db.query(
        "UPDATE pages SET stage='악보 검증' WHERE id=$1 AND generation=$2",
        [pageId, generation],
      );
      const candidates = (await filesRecursive(output)).filter(
        (p) => /\.(mxl|musicxml|xml)$/.test(p) && !p.endsWith("container.xml"),
      );
      if (candidates.length !== 1)
        throw new Error(
          candidates.length
            ? "여러 악곡이 감지되었습니다. 악곡별로 나눠 업로드하세요."
            : "악보를 찾지 못했습니다. 선명한 인쇄 악보로 다시 시도하세요.",
        );
      const xml = musicXml(await readFile(candidates[0]));
      await writeFile(path.join(dir, `result-${generation}.musicxml`), xml);
      await db.query(
        "UPDATE pages SET state='SUCCEEDED',stage='완료',has_result=true,duration_ms=$3 WHERE id=$1 AND generation=$2",
        [pageId, generation, Date.now() - start],
      );
    } catch (e) {
      const message =
        (e as NodeJS.ErrnoException).code === "ENOENT"
          ? "Audiveris 엔진을 찾을 수 없습니다. 로컬 설치를 확인하세요."
          : (e as Error).message;
      await db.query(
        "UPDATE pages SET state='FAILED',stage='실패',error=$3,duration_ms=$4 WHERE id=$1 AND generation=$2",
        [pageId, generation, message, Date.now() - start],
      );
    } finally {
      clearInterval(beat);
      await rm(output, { recursive: true, force: true });
      await summarize(row.job_id);
    }
  },
  { connection: redis, concurrency: 1 },
);
worker.on("error", console.error);
let busy = false;
async function tick() {
  if (busy) return;
  busy = true;
  try {
    // A stale process is invalidated before being queued again, preventing old results from winning.
    const stale = (
      await db.query(
        "UPDATE pages SET state='QUEUED',stage='대기',generation=generation+1 WHERE state='PROCESSING' AND heartbeat<now()-interval '60 seconds' RETURNING id,generation",
      )
    ).rows;
    for (const p of stale)
      await db.query("INSERT INTO outbox(page_id,generation) VALUES($1,$2)", [
        p.id,
        p.generation,
      ]);
    for (const j of (
      await db.query(
        "SELECT * FROM jobs WHERE state='DELETING' OR created_at<now()-interval '7 days'",
      )
    ).rows) {
      await db.query("DELETE FROM jobs WHERE id=$1", [j.id]);
      await rm(path.join(data, j.id), { recursive: true, force: true });
    }
    for (const j of (
      await db.query("SELECT * FROM jobs WHERE state='PREPARING'")
    ).rows) {
      const dir = path.join(data, j.id);
      try {
        let images: string[] = [];
        try {
          await access(path.join(dir, "input.pdf"));
          await run(
            pdfbin,
            [
              "-f",
              "1",
              "-l",
              "6",
              "-r",
              "180",
              "-scale-to",
              "4000",
              "-png",
              path.join(dir, "input.pdf"),
              path.join(dir, "page"),
            ],
            60000,
          );
          images = (await readdir(dir))
            .filter((n) => /^page-.*\.png$/.test(n))
            .sort();
          if (!images.length || images.length > 5)
            throw new Error("PDF는 1~5페이지까지 지원합니다.");
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
          images = ["input.image"];
        }
        const client = await db.connect();
        try {
          await client.query("BEGIN");
          await client.query("DELETE FROM pages WHERE job_id=$1", [j.id]);
          for (const [index, image] of images.entries()) {
            const id = randomUUID();
            await mkdir(path.join(dir, id));
            await sharp(path.join(dir, image), { limitInputPixels: 30_000_000 })
              .rotate()
              .resize({
                width: 4000,
                height: 4000,
                fit: "inside",
                withoutEnlargement: true,
              })
              .flatten({ background: "#fff" })
              .png()
              .toFile(path.join(dir, id, "input.png"));
            await client.query(
              "INSERT INTO pages(id,job_id,index) VALUES($1,$2,$3)",
              [id, j.id, index],
            );
            await client.query(
              "INSERT INTO outbox(page_id,generation) VALUES($1,1)",
              [id],
            );
          }
          await client.query(
            "UPDATE jobs SET state='PROCESSING' WHERE id=$1 AND state='PREPARING'",
            [j.id],
          );
          await client.query("COMMIT");
        } catch (e) {
          await client.query("ROLLBACK");
          throw e;
        } finally {
          client.release();
        }
      } catch (e) {
        await db.query(
          "UPDATE jobs SET state='FAILED' WHERE id=$1 AND state='PREPARING'",
          [j.id],
        );
        const id = randomUUID();
        await db.query(
          "INSERT INTO pages(id,job_id,index,state,stage,error) VALUES($1,$2,0,'FAILED','입력 확인',$3)",
          [id, j.id, (e as Error).message],
        );
      }
    }
    for (const o of (
      await db.query(
        "SELECT * FROM outbox WHERE sent=false ORDER BY id LIMIT 30",
      )
    ).rows) {
      await queue.add(
        "recognize",
        { pageId: o.page_id, generation: o.generation },
        {
          jobId: `${o.page_id}-${o.generation}`,
          removeOnComplete: 100,
          removeOnFail: 100,
        },
      );
      await db.query("UPDATE outbox SET sent=true WHERE id=$1", [o.id]);
    }
  } catch (e) {
    console.error(e);
  } finally {
    busy = false;
  }
}
setInterval(() => void tick(), 1000);
await tick();
console.log("Scorebridge worker ready");
