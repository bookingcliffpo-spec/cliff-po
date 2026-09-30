"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";

import { cancelGeneration, getStudioStatus, submitGeneration, type StudioStatus } from "@/generation/actions";
import { findModel, providerOf } from "@/generation/catalog";
import type { ReferenceTag } from "@/generation/catalog/types";
import { buildCinematicPrompt } from "@/generation/cinema";
import type { GenerationStatus } from "@/generation/higgsfield/types";
import { kindOfType, validateUpload } from "@/generation/media-rules";
import { LOCAL_GPU_DEADLINE_MS, POLL_DEADLINE_MS, WatchError } from "@/generation/poll";
import { studioPoller } from "@/generation/poller";
import { callAction } from "@/generation/result";
import { UploadError, uploadMedia } from "@/generation/upload";
import { artFor } from "@/openhiggsfield/artwork";
import { fileNameFor, saveFile } from "@/openhiggsfield/download";
import {
  loadHistory,
  mergeHistory,
  replaceRequest,
  requestIdOf,
  saveHistory,
  timeAgo,
  type RunRecord,
} from "@/openhiggsfield/history";

import { LOOKS } from "./looks";
import {
  ASPECTS,
  DURATIONS,
  PlanError,
  RESTYLES,
  availableTargets,
  isVideoTarget,
  planSimple,
  type SimpleInput,
  type Target,
  type VideoAction,
} from "./plan";

type Upload = {
  id: string;
  name: string;
  kind: "image" | "video" | "audio";
  preview: string;
  url: string | null;
  progress: number;
  error?: string;
  tag?: ReferenceTag;
};

type Slot = "main" | "start" | "end" | "audio";

const TAGS: Array<[ReferenceTag | "", string]> = [
  ["", "Reference"],
  ["character", "Character"],
  ["face", "Face"],
  ["product", "Product"],
  ["wardrobe", "Outfit"],
  ["location", "Location"],
  ["style", "Style"],
  ["object", "Object"],
];

const ACTIONS: Array<[VideoAction, string]> = [
  ["edit", "Edit it with my prompt"],
  ["extend", "Extend it (make it longer)"],
  ["motion", "Put my character into its motion"],
  ["swap-character", "Swap the character for my image"],
  ["swap-object", "Swap an object/product for my image"],
  ["restyle", "Restyle it"],
];

const PREFS_KEY = "simple.prefs.v1";

function readPrefs(): Partial<{ target: Target; duration: number; aspect: string; look: string }> {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}");
  } catch {
    return {};
  }
}

let seq = 0;
const newId = () => `${Date.now().toString(36)}-${++seq}`;

function hue(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
  return h;
}

export function SimpleStudio({ fontClassName = "" }: { fontClassName?: string }) {
  const [status, setStatus] = useState<StudioStatus | null>(null);
  const [target, setTarget] = useState<Target>("video-free");
  const [prompt, setPrompt] = useState("");
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [start, setStart] = useState<Upload | null>(null);
  const [end, setEnd] = useState<Upload | null>(null);
  const [audio, setAudio] = useState<Upload | null>(null);
  const [duration, setDuration] = useState(5);
  const [aspect, setAspect] = useState("16:9");
  const [resolution, setResolution] = useState<"480p" | "720p">("720p");
  const [sound, setSound] = useState(true);
  const [videoAction, setVideoAction] = useState<VideoAction>("edit");
  const [restyle, setRestyle] = useState<string>("style-anime");
  const [look, setLook] = useState("none");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [history, setHistory] = useState<RunRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [dragging, setDragging] = useState(false);
  const alive = useRef(true);
  const historyRef = useRef(history);
  const fileRef = useRef<HTMLInputElement>(null);
  const slotRef = useRef<HTMLInputElement>(null);
  const slotTarget = useRef<Slot>("main");

  useEffect(() => {
    historyRef.current = history;
  }, [history]);

  const targets = useMemo(() => availableTargets(status?.providers ?? null), [status]);
  const video = isVideoTarget(target);
  const mainVideo = uploads.find((u) => u.kind === "video") ?? null;
  const images = uploads.filter((u) => u.kind === "image");

  /* ---------- lifecycle ---------- */

  useEffect(() => {
    alive.current = true;
    const prefs = readPrefs();
    /* eslint-disable react-hooks/set-state-in-effect -- saved preferences are read after mount so hydration matches */
    if (prefs.duration) setDuration(prefs.duration);
    if (prefs.aspect) setAspect(prefs.aspect);
    if (prefs.look && LOOKS[prefs.look]) setLook(prefs.look);
    /* eslint-enable react-hooks/set-state-in-effect */
    void callAction(getStudioStatus).then((result) => {
      if (!alive.current) return;
      if (!result.ok) return setError(result.error);
      setStatus(result.data);
      const usable = availableTargets(result.data.providers);
      const saved = usable.find((t) => t.id === prefs.target);
      setTarget((saved ?? usable[0])?.id ?? "demo");
    });
    void loadHistory()
      .then((rows) => alive.current && setHistory((current) => mergeHistory(rows, current)))
      .finally(() => alive.current && setLoaded(true));
    return () => {
      alive.current = false;
      studioPoller.stop();
    };
  }, []);

  useEffect(() => {
    if (loaded) void saveHistory(history);
  }, [loaded, history]);

  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ target, duration, aspect, look }));
    } catch {
      /* private mode */
    }
  }, [target, duration, aspect, look]);

  /* ---------- watching runs ---------- */

  const watch = useCallback((requestId: string, modelId: string, createdAt: number) => {
    const model = findModel(modelId);
    const window =
      model && providerOf(model) === "wangp"
        ? LOCAL_GPU_DEADLINE_MS
        : POLL_DEADLINE_MS[model?.surface ?? "video"];
    studioPoller
      .watch(requestId, {
        deadline: createdAt + window,
        onUpdate: (update) => {
          if (!alive.current) return;
          setHistory((prev) =>
            prev.map((row) =>
              row.status === "running" && requestIdOf(row) === requestId
                ? { ...row, progress: update.progress ?? row.progress, phase: update.phase ?? row.phase }
                : row,
            ),
          );
        },
      })
      .then((result) => alive.current && finish(requestId, result))
      .catch((caught: unknown) => {
        if (!alive.current) return;
        if (caught instanceof WatchError && caught.code === "canceled") return;
        const message = caught instanceof Error ? caught.message : "The run was lost.";
        setHistory((prev) =>
          replaceRequest(
            prev,
            requestId,
            prev
              .filter((row) => requestIdOf(row) === requestId)
              .map((row) => ({ ...row, status: "failed" as const, error: message })),
          ),
        );
      });
  }, []);

  function finish(requestId: string, result: GenerationStatus) {
    setHistory((prev) => {
      const rows = prev.filter((row) => requestIdOf(row) === requestId);
      const base = rows[0];
      if (!base) return prev;
      const urls = result.images?.map((i) => i.url) ?? (result.video ? [result.video.url] : []);
      const done = result.status === "completed" && urls.length > 0;
      const next: RunRecord[] = done
        ? urls.map((url, i) => ({
            ...base,
            id: urls.length > 1 ? `${requestId}#${i}` : requestId,
            urls: [url],
            status: "completed" as const,
            progress: undefined,
            phase: undefined,
          }))
        : [
            {
              ...base,
              status: "failed" as const,
              error:
                result.status === "canceled"
                  ? "Canceled."
                  : result.error
                    ? `The model reported a failure — ${result.error}`
                    : "The model finished without a result.",
            },
          ];
      return replaceRequest(prev, requestId, next);
    });
  }

  /* Pick up runs that were still going when the page was last closed. */
  const resumed = useRef(false);
  useEffect(() => {
    if (!loaded || resumed.current) return;
    resumed.current = true;
    for (const row of historyRef.current) {
      if (row.status === "running" && row.requestId) watch(row.requestId, row.modelId, row.createdAt);
    }
  }, [loaded, watch]);

  /* ---------- uploads ---------- */

  const storage = status?.storage ?? null;

  async function send(file: File, slot: Slot) {
    const kind = kindOfType(file.type);
    const problem = validateUpload(file);
    if (!kind || problem) {
      setError(problem ?? "Upload failed — unsupported file.");
      return;
    }
    if (slot === "audio" && kind !== "audio") return setError("The audio reference must be a WAV file.");
    if ((slot === "start" || slot === "end") && kind !== "image") return setError("Start and end frames must be images.");
    if (slot === "main" && kind === "audio") slot = "audio";

    const entry: Upload = { id: newId(), name: file.name, kind, preview: URL.createObjectURL(file), url: null, progress: 0 };
    const put = (patch: Partial<Upload>) => {
      const apply = (u: Upload | null) => (u && u.id === entry.id ? { ...u, ...patch } : u);
      if (slot === "main") setUploads((prev) => prev.map((u) => (u.id === entry.id ? { ...u, ...patch } : u)));
      else if (slot === "start") setStart(apply);
      else if (slot === "end") setEnd(apply);
      else setAudio(apply);
    };
    if (slot === "main") {
      setUploads((prev) => {
        /* One source video at a time: a new one replaces the old. */
        const kept = kind === "video" ? prev.filter((u) => u.kind !== "video") : prev;
        return [...kept, entry];
      });
    } else if (slot === "start") setStart(entry);
    else if (slot === "end") setEnd(entry);
    else setAudio(entry);

    setError(null);
    try {
      const { url } = await uploadMedia(file, {
        driver: storage,
        expected: kind,
        onProgress: (fraction) => put({ progress: fraction }),
      });
      put({ url, progress: 1 });
    } catch (caught) {
      const message = caught instanceof UploadError ? caught.message : "Upload failed.";
      put({ error: message });
      setError(message);
    }
  }

  function addFiles(files: FileList | File[] | null, slot: Slot = "main") {
    if (!files) return;
    for (const file of Array.from(files)) void send(file, slot);
  }

  function removeUpload(id: string) {
    setUploads((prev) => {
      const gone = prev.find((u) => u.id === id);
      if (gone) URL.revokeObjectURL(gone.preview);
      return prev.filter((u) => u.id !== id);
    });
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    addFiles(event.dataTransfer.files);
  }

  function pickFor(slot: Slot) {
    slotTarget.current = slot;
    const input = slotRef.current;
    if (!input) return;
    input.accept = slot === "audio" ? "audio/wav,audio/x-wav" : "image/jpeg,image/png,image/webp,image/gif";
    input.click();
  }

  /* ---------- generate ---------- */

  const uploading = [...uploads, start, end, audio].some((u) => u && !u.url && !u.error);
  const input: SimpleInput = {
    target,
    prompt,
    images: images.filter((u) => u.url).map((u) => ({ url: u.url!, tag: u.tag })),
    video: mainVideo?.url ?? undefined,
    duration,
    aspect,
    start: start?.url ?? undefined,
    end: end?.url ?? undefined,
    audio: audio?.url ?? undefined,
    resolution,
    sound,
    videoAction,
    restyle,
  };
  let plan: ReturnType<typeof planSimple> | null = null;
  let planProblem: string | null = null;
  try {
    plan = planSimple(input);
  } catch (caught) {
    planProblem = caught instanceof PlanError ? caught.message : "Something is missing.";
  }

  async function generate() {
    if (!plan || submitting || uploading) return;
    setSubmitting(true);
    setError(null);
    const model = findModel(plan.plane.model)!;
    const direction = video ? LOOKS[look]?.direction : undefined;
    const plane = { ...plan.plane, prompt: { text: buildCinematicPrompt(plan.plane.prompt.text, direction) } };
    const createdAt = Date.now();
    const draft: RunRecord = {
      id: `pending-${createdAt}`,
      surface: model.surface,
      modelId: model.id,
      modelLabel: plan.summary,
      prompt: prompt.trim() || plan.summary,
      ratio: (model.settings.aspectRatio ? aspect : "16:9").replace(":", " / "),
      meta: [video ? `${plane.settings.duration ?? duration}s` : null, model.settings.aspectRatio ? aspect : null]
        .filter(Boolean)
        .join(" · "),
      kind: model.surface,
      urls: [],
      status: "running",
      art: artFor(model.surface, hue(String(createdAt)), String(createdAt)),
      createdAt,
      settings: plane.settings,
      ...(direction && Object.keys(direction).length ? { direction } : {}),
    };

    const result = await callAction(() => submitGeneration(plane));
    if (!alive.current) return;
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const { requestId } = result.data;
    const row: RunRecord = { ...draft, id: requestId, requestId };
    setHistory((prev) => [row, ...prev.filter((r) => requestIdOf(r) !== requestId)]);
    if (result.data.result) finish(requestId, result.data.result);
    else watch(requestId, model.id, createdAt);
  }

  async function cancel(requestId: string) {
    const result = await callAction(() => cancelGeneration({ requestId }));
    if (!result.ok) return setError(`Could not cancel — ${result.error}`);
    studioPoller.unwatch(requestId);
    setHistory((prev) =>
      replaceRequest(
        prev,
        requestId,
        prev.filter((r) => requestIdOf(r) === requestId).map((r) => ({ ...r, status: "failed" as const, error: "Canceled." })),
      ),
    );
  }

  const ready = Boolean(plan) && !uploading && !submitting;
  const buttonLabel = submitting ? "Starting…" : uploading ? "Uploading…" : "Generate";
  const noVideoBackend = status !== null && !targets.some((t) => isVideoTarget(t.id));

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
            onClick={() => fileRef.current?.click()}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                fileRef.current?.click();
              }
            }}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            {uploads.length === 0 ? (
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

              {video && (
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
                          onChange={(event) =>
                            setUploads((prev) =>
                              prev.map((x) => (x.id === u.id ? { ...x, tag: (event.target.value || undefined) as ReferenceTag | undefined } : x)),
                            )
                          }
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

        {noVideoBackend && (
          <details className="sp-setup">
            <summary>Want free video? Run it on your computer</summary>
            <ol>
              <li>
                Install <a href="https://github.com/deepbeepmeep/Wan2GP" target="_blank" rel="noopener">WanGP</a> on a PC with an NVIDIA GPU.
              </li>
              <li>
                Run <code>start-free-studio</code> from this project (see the README) — it starts the model and this page together.
              </li>
              <li>Open the address it prints on your phone or any computer on the same Wi-Fi.</li>
            </ol>
          </details>
        )}

        <section className="sp-results" aria-label="Your results">
          <h2>Your results</h2>
          {history.length === 0 ? (
            <p className="sp-empty">Nothing yet — your videos and images appear here.</p>
          ) : (
            <ul className="sp-grid">
              {history.slice(0, 40).map((row) => (
                <ResultCard key={row.id} row={row} onCancel={cancel} onDelete={() => setHistory((prev) => prev.filter((r) => r.id !== row.id))} onReuse={() => setPrompt(row.prompt)} />
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

function ResultCard({
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
