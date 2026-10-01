"use client";

import { useRef, useState, type DragEvent } from "react";

import type { ReferenceTag } from "@/generation/catalog/types";
import { fileNameFor, saveFile } from "@/openhiggsfield/download";
import { timeAgo, type RunRecord } from "@/openhiggsfield/history";

import { LOOKS } from "./looks";
import { ASPECTS, DURATIONS, RESTYLES, type Target, type VideoAction } from "./plan";
import { useStudio, type Slot, type Upload } from "./use-studio";

export const TAGS: Array<[ReferenceTag | "", string]> = [
  ["", "Reference"],
  ["character", "Character"],
  ["face", "Face"],
  ["product", "Product"],
  ["wardrobe", "Outfit"],
  ["location", "Location"],
  ["style", "Style"],
  ["object", "Object"],
];

export const ACTIONS: Array<[VideoAction, string]> = [
  ["edit", "Edit it with my prompt"],
  ["extend", "Extend it (make it longer)"],
  ["motion", "Put my character into its motion"],
  ["swap-character", "Swap the character for my image"],
  ["swap-object", "Swap an object/product for my image"],
  ["restyle", "Restyle it"],
];

export function SimpleStudio({ fontClassName = "" }: { fontClassName?: string }) {
  const studio = useStudio();
  const {
    status,
    targets,
    target,
    setTarget,
    prompt,
    setPrompt,
    uploads,
    start,
    setStart,
    end,
    setEnd,
    audio,
    setAudio,
    duration,
    setDuration,
    aspect,
    setAspect,
    resolution,
    setResolution,
    sound,
    setSound,
    videoAction,
    setVideoAction,
    restyle,
    setRestyle,
    look,
    setLook,
    error,
    setError,
    submitting,
    history,
    video,
    mainVideo,
    images,
    storage,
    uploadsOff,
    noVideoBackend,
    addFiles,
    removeUpload,
    tagUpload,
    uploading,
    plan,
    planProblem,
    ready,
    generate,
    cancel,
    deleteRun,
  } = studio;
  const [dragging, setDragging] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const slotRef = useRef<HTMLInputElement>(null);
  const slotTarget = useRef<Slot>("main");

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    if (status !== null && storage === null) {
      setSetupOpen(true);
      return;
    }
    addFiles(event.dataTransfer.files);
  }

  function pickFor(slot: Slot) {
    slotTarget.current = slot;
    const input = slotRef.current;
    if (!input) return;
    input.accept = slot === "audio" ? "audio/wav,audio/x-wav" : "image/jpeg,image/png,image/webp,image/gif";
    input.click();
  }

  const buttonLabel = submitting ? "Starting…" : uploading ? "Uploading…" : "Generate";
  const openPicker = () => {
    if (uploadsOff) {
      setSetupOpen(true);
      document.getElementById("sp-setup")?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    fileRef.current?.click();
  };

  /* ---------- render ---------- */

  return (
    <div className={`sp ${fontClassName}`}>
      <div className="sp-wrap">
        <header className="sp-head">
          <div className="sp-brand">
            <span className="sp-mark" aria-hidden>
              ▶
            </span>
            <span>
              <span className="sp-title">Studio</span>
              <span className="sp-sub">Upload · prompt · generate</span>
            </span>
          </div>
          <a className="sp-link" href="/studio">
            Advanced studio →
          </a>
        </header>

        <main className="sp-card">
          <div
            className="sp-drop"
            data-dragging={dragging}
            role="button"
            tabIndex={0}
            aria-label="Upload images or a video"
            data-off={uploadsOff}
            onClick={openPicker}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                openPicker();
              }
            }}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            {uploadsOff ? (
              <span className="sp-drop-empty">
                <strong>Photos &amp; videos work when your computer runs the studio</strong>
                <span>
                  This online version makes free images from your prompt. To animate your own photos or edit
                  videos for free, start it on your PC — tap to see how.
                </span>
              </span>
            ) : uploads.length === 0 ? (
              <span className="sp-drop-empty">
                <strong>Upload images or a video</strong>
                <span>Drop files here, or tap to choose from your phone or computer (optional)</span>
              </span>
            ) : (
              <ul className="sp-thumbs" onClick={(event) => event.stopPropagation()}>
                {uploads.map((u) => (
                  <li key={u.id} className="sp-thumb" data-error={Boolean(u.error)}>
                    {u.kind === "video" ? (
                      <video src={u.preview} muted playsInline />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element -- local preview of the visitor's own file
                      <img src={u.preview} alt={u.name} />
                    )}
                    <span className="sp-thumb-kind">{u.kind === "video" ? "VIDEO" : "IMAGE"}</span>
                    {!u.url && !u.error && (
                      <span className="sp-thumb-bar" style={{ width: `${Math.round(u.progress * 100)}%` }} aria-hidden />
                    )}
                    <button type="button" className="sp-thumb-x" aria-label={`Remove ${u.name}`} onClick={() => removeUpload(u.id)}>
                      ×
                    </button>
                  </li>
                ))}
                <li>
                  <button type="button" className="sp-thumb-add" aria-label="Add more files" onClick={() => fileRef.current?.click()}>
                    +
                  </button>
                </li>
              </ul>
            )}
            <input
              ref={fileRef}
              type="file"
              hidden
              multiple
              accept="image/jpeg,image/png,image/webp,image/gif,video/mp4"
              onChange={(event) => {
                addFiles(event.target.files);
                event.target.value = "";
              }}
            />
            <input
              ref={slotRef}
              type="file"
              hidden
              onChange={(event) => {
                addFiles(event.target.files, slotTarget.current);
                event.target.value = "";
              }}
            />
          </div>

          <label className="sp-field">
            <span className="sp-label">Prompt</span>
            <textarea
              className="sp-prompt"
              aria-label="Prompt"
              rows={3}
              value={prompt}
              placeholder={
                mainVideo
                  ? "What should change? e.g. make it snow, turn the car red"
                  : video
                    ? "Describe the shot — who, where, what happens, how the camera moves"
                    : "Describe the picture"
              }
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.repeat) {
                  event.preventDefault();
                  void generate();
                }
              }}
            />
          </label>

          <div className="sp-row">
            <label className="sp-field sp-grow">
              <span className="sp-label">Model</span>
              <select className="sp-select" aria-label="Model" value={target} onChange={(event) => setTarget(event.target.value as Target)}>
                {targets.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            {video && (
              <label className="sp-field">
                <span className="sp-label">Duration</span>
                <select className="sp-select" aria-label="Duration" value={duration} onChange={(event) => setDuration(Number(event.target.value))}>
                  {DURATIONS.map((d) => (
                    <option key={d} value={d}>
                      {d} s
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="sp-field">
              <span className="sp-label">Aspect ratio</span>
              <select className="sp-select" aria-label="Aspect ratio" value={aspect} onChange={(event) => setAspect(event.target.value)}>
                {ASPECTS.filter((a) => video || a !== "21:9").map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="sp-hint">{targets.find((t) => t.id === target)?.hint}</p>

          <details className="sp-more">
            <summary>More settings</summary>
            <div className="sp-more-body">
              {mainVideo && video && (
                <label className="sp-field">
                  <span className="sp-label">Use my video to…</span>
                  <select className="sp-select" aria-label="Use my video to" value={videoAction} onChange={(event) => setVideoAction(event.target.value as VideoAction)}>
                    {ACTIONS.map(([id, label]) => (
                      <option key={id} value={id}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {mainVideo && videoAction === "restyle" && (
                <label className="sp-field">
                  <span className="sp-label">Style</span>
                  <select className="sp-select" aria-label="Style" value={restyle} onChange={(event) => setRestyle(event.target.value)}>
                    {RESTYLES.map(([id, label]) => (
                      <option key={id} value={id}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {video && storage !== null && (
                <div className="sp-slots">
                  <SlotButton label="Start frame" upload={start} onPick={() => pickFor("start")} onClear={() => setStart(null)} />
                  <SlotButton label="End frame" upload={end} onPick={() => pickFor("end")} onClear={() => setEnd(null)} />
                  <SlotButton label="Audio reference" upload={audio} onPick={() => pickFor("audio")} onClear={() => setAudio(null)} />
                </div>
              )}

              {images.length > 0 && video && (
                <div className="sp-field">
                  <span className="sp-label">What are your images?</span>
                  <ul className="sp-tags">
                    {images.map((u) => (
                      <li key={u.id}>
                        {/* eslint-disable-next-line @next/next/no-img-element -- local preview */}
                        <img src={u.preview} alt="" />
                        <select
                          className="sp-select"
                          aria-label={`Role of ${u.name}`}
                          value={u.tag ?? ""}
                          onChange={(event) => tagUpload(u.id, (event.target.value || undefined) as ReferenceTag | undefined)}
                        >
                          {TAGS.map(([id, label]) => (
                            <option key={id} value={id}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="sp-row">
                {video && (
                  <label className="sp-field sp-grow">
                    <span className="sp-label">Cinematic look</span>
                    <select className="sp-select" aria-label="Cinematic look" value={look} onChange={(event) => setLook(event.target.value)}>
                      {Object.entries(LOOKS).map(([id, l]) => (
                        <option key={id} value={id}>
                          {l.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {video && (
                  <label className="sp-field">
                    <span className="sp-label">Quality</span>
                    <select className="sp-select" aria-label="Quality" value={resolution} onChange={(event) => setResolution(event.target.value as "480p" | "720p")}>
                      <option value="720p">720p</option>
                      <option value="480p">480p (faster)</option>
                    </select>
                  </label>
                )}
                {video && (
                  <label className="sp-check">
                    <input type="checkbox" checked={sound} onChange={(event) => setSound(event.target.checked)} />
                    Sound
                  </label>
                )}
              </div>
            </div>
          </details>

          {error && (
            <div className="sp-alert" role="alert">
              <span>{error}</span>
              <button type="button" aria-label="Dismiss" onClick={() => setError(null)}>
                ×
              </button>
            </div>
          )}

          <div className="sp-go">
            <span className="sp-plan" aria-live="polite">
              {plan ? `→ ${plan.summary}` : planProblem}
              {plan?.notes.map((note) => (
                <span key={note} className="sp-note">
                  {note}
                </span>
              ))}
            </span>
            <button type="button" className="sp-generate" disabled={!ready} onClick={() => void generate()}>
              {buttonLabel}
            </button>
          </div>
        </main>

        {(noVideoBackend || uploadsOff) && (
          <details
            id="sp-setup"
            className="sp-setup"
            open={setupOpen}
            onToggle={(event) => setSetupOpen((event.currentTarget as HTMLDetailsElement).open)}
          >
            <summary>Free video from your photos: run it on your computer</summary>
            <ol>
              <li>
                Install <a href="https://github.com/deepbeepmeep/Wan2GP" target="_blank" rel="noopener">WanGP</a> on a PC with an NVIDIA GPU.
              </li>
              <li>
                Run <code>start-free-studio</code> from this project (see the README) — it starts the model and this page together.
              </li>
              <li>Open the address it prints on your phone or any computer on the same Wi-Fi — uploads then go straight to your PC.</li>
            </ol>
            {uploadsOff && (
              <p className="sp-note">
                Site owner: turn on uploads here in Vercel → this project → Storage → Create → Blob (Public access) →
                Connect, then redeploy. Blob has a free tier.
              </p>
            )}
            <p className="sp-note">
              Prefer not to run anything? Video from photos is also possible with a Higgsfield key (paid credits) —
              that needs the site owner to add it and upload storage.
            </p>
          </details>
        )}

        <section className="sp-results" aria-label="Your results">
          <h2>Your results</h2>
          {history.length === 0 ? (
            <p className="sp-empty">Nothing yet — your videos and images appear here.</p>
          ) : (
            <ul className="sp-grid">
              {history.slice(0, 40).map((row) => (
                <ResultCard key={row.id} row={row} onCancel={cancel} onDelete={() => deleteRun(row.id)} onReuse={() => setPrompt(row.prompt)} />
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function SlotButton({
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
    <span className="sp-slot">
      <button type="button" className="sp-slot-btn" onClick={onPick} aria-label={upload ? `Replace ${label.toLowerCase()}` : `Add ${label.toLowerCase()}`}>
        {upload && upload.kind === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element -- local preview
          <img src={upload.preview} alt="" />
        ) : (
          <span>{upload ? "♪" : "+"}</span>
        )}
      </button>
      <span className="sp-slot-label">
        {label}
        {upload && !upload.url && !upload.error ? ` · ${Math.round(upload.progress * 100)}%` : ""}
        {upload?.error ? " · failed" : ""}
      </span>
      {upload && (
        <button type="button" className="sp-slot-clear" onClick={onClear} aria-label={`Remove ${label.toLowerCase()}`}>
          ×
        </button>
      )}
    </span>
  );
}

export function ResultCard({
  row,
  onCancel,
  onDelete,
  onReuse,
}: {
  row: RunRecord;
  onCancel: (requestId: string) => Promise<void> | void;
  onDelete: () => void;
  onReuse: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const url = row.urls[0];
  return (
    <li className="sp-result" data-status={row.status}>
      <div className="sp-media" style={{ aspectRatio: row.ratio, background: row.art }}>
        {row.status === "completed" && url ? (
          row.kind === "video" ? (
            <video src={url} controls playsInline preload="metadata" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- generated media from the provider
            <img src={url} alt={row.prompt} loading="lazy" />
          )
        ) : row.status === "running" ? (
          <span className="sp-running">
            <span className="sp-spin" aria-hidden />
            {row.phase ?? "Generating"}
            {typeof row.progress === "number" && row.progress > 0 ? ` · ${Math.round(row.progress)}%` : ""}
          </span>
        ) : (
          <span className="sp-failed">{row.error ?? "Failed"}</span>
        )}
        {row.status === "running" && typeof row.progress === "number" && (
          <span className="sp-media-bar" style={{ width: `${Math.min(100, row.progress)}%` }} aria-hidden />
        )}
      </div>
      <div className="sp-result-meta">
        <span className="sp-result-prompt" title={row.prompt}>
          {row.prompt}
        </span>
        <span className="sp-result-sub">
          {row.modelLabel} · {row.meta ? `${row.meta} · ` : ""}
          {timeAgo(row.createdAt)}
        </span>
      </div>
      <div className="sp-result-actions">
        {row.status === "running" && row.requestId && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void Promise.resolve(onCancel(row.requestId!)).finally(() => setBusy(false));
            }}
          >
            {busy ? "Canceling…" : "Cancel"}
          </button>
        )}
        {row.status === "completed" && url && (
          <button type="button" onClick={() => void saveFile(url, fileNameFor(row, 0))}>
            Download
          </button>
        )}
        {row.status !== "running" && (
          <button type="button" onClick={onReuse}>
            {row.status === "failed" ? "Try again" : "Reuse prompt"}
          </button>
        )}
        {row.status !== "running" && (
          <button type="button" onClick={onDelete} aria-label={`Delete “${row.prompt}”`}>
            Delete
          </button>
        )}
      </div>
    </li>
  );
}
