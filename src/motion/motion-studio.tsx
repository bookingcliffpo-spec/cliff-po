"use client";

import { useEffect, useRef, useState, type DragEvent, type ReactNode } from "react";

import type { ReferenceTag } from "@/generation/catalog/types";
import { fileNameFor, saveFile } from "@/openhiggsfield/download";
import { timeAgo, type RunRecord } from "@/openhiggsfield/history";
import { LOOKS } from "@/simple/looks";
import { ASPECTS, RESTYLES, type Target } from "@/simple/plan";
import { ACTIONS, TAGS } from "@/simple/simple-studio";
import { useStudio, type Slot, type Upload } from "@/simple/use-studio";

/** The mobile-first home page: Jobs / Video / Image / Assets tabs, a model
    card, the prompt, Settings · Media · Upload panels, Generate with a batch
    count, and the active jobs list. Same engine as the Simple page. */

type View = "jobs" | "video" | "image" | "assets";
type Panel = "settings" | "media" | "upload";

const MODEL_INFO: Record<Target, { name: string; badge: string }> = {
  "video-free": { name: "WanGP Video", badge: "Free" },
  "video-seedance": { name: "Seedance 2.5", badge: "2.5" },
  "image-free": { name: "Flux Image", badge: "Free" },
  demo: { name: "Demo", badge: "Test" },
};

const BATCH = [1, 2, 3, 4] as const;

export function MotionStudio({ fontClassName = "" }: { fontClassName?: string }) {
  const s = useStudio();
  const [view, setView] = useState<View>("jobs");
  const [panel, setPanel] = useState<Panel>("settings");
  const [modelsOpen, setModelsOpen] = useState(false);
  const [batch, setBatch] = useState<(typeof BATCH)[number]>(1);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const slotRef = useRef<HTMLInputElement>(null);
  const slotTarget = useRef<Slot>("main");
  const modelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!modelsOpen) return;
    const close = (event: PointerEvent) => {
      if (!modelRef.current?.contains(event.target as Node)) setModelsOpen(false);
    };
    const esc = (event: KeyboardEvent) => event.key === "Escape" && setModelsOpen(false);
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [modelsOpen]);

  const info = MODEL_INFO[s.target];
  const mode = !s.video
    ? "Text → Image"
    : s.mainVideo
      ? "Video → Video"
      : s.images.length || s.start
        ? "Image → Video"
        : "Text → Video";

  const running = s.history.filter((r) => r.status === "running");
  const finished = s.history.filter((r) => r.status !== "running");
  const videos = finished.filter((r) => r.status === "completed" && r.kind === "video");
  const pictures = finished.filter((r) => r.status === "completed" && r.kind !== "video");

  function pickFiles() {
    if (s.uploadsOff) {
      setPanel("upload");
      return;
    }
    fileRef.current?.click();
  }

  function pickFor(slot: Slot) {
    slotTarget.current = slot;
    const input = slotRef.current;
    if (!input) return;
    input.accept = slot === "audio" ? "audio/wav,audio/x-wav" : "image/jpeg,image/png,image/webp,image/gif";
    input.click();
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    if (!s.uploadsOff) s.addFiles(event.dataTransfer.files);
  }

  const label = s.submitting ? "Starting…" : s.uploading ? "Uploading…" : "Generate";

  return (
    <div className={`mo ${fontClassName}`}>
      <div className="mo-wrap">
        <header className="mo-top">
          <span className="mo-logo" aria-hidden>
            <Sparkle />
          </span>
          <nav className="mo-tabs" role="tablist" aria-label="Sections">
            {(
              [
                ["jobs", "Jobs", <PulseIcon key="j" />],
                ["video", "Video", <FilmIcon key="v" />],
                ["image", "Image", <ImageIcon key="i" />],
                ["assets", "Assets", <LayersIcon key="a" />],
              ] as Array<[View, string, ReactNode]>
            ).map(([id, text, icon]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={view === id}
                className="mo-tab"
                onClick={() => setView(id)}
              >
                {icon}
                {text}
                {id === "jobs" && running.length > 0 && <span className="mo-count">{running.length}</span>}
              </button>
            ))}
          </nav>
        </header>

        {view === "jobs" && (
          <main className="mo-main">
            <div className="mo-model" ref={modelRef}>
              <button
                type="button"
                className="mo-card mo-model-btn"
                aria-haspopup="listbox"
                aria-expanded={modelsOpen}
                aria-label={`Model: ${info.name}`}
                onClick={() => setModelsOpen((open) => !open)}
              >
                <span className="mo-model-icon" aria-hidden>
                  <Sparkle />
                </span>
                <span className="mo-model-text">
                  <span className="mo-model-name">{info.name}</span>
                  <span className="mo-model-mode">{mode}</span>
                </span>
                <span className="mo-badge">{info.badge}</span>
                <Chevron open={modelsOpen} />
              </button>
              {modelsOpen && (
                <ul className="mo-card mo-models" role="listbox" aria-label="Models">
                  {s.targets.map((t) => (
                    <li key={t.id}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={t.id === s.target}
                        className="mo-option"
                        onClick={() => {
                          s.setTarget(t.id);
                          setModelsOpen(false);
                        }}
                      >
                        <span className="mo-option-name">
                          {MODEL_INFO[t.id].name}
                          <span className="mo-badge">{MODEL_INFO[t.id].badge}</span>
                        </span>
                        <span className="mo-option-hint">{t.hint}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <label className="mo-card mo-prompt-box">
              <textarea
                className="mo-prompt"
                aria-label="Prompt"
                rows={4}
                maxLength={2000}
                value={s.prompt}
                placeholder={
                  s.mainVideo
                    ? "What should change? e.g. make it snow"
                    : s.video
                      ? "Describe your shot…  ⌘/Ctrl + Enter"
                      : "Describe your picture…  ⌘/Ctrl + Enter"
                }
                onChange={(event) => s.setPrompt(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.repeat) {
                    event.preventDefault();
                    void s.generate(batch);
                  }
                }}
              />
              <span className="mo-chars" aria-hidden>
                {s.prompt.length}
              </span>
            </label>

            {s.uploads.length > 0 && (
              <ul className="mo-strip" aria-label="Your uploads">
                {s.uploads.map((u) => (
                  <Thumb key={u.id} upload={u} onRemove={() => s.removeUpload(u.id)} />
                ))}
              </ul>
            )}

            <div className="mo-panels" role="tablist" aria-label="Options">
              {(
                [
                  ["settings", "Settings", <SlidersIcon key="s" />],
                  ["media", "Media", <ClipIcon key="m" />],
                  ["upload", "Upload", <UploadIcon key="u" />],
                ] as Array<[Panel, string, ReactNode]>
              ).map(([id, text, icon]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={panel === id}
                  className="mo-panel-tab"
                  onClick={() => setPanel(id)}
                >
                  {icon}
                  {text}
                </button>
              ))}
            </div>

            <section className="mo-card mo-panel" aria-label={panel}>
              {panel === "settings" && (
                <>
                  <Group label="Aspect ratio">
                    {ASPECTS.filter((a) => s.video || a !== "21:9").map((a) => (
                      <Chip key={a} on={s.aspect === a} onClick={() => s.setAspect(a)}>
                        {a}
                      </Chip>
                    ))}
                  </Group>
                  {s.video && (
                    <>
                      <Group label="Resolution">
                        {(["480p", "720p"] as const).map((r) => (
                          <Chip key={r} on={s.resolution === r} onClick={() => s.setResolution(r)}>
                            {r}
                          </Chip>
                        ))}
                      </Group>
                      <div className="mo-group">
                        <div className="mo-group-head">
                          <span className="mo-label">Duration</span>
                          <span className="mo-value">{s.duration}s</span>
                        </div>
                        <input
                          type="range"
                          className="mo-range"
                          aria-label="Duration"
                          min={4}
                          max={30}
                          step={1}
                          value={s.duration}
                          style={{ "--fill": `${((s.duration - 4) / 26) * 100}%` } as React.CSSProperties}
                          onChange={(event) => s.setDuration(Number(event.target.value))}
                        />
                        <div className="mo-range-ends" aria-hidden>
                          <span>4s</span>
                          <span>30s</span>
                        </div>
                      </div>
                      <div className="mo-group mo-row">
                        <span className="mo-label">Audio</span>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={s.sound}
                          aria-label="Audio"
                          className="mo-switch"
                          onClick={() => s.setSound(!s.sound)}
                        >
                          <span />
                        </button>
                      </div>
                      <Group label="Cinematic look" scroll>
                        {Object.entries(LOOKS).map(([id, l]) => (
                          <Chip key={id} on={s.look === id} onClick={() => s.setLook(id)}>
                            {l.label}
                          </Chip>
                        ))}
                      </Group>
                    </>
                  )}
                </>
              )}

              {panel === "media" && (
                <>
                  {s.mainVideo && s.video && (
                    <Group label="Use my video to">
                      {ACTIONS.map(([id, text]) => (
                        <Chip key={id} on={s.videoAction === id} onClick={() => s.setVideoAction(id)}>
                          {text}
                        </Chip>
                      ))}
                    </Group>
                  )}
                  {s.mainVideo && s.videoAction === "restyle" && (
                    <Group label="Style">
                      {RESTYLES.map(([id, text]) => (
                        <Chip key={id} on={s.restyle === id} onClick={() => s.setRestyle(id)}>
                          {text}
                        </Chip>
                      ))}
                    </Group>
                  )}
                  {s.video && !s.uploadsOff && (
                    <div className="mo-group">
                      <span className="mo-label">Frames &amp; sound</span>
                      <div className="mo-slots">
                        <SlotTile label="Start frame" upload={s.start} onPick={() => pickFor("start")} onClear={() => s.setStart(null)} />
                        <SlotTile label="End frame" upload={s.end} onPick={() => pickFor("end")} onClear={() => s.setEnd(null)} />
                        <SlotTile label="Audio" upload={s.audio} onPick={() => pickFor("audio")} onClear={() => s.setAudio(null)} />
                      </div>
                    </div>
                  )}
                  {s.images.length > 0 && s.video && (
                    <div className="mo-group">
                      <span className="mo-label">What are your images?</span>
                      <ul className="mo-roles">
                        {s.images.map((u) => (
                          <li key={u.id}>
                            {/* eslint-disable-next-line @next/next/no-img-element -- local preview */}
                            <img src={u.preview} alt="" />
                            <select
                              className="mo-select"
                              aria-label={`Role of ${u.name}`}
                              value={u.tag ?? ""}
                              onChange={(event) => s.tagUpload(u.id, (event.target.value || undefined) as ReferenceTag | undefined)}
                            >
                              {TAGS.map(([id, text]) => (
                                <option key={id} value={id}>
                                  {text}
                                </option>
                              ))}
                            </select>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {!s.video && <p className="mo-muted">Image models here use your prompt only.</p>}
                  {s.video && s.uploads.length === 0 && s.uploadsOff && (
                    <p className="mo-muted">Photos and videos need upload storage or the free studio on your PC — see Upload.</p>
                  )}
                  {s.video && s.uploads.length === 0 && !s.uploadsOff && (
                    <p className="mo-muted">Upload a photo or video to use it as a character, frame or source clip.</p>
                  )}
                </>
              )}

              {panel === "upload" &&
                (s.uploadsOff ? (
                  <div className="mo-setup">
                    <strong>Uploads aren&rsquo;t switched on for this site yet</strong>
                    <p>
                      Free video from your photos runs on your own PC: install{" "}
                      <a href="https://github.com/deepbeepmeep/Wan2GP" target="_blank" rel="noopener">
                        WanGP
                      </a>
                      , run <code>start-free-studio</code>, then open the address it prints on your phone.
                    </p>
                    <p className="mo-muted">
                      Site owner: connect upload storage in Vercel → Storage (Blob or Supabase), then redeploy.
                    </p>
                  </div>
                ) : (
                  <div
                    className="mo-drop"
                    role="button"
                    tabIndex={0}
                    aria-label="Upload images or a video"
                    data-dragging={dragging}
                    onClick={pickFiles}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        pickFiles();
                      }
                    }}
                    onDragOver={(event) => {
                      event.preventDefault();
                      setDragging(true);
                    }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={onDrop}
                  >
                    <UploadIcon />
                    <strong>Tap to add photos or a video</strong>
                    <span>JPEG, PNG, WebP or MP4 · from your camera roll or files</span>
                  </div>
                ))}
            </section>

            {s.error && (
              <div className="mo-alert" role="alert">
                <span>{s.error}</span>
                <button type="button" aria-label="Dismiss" onClick={() => s.setError(null)}>
                  ×
                </button>
              </div>
            )}

            <div className="mo-go">
              <button
                type="button"
                className="mo-generate"
                aria-label="Generate"
                disabled={!s.ready}
                onClick={() => void s.generate(batch)}
              >
                <Sparkle />
                {label}
              </button>
              <button
                type="button"
                className="mo-card mo-batch"
                aria-label={`Batch size ${batch}`}
                title="How many to make per press"
                onClick={() => setBatch((b) => BATCH[(BATCH.indexOf(b) + 1) % BATCH.length]!)}
              >
                <LayersIcon />
                {batch}×
              </button>
            </div>
            <p className="mo-status" aria-live="polite">
              {s.plan ? `→ ${s.plan.summary}` : s.status ? s.planProblem : "Connecting…"}
              {s.plan?.notes.map((note) => (
                <span key={note} className="mo-note">
                  {note}
                </span>
              ))}
            </p>

            <section className="mo-card mo-jobs" aria-label="Active jobs">
              <h2>
                <PulseIcon /> Active Jobs
                {running.length > 0 && <span className="mo-count">{running.length}</span>}
              </h2>
              {running.length === 0 ? (
                <p className="mo-muted">No jobs running. Results land in Video and Image.</p>
              ) : (
                <ul className="mo-job-list">
                  {running.map((row) => (
                    <JobRow key={row.id} row={row} onCancel={s.cancel} />
                  ))}
                </ul>
              )}
            </section>

            {finished.length > 0 && (
              <section className="mo-recent" aria-label="Recent">
                <h2>Recent</h2>
                <ul className="mo-grid">
                  {finished.slice(0, 6).map((row) => (
                    <ResultTile key={row.id} row={row} onDelete={() => s.deleteRun(row.id)} onReuse={() => s.setPrompt(row.prompt)} />
                  ))}
                </ul>
              </section>
            )}
          </main>
        )}

        {(view === "video" || view === "image") && (
          <main className="mo-main">
            {(view === "video" ? videos : pictures).length === 0 ? (
              <Empty view={view} onStart={() => setView("jobs")} />
            ) : (
              <ul className="mo-grid">
                {(view === "video" ? videos : pictures).map((row) => (
                  <ResultTile
                    key={row.id}
                    row={row}
                    onDelete={() => s.deleteRun(row.id)}
                    onReuse={() => {
                      s.setPrompt(row.prompt);
                      setView("jobs");
                    }}
                  />
                ))}
              </ul>
            )}
          </main>
        )}

        {view === "assets" && (
          <main className="mo-main">
            {s.uploads.length === 0 ? (
              <div className="mo-card mo-empty">
                <LayersIcon />
                <strong>No assets yet</strong>
                <span>Photos and videos you upload appear here, ready to reuse.</span>
                <button
                  type="button"
                  className="mo-ghost"
                  onClick={() => {
                    setView("jobs");
                    setPanel("upload");
                  }}
                >
                  Upload
                </button>
              </div>
            ) : (
              <ul className="mo-grid">
                {s.uploads.map((u) => (
                  <Thumb key={u.id} upload={u} large onRemove={() => s.removeUpload(u.id)} />
                ))}
              </ul>
            )}
          </main>
        )}

        <footer className="mo-foot">
          <a href="/simple">Simple mode</a>
          <span aria-hidden>·</span>
          <a href="/studio">Advanced studio</a>
        </footer>
      </div>

      <input
        ref={fileRef}
        type="file"
        hidden
        multiple
        accept="image/jpeg,image/png,image/webp,image/gif,video/mp4"
        onChange={(event) => {
          s.addFiles(event.target.files);
          event.target.value = "";
        }}
      />
      <input
        ref={slotRef}
        type="file"
        hidden
        onChange={(event) => {
          s.addFiles(event.target.files, slotTarget.current);
          event.target.value = "";
        }}
      />
    </div>
  );
}

/* ---------- pieces ---------- */

function Group({ label, scroll, children }: { label: string; scroll?: boolean; children: ReactNode }) {
  return (
    <div className="mo-group" role="group" aria-label={label}>
      <span className="mo-label">{label}</span>
      <div className="mo-chips" data-scroll={scroll ?? false}>
        {children}
      </div>
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className="mo-chip" aria-pressed={on} onClick={onClick}>
      {children}
    </button>
  );
}

function Thumb({ upload, large, onRemove }: { upload: Upload; large?: boolean; onRemove: () => void }) {
  return (
    <li className="mo-thumb" data-large={large ?? false} data-error={Boolean(upload.error)}>
      {upload.kind === "video" ? (
        <video src={upload.preview} muted playsInline />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- local preview of the visitor's own file
        <img src={upload.preview} alt={upload.name} />
      )}
      <span className="mo-thumb-kind">{upload.error ? "FAILED" : upload.kind.toUpperCase()}</span>
      {!upload.url && !upload.error && (
        <span className="mo-thumb-bar" style={{ width: `${Math.round(upload.progress * 100)}%` }} aria-hidden />
      )}
      <button type="button" className="mo-thumb-x" aria-label={`Remove ${upload.name}`} onClick={onRemove}>
        ×
      </button>
    </li>
  );
}

function SlotTile({
  label,
  upload,
  onPick,
  onClear,
}: {
  label: string;
  upload: Upload | null;
  onPick: () => void;
  onClear: () => void;
}) {
  return (
    <span className="mo-slot">
      <button type="button" className="mo-slot-btn" onClick={onPick} aria-label={upload ? `Replace ${label.toLowerCase()}` : `Add ${label.toLowerCase()}`}>
        {upload && upload.kind === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element -- local preview
          <img src={upload.preview} alt="" />
        ) : (
          <span>{upload ? "♪" : "+"}</span>
        )}
      </button>
      <span className="mo-slot-label">
        {label}
        {upload && !upload.url && !upload.error ? ` ${Math.round(upload.progress * 100)}%` : ""}
        {upload?.error ? " · failed" : ""}
      </span>
      {upload && (
        <button type="button" className="mo-slot-clear" onClick={onClear} aria-label={`Remove ${label.toLowerCase()}`}>
          ×
        </button>
      )}
    </span>
  );
}

function JobRow({ row, onCancel }: { row: RunRecord; onCancel: (requestId: string) => Promise<void> | void }) {
  const [busy, setBusy] = useState(false);
  const pct = typeof row.progress === "number" ? Math.min(100, Math.max(0, row.progress)) : null;
  return (
    <li className="mo-job">
      <span className="mo-job-art" style={{ background: row.art }} aria-hidden>
        <span className="mo-spin" />
      </span>
      <span className="mo-job-text">
        <span className="mo-job-prompt" title={row.prompt}>
          {row.prompt}
        </span>
        <span className="mo-job-sub">
          {row.phase ?? "Generating"}
          {pct !== null && pct > 0 ? ` · ${Math.round(pct)}%` : ""} · {row.modelLabel}
        </span>
        <span className="mo-job-track" aria-hidden>
          <span style={{ width: `${pct ?? 8}%` }} data-indeterminate={pct === null} />
        </span>
      </span>
      {row.requestId && (
        <button
          type="button"
          className="mo-ghost"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void Promise.resolve(onCancel(row.requestId!)).finally(() => setBusy(false));
          }}
        >
          {busy ? "…" : "Cancel"}
        </button>
      )}
    </li>
  );
}

function ResultTile({ row, onDelete, onReuse }: { row: RunRecord; onDelete: () => void; onReuse: () => void }) {
  const url = row.urls[0];
  return (
    <li className="mo-card mo-result" data-status={row.status}>
      <div className="mo-media" style={{ aspectRatio: row.ratio, background: row.art }}>
        {row.status === "completed" && url ? (
          row.kind === "video" ? (
            <video src={url} controls playsInline preload="metadata" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- generated media from the provider
            <img src={url} alt={row.prompt} loading="lazy" />
          )
        ) : (
          <span className="mo-failed">{row.error ?? "Failed"}</span>
        )}
      </div>
      <div className="mo-result-meta">
        <span className="mo-result-prompt" title={row.prompt}>
          {row.prompt}
        </span>
        <span className="mo-result-sub">
          {row.modelLabel} · {timeAgo(row.createdAt)}
        </span>
      </div>
      <div className="mo-result-actions">
        {row.status === "completed" && url && (
          <button type="button" onClick={() => void saveFile(url, fileNameFor(row, 0))}>
            Download
          </button>
        )}
        <button type="button" onClick={onReuse}>
          {row.status === "failed" ? "Try again" : "Reuse"}
        </button>
        <button type="button" onClick={onDelete} aria-label={`Delete “${row.prompt}”`}>
          Delete
        </button>
      </div>
    </li>
  );
}

function Empty({ view, onStart }: { view: "video" | "image"; onStart: () => void }) {
  return (
    <div className="mo-card mo-empty">
      {view === "video" ? <FilmIcon /> : <ImageIcon />}
      <strong>No {view === "video" ? "videos" : "images"} yet</strong>
      <span>Finished {view === "video" ? "videos" : "images"} appear here and stay in this browser.</span>
      <button type="button" className="mo-ghost" onClick={onStart}>
        Create one
      </button>
    </div>
  );
}

/* ---------- icons ---------- */

const svg = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;

function Sparkle() {
  return (
    <svg {...svg}>
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4" />
      <path d="M12 7.5 13.6 10.4 16.5 12 13.6 13.6 12 16.5 10.4 13.6 7.5 12 10.4 10.4Z" />
    </svg>
  );
}
function PulseIcon() {
  return (
    <svg {...svg}>
      <path d="M3 12h4l3-8 4 16 3-8h4" />
    </svg>
  );
}
function FilmIcon() {
  return (
    <svg {...svg}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M7 3v18M17 3v18M3 8h4M3 16h4M17 8h4M17 16h4M3 12h18" />
    </svg>
  );
}
function ImageIcon() {
  return (
    <svg {...svg}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-5-5L5 21" />
    </svg>
  );
}
function LayersIcon() {
  return (
    <svg {...svg}>
      <path d="m12 3 9 5-9 5-9-5 9-5Z" />
      <path d="m3 13 9 5 9-5" />
      <path d="m3 17 9 5 9-5" />
    </svg>
  );
}
function SlidersIcon() {
  return (
    <svg {...svg}>
      <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" />
      <circle cx="16" cy="6" r="2" />
      <circle cx="10" cy="12" r="2" />
      <circle cx="18" cy="18" r="2" />
    </svg>
  );
}
function ClipIcon() {
  return (
    <svg {...svg}>
      <path d="m21 11-8.5 8.5a5 5 0 0 1-7-7L14 4a3.3 3.3 0 0 1 4.7 4.7l-8.6 8.6a1.7 1.7 0 0 1-2.3-2.4L15.5 7" />
    </svg>
  );
}
function UploadIcon() {
  return (
    <svg {...svg}>
      <path d="M12 16V4M7 9l5-5 5 5" />
      <path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
    </svg>
  );
}
function Chevron({ open }: { open: boolean }) {
  return (
    <svg {...svg} className="mo-chevron" data-open={open}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}
