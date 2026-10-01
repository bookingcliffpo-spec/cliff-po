"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
import { loadHistory, mergeHistory, replaceRequest, requestIdOf, saveHistory, type RunRecord } from "@/openhiggsfield/history";

import { LOOKS } from "./looks";
import {
  PlanError,
  availableTargets,
  isVideoTarget,
  planSimple,
  type SimpleInput,
  type SimplePlan,
  type Target,
  type VideoAction,
} from "./plan";

/** The state and actions behind the upload → prompt → Generate pages. Both
    home layouts render from this, so they behave identically. */

export type Upload = {
  id: string;
  name: string;
  kind: "image" | "video" | "audio";
  preview: string;
  url: string | null;
  progress: number;
  error?: string;
  tag?: ReferenceTag;
};

export type Slot = "main" | "start" | "end" | "audio";

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

export function useStudio() {
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
  const alive = useRef(true);
  const historyRef = useRef(history);

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

  const finish = useCallback((requestId: string, result: GenerationStatus) => {
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
  }, []);

  const watch = useCallback(
    (requestId: string, modelId: string, createdAt: number) => {
      const model = findModel(modelId);
      const window =
        model && providerOf(model) === "wangp" ? LOCAL_GPU_DEADLINE_MS : POLL_DEADLINE_MS[model?.surface ?? "video"];
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
    },
    [finish],
  );

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
  /* Nowhere to put a file (the hosted site with no GPU and no storage). */
  const uploadsOff = status !== null && storage === null;

  async function send(file: File, slot: Slot) {
    const kind = kindOfType(file.type);
    const problem = validateUpload(file);
    if (!kind || problem) {
      setError(
        problem && file.type === "video/quicktime"
          ? "iPhone videos (.mov) aren't supported yet — export it as MP4, or set Camera → Formats → Most Compatible."
          : (problem ?? "Upload failed — unsupported file."),
      );
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

  function tagUpload(id: string, tag: ReferenceTag | undefined) {
    setUploads((prev) => prev.map((x) => (x.id === id ? { ...x, tag } : x)));
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
  let plan: SimplePlan | null = null;
  let planProblem: string | null = null;
  try {
    plan = planSimple(input);
  } catch (caught) {
    planProblem = caught instanceof PlanError ? caught.message : "Something is missing.";
  }

  async function submitOne(current: SimplePlan): Promise<boolean> {
    const model = findModel(current.plane.model)!;
    const direction = video ? LOOKS[look]?.direction : undefined;
    const plane = { ...current.plane, prompt: { text: buildCinematicPrompt(current.plane.prompt.text, direction) } };
    const createdAt = Date.now();
    const draft: RunRecord = {
      id: `pending-${createdAt}`,
      surface: model.surface,
      modelId: model.id,
      modelLabel: current.summary,
      prompt: prompt.trim() || current.summary,
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
    if (!alive.current) return false;
    if (!result.ok) {
      setError(result.error);
      return false;
    }
    const { requestId } = result.data;
    const row: RunRecord = { ...draft, id: requestId, requestId };
    setHistory((prev) => [row, ...prev.filter((r) => requestIdOf(r) !== requestId)]);
    if (result.data.result) finish(requestId, result.data.result);
    else watch(requestId, model.id, createdAt);
    return true;
  }

  /** Starts `count` runs of the current plan, one after another, stopping at
      the first refusal. */
  async function generate(count = 1) {
    if (!plan || submitting || uploading) return;
    setSubmitting(true);
    setError(null);
    for (let i = 0; i < count; i++) {
      if (!(await submitOne(plan))) break;
    }
    if (alive.current) setSubmitting(false);
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

  function deleteRun(id: string) {
    setHistory((prev) => prev.filter((r) => r.id !== id));
  }

  const ready = Boolean(plan) && !uploading && !submitting;
  const noVideoBackend = status !== null && !targets.some((t) => isVideoTarget(t.id));

  return {
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
  };
}

export type Studio = ReturnType<typeof useStudio>;
