import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { OpenSheetMusicDisplay } from "opensheetmusicdisplay";
import type { Job } from "../contracts";
import "./style.css";
async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const r = await fetch(url, options);
  if (!r.ok) {
    const e = await r
      .json()
      .catch(() => ({ message: "서버에 연결하지 못했습니다." }));
    throw new Error(e.message);
  }
  return r.json();
}
function Score({ url }: { url: string }) {
  const el = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    setError("");
    const display = new OpenSheetMusicDisplay(el.current!, {
      autoResize: true,
      backend: "svg",
    });
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error("악보를 불러오지 못했습니다.");
        return r.text();
      })
      .then(async (xml) => {
        if (!alive) return;
        await display.load(xml);
        if (alive) display.render();
      })
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
      display.clear();
    };
  }, [url]);
  return (
    <>
      {error && <p role="alert">{error}</p>}
      <div className="score" ref={el} />
    </>
  );
}
const labels: Record<string, string> = {
  PREPARING: "입력 준비 중",
  QUEUED: "대기 중",
  PROCESSING: "변환 중",
  COMPLETED: "변환 완료",
  PARTIAL: "일부 완료",
  FAILED: "변환 실패",
};
function App() {
  const [jobs, setJobs] = useState<Job[]>([]),
    [job, setJob] = useState<Job | null>(null),
    [page, setPage] = useState(0),
    [file, setFile] = useState<File | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null),
    activeId = useRef<string | null>(localStorage.getItem("scorebridge-job"));
  const [zoom, setZoom] = useState(100);
  async function refresh() {
    try {
      setJobs(await api<Job[]>("/api/jobs"));
      if (activeId.current) {
        const j = await api<Job>(`/api/jobs/${activeId.current}`);
        if (activeId.current === j.id) setJob(j);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void refresh();
    const t = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 2000);
    return () => clearInterval(t);
  }, []);
  function select(id: string) {
    activeId.current = id;
    localStorage.setItem("scorebridge-job", id);
    setPage(0);
    setError("");
    void refresh();
  }
  async function upload() {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const body = new FormData();
      body.append("file", file);
      const j = await api<{ id: string }>("/api/jobs", {
        method: "POST",
        body,
      });
      select(j.id);
      setFile(null);
      if (input.current) input.current.value = "";
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function retry() {
    setError("");
    try {
      await api(`/api/jobs/${job!.id}/retry`, { method: "POST" });
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function remove() {
    if (!job || !confirm("원본과 변환 결과를 삭제할까요?")) return;
    try {
      await api(`/api/jobs/${job.id}`, { method: "DELETE" });
      activeId.current = null;
      localStorage.removeItem("scorebridge-job");
      setJob(null);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const p = job?.pages?.[page],
    base = p ? `/api/jobs/${job!.id}/pages/${p.id}` : "";
  return (
    <>
      <header>
        <a className="brand" href="/">
          𝄞 <span>scorebridge</span>
        </a>
        <span className="local">LOCAL WORKSPACE</span>
      </header>
      <main>
        <section className="intro">
          <div>
            <p className="eyebrow">FROM PAPER TO POSSIBILITY</p>
            <h1>
              종이 위의 음악을,
              <br />
              다시 편집할 수 있도록.
            </h1>
            <p className="lead">
              악보를 올리고, 변환 결과를 확인하세요.
              <br />
              MusicXML로 내려받아 익숙한 편집기에서 이어갈 수 있습니다.
            </p>
          </div>
          <div
            className="upload"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              setFile(e.dataTransfer.files[0] || null);
            }}
          >
            <span className="uploadmark" aria-hidden="true">
              ↑
            </span>
            <h2>악보 파일 추가</h2>
            <p>선명한 인쇄 악보로 시작하세요.</p>
            <label className="filelabel">
              파일 선택
              <input
                ref={input}
                type="file"
                accept="image/png,image/jpeg,application/pdf"
                onChange={(e) => {
                  setFile(e.target.files?.[0] || null);
                  setError("");
                }}
              />
            </label>
            <p className="filename">
              {file?.name || "파일을 끌어 놓거나 선택하세요"}
            </p>
            <button
              className="primary"
              disabled={!file || busy}
              onClick={() => void upload()}
            >
              {busy ? "업로드 중…" : "악보 변환하기"}{" "}
              <span aria-hidden="true">→</span>
            </button>
            <small>JPG · PNG · PDF / 최대 20MB · 5페이지</small>
          </div>
        </section>
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        <section className="workspace">
          <aside>
            <div className="sectiontitle">
              <h2>작업 이력</h2>
              <span>{jobs.length}</span>
            </div>
            {jobs.length === 0 ? (
              <p className="empty">
                첫 악보를 올리면
                <br />
                작업이 여기에 나타납니다.
              </p>
            ) : (
              jobs.map((j) => (
                <button
                  key={j.id}
                  className={`history ${j.id === job?.id ? "selected" : ""}`}
                  onClick={() => select(j.id)}
                >
                  <strong>{j.filename}</strong>
                  <span>{labels[j.state] || j.state}</span>
                  <small>
                    {new Date(j.created_at).toLocaleString("ko-KR")}
                  </small>
                </button>
              ))
            )}
            <p className="asidehint">
              파일은 이 컴퓨터에 저장되며
              <br />
              7일 후 자동으로 정리됩니다.
            </p>
          </aside>
          <div className="result">
            <div className="resulthead">
              <div>
                <p className="eyebrow">REVIEW YOUR SCORE</p>
                <h2>{job ? job.filename : "변환 결과"}</h2>
              </div>
              {job && (
                <button className="quiet" onClick={() => void remove()}>
                  작업 삭제
                </button>
              )}
            </div>
            {!job ? (
              <div className="placeholder">
                <span aria-hidden="true">𝄞</span>
                <h3>새로운 악보를 기다리고 있어요</h3>
                <p>업로드한 원본과 변환된 악보를 나란히 확인할 수 있습니다.</p>
              </div>
            ) : (
              <>
                <div className="toolbar">
                  <span className="status" role="status">
                    {labels[job.state] || job.state}
                  </span>
                  {job.pages?.length > 0 && (
                    <label>
                      페이지{" "}
                      <select
                        value={page}
                        onChange={(e) => {
                          setPage(Number(e.target.value));
                          setZoom(100);
                        }}
                      >
                        {job.pages.map((p, i) => (
                          <option value={i} key={p.id}>
                            {i + 1} / {job.pages.length}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {p?.has_result && (
                    <a
                      className="download"
                      href={`${base}/musicxml?download=1`}
                    >
                      MusicXML 다운로드 ↓
                    </a>
                  )}
                </div>
                {p?.error && (
                  <div className="error" role="alert">
                    {p.error}
                    <button onClick={() => void retry()}>
                      실패 페이지 재시도
                    </button>
                  </div>
                )}
                {p && (
                  <div className="panels">
                    <section>
                      <div className="paneltitle">
                        <h3>원본 악보</h3>
                        <label>
                          확대{" "}
                          <select
                            value={zoom}
                            onChange={(e) => setZoom(Number(e.target.value))}
                          >
                            <option>100</option>
                            <option>150</option>
                            <option>200</option>
                          </select>
                          %
                        </label>
                      </div>
                      <div className="imageviewport">
                        <img
                          style={{ width: `${zoom}%` }}
                          src={`${base}/image`}
                          alt={`${page + 1}페이지 원본 악보`}
                        />
                      </div>
                    </section>
                    <section>
                      <div className="paneltitle">
                        <h3>디지털 악보</h3>
                        <span>
                          {p.duration_ms
                            ? `${(p.duration_ms / 1000).toFixed(1)}초`
                            : p.stage}
                        </span>
                      </div>
                      {p.has_result ? (
                        <Score key={base} url={`${base}/musicxml`} />
                      ) : (
                        <div className="processing" aria-live="polite">
                          {p.state === "FAILED"
                            ? "결과를 만들지 못했습니다."
                            : `${p.stage}…`}
                        </div>
                      )}
                    </section>
                  </div>
                )}
                {!p && (
                  <div className="processing" role="status">
                    페이지를 준비하고 있습니다…
                  </div>
                )}
                <p className="resultnote">
                  인식 결과에는 오류가 있을 수 있습니다. 음높이와 리듬을 원본과
                  비교한 뒤 사용하세요.
                </p>
              </>
            )}
          </div>
        </section>
      </main>
      <footer>
        <span>Scorebridge</span>
        <span>이미지에서 편집 가능한 악보로 · Local PoC</span>
      </footer>
    </>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
