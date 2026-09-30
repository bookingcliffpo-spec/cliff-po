import type { Surface } from "./catalog/types";
import { TERMINAL_STATUSES } from "./higgsfield/terminal";
import type { GenerationStatus, StatusResult } from "./higgsfield/types";
import type { ActionResult, ErrorCode } from "./result";

export const POLL_INTERVAL_MS = 4000;
/** How long a run may stay unfinished before the studio gives up on it. Video
    runs — a 30-second Seedance clip in particular — take far longer than
    images, so each surface has its own window. */
export const POLL_DEADLINE_MS: Record<Surface, number> = {
  image: 10 * 60_000,
  video: 25 * 60_000,
};
/** Local GPU jobs wait in WanGP's own queue and a 30-second clip can take
    well over an hour on a consumer card. */
export const LOCAL_GPU_DEADLINE_MS = 4 * 60 * 60_000;
/** Rounds allowed to fail back to back before the watches are given up on. One
    dropped round must not end every generation in flight. */
const MAX_MISSES = 4;

/** Why a watch ended without a terminal status. `code` lets the studio react
    (open the key modal) without reading the words. */
export class WatchError extends Error {
  readonly code: ErrorCode | "canceled";
  constructor(message: string, code: ErrorCode | "canceled") {
    super(message);
    this.name = "WatchError";
    this.code = code;
  }
}

type Waiter = {
  deadline: number;
  onUpdate?: (status: GenerationStatus) => void;
  resolve: (status: GenerationStatus) => void;
  reject: (reason: WatchError) => void;
};

export type PollerDeps = {
  fetchStatuses: (requestIds: string[]) => Promise<ActionResult<StatusResult[]>>;
  intervalMs?: number;
  now?: () => number;
  setTimer?: (run: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
};

/** Codes a whole failed round cannot recover from by waiting. */
const FATAL_ROUND = new Set<ErrorCode>(["missing_api_key", "invalid_api_key", "missing_config", "forbidden"]);

/** Every request in flight is asked for together, in one server action per
    interval: Next dispatches server actions one at a time per client, so a
    poll per run would queue ahead of the next submit. */
export function createPoller(deps: PollerDeps) {
  const interval = deps.intervalMs ?? POLL_INTERVAL_MS;
  const now = deps.now ?? Date.now;
  const setTimer = deps.setTimer ?? ((run, ms) => setTimeout(run, ms));
  const clearTimer = deps.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));

  const waiting = new Map<string, Waiter>();
  const inflight = new Map<string, Promise<GenerationStatus>>();
  let timer: unknown = null;
  let polling = false;
  let misses = 0;
  /* Bumped by stop(): a round that was already awaiting the server when the
     studio unmounted must not deliver into the next mount's watches. */
  let generation = 0;

  function watch(
    requestId: string,
    opts: { deadline: number; onUpdate?: (status: GenerationStatus) => void },
  ): Promise<GenerationStatus> {
    const existing = inflight.get(requestId);
    if (existing) return existing;
    const promise = new Promise<GenerationStatus>((resolve, reject) => {
      waiting.set(requestId, {
        deadline: opts.deadline,
        onUpdate: opts.onUpdate,
        resolve: (status) => {
          inflight.delete(requestId);
          resolve(status);
        },
        reject: (reason) => {
          inflight.delete(requestId);
          reject(reason);
        },
      });
      /* A run already past its deadline (a tab reopened a day later) is
         settled on the next round instead of being polled forever. */
      schedule();
    });
    inflight.set(requestId, promise);
    return promise;
  }

  /** Stops watching one request (the visitor canceled it). */
  function unwatch(requestId: string): void {
    const waiter = waiting.get(requestId);
    if (!waiter) return;
    waiting.delete(requestId);
    waiter.reject(new WatchError("Canceled.", "canceled"));
  }

  /** Settles every watch as canceled: the studio unmounted and there is nobody
      left to hand a result to. The runs stay "running" in history and the
      next mount starts fresh watches for them. */
  function stop(): void {
    generation++;
    if (timer !== null) clearTimer(timer);
    timer = null;
    polling = false;
    misses = 0;
    const waiters = [...waiting.values()];
    waiting.clear();
    inflight.clear();
    for (const waiter of waiters) waiter.reject(new WatchError("Stopped watching.", "canceled"));
  }

  function schedule(): void {
    if (timer !== null || polling || waiting.size === 0) return;
    timer = setTimer(() => void round(), interval);
  }

  async function round(): Promise<void> {
    timer = null;
    polling = true;
    const mine = generation;
    try {
      const result = await deps.fetchStatuses([...waiting.keys()]);
      if (mine !== generation) return;
      if (result.ok) {
        misses = 0;
        for (const entry of result.data) deliver(entry);
      } else if (result.code && FATAL_ROUND.has(result.code)) {
        settleAll(new WatchError(result.error, result.code));
      } else if (++misses >= MAX_MISSES) {
        settleAll(new WatchError(result.error, result.code ?? "unknown"));
      }
    } catch {
      /* fetchStatuses is expected to return a result, never throw; if it does
         anyway, count the round as missed instead of leaking a rejection. */
      if (mine === generation && ++misses >= MAX_MISSES) {
        settleAll(new WatchError("Lost contact with the studio server.", "network_error"));
      }
    } finally {
      if (mine === generation) {
        sweep();
        polling = false;
        schedule();
      }
    }
  }

  function deliver(result: StatusResult): void {
    const waiter = waiting.get(result.requestId);
    if (!waiter) return;
    if ("error" in result) {
      /* A transient per-request failure waits for the next round; the deadline
         still bounds how long that can go on. */
      if (!result.final) return;
      waiting.delete(result.requestId);
      waiter.reject(new WatchError(result.error, (result.code as ErrorCode) ?? "unknown"));
      return;
    }
    if (!TERMINAL_STATUSES.has(result.status.status)) {
      try {
        waiter.onUpdate?.(result.status);
      } catch {
        /* a progress listener must not break polling */
      }
      return;
    }
    waiting.delete(result.requestId);
    waiter.resolve(result.status);
  }

  /* A run the provider never finishes would otherwise hold its tile open for
     the rest of the session. */
  function sweep(): void {
    const at = now();
    for (const [requestId, waiter] of [...waiting]) {
      if (at <= waiter.deadline) continue;
      waiting.delete(requestId);
      waiter.reject(
        new WatchError("Provider timeout — the run did not finish in time. It may still appear in your provider dashboard.", "timeout"),
      );
    }
  }

  function settleAll(reason: WatchError): void {
    const waiters = [...waiting.values()];
    waiting.clear();
    misses = 0;
    for (const waiter of waiters) waiter.reject(reason);
  }

  return { watch, unwatch, stop, size: () => waiting.size };
}

export type Poller = ReturnType<typeof createPoller>;
