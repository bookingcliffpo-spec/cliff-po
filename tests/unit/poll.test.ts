import { describe, expect, it } from "vitest";

import type { StatusResult } from "@/generation/higgsfield/types";
import { WatchError, createPoller } from "@/generation/poll";
import { fail, ok, type ActionResult } from "@/generation/result";

/** A poller on a hand-cranked clock: tick() fires the pending timer and waits
    for the round it started to finish. */
function harness(answers: Array<ActionResult<StatusResult[]> | ((ids: string[]) => ActionResult<StatusResult[]>)>) {
  let clock = 0;
  let pending: (() => void) | null = null;
  const asked: string[][] = [];
  const poller = createPoller({
    intervalMs: 1000,
    now: () => clock,
    setTimer: (run) => {
      pending = run;
      return 1;
    },
    clearTimer: () => {
      pending = null;
    },
    fetchStatuses: async (ids) => {
      asked.push(ids);
      const next = answers.shift() ?? ok([]);
      return typeof next === "function" ? next(ids) : next;
    },
  });
  async function tick(advance = 1000) {
    clock += advance;
    const run = pending;
    pending = null;
    run?.();
    for (let i = 0; i < 5; i++) await Promise.resolve();
  }
  return { poller, tick, asked, hasTimer: () => pending !== null };
}

const running = (id: string): StatusResult => ({ requestId: id, status: { status: "in_progress", requestId: id } });
const done = (id: string): StatusResult => ({
  requestId: id,
  status: { status: "completed", requestId: id, video: { url: `https://cdn/${id}.mp4` } },
});

describe("poller", () => {
  it("resolves when the provider reports completion", async () => {
    const h = harness([ok([running("a")]), ok([done("a")])]);
    const watched = h.poller.watch("a", { deadline: 60_000 });
    await h.tick();
    expect(h.poller.size()).toBe(1);
    await h.tick();
    await expect(watched).resolves.toMatchObject({ status: "completed", video: { url: "https://cdn/a.mp4" } });
    expect(h.poller.size()).toBe(0);
    expect(h.hasTimer()).toBe(false);
  });

  it("asks for every watched request in one call and dedupes repeat watches", async () => {
    const h = harness([ok([done("a"), done("b")])]);
    const first = h.poller.watch("a", { deadline: 60_000 });
    const again = h.poller.watch("a", { deadline: 60_000 });
    const second = h.poller.watch("b", { deadline: 60_000 });
    expect(again).toBe(first);
    await h.tick();
    expect(h.asked).toEqual([["a", "b"]]);
    await expect(first).resolves.toMatchObject({ status: "completed" });
    await expect(second).resolves.toMatchObject({ status: "completed" });
  });

  it("times out a run that never finishes", async () => {
    const h = harness([ok([running("a")]), ok([running("a")])]);
    const watched = h.poller.watch("a", { deadline: 1500 });
    const outcome = watched.catch((reason: unknown) => reason);
    await h.tick(1000);
    await h.tick(1000);
    const reason = await outcome;
    expect(reason).toBeInstanceOf(WatchError);
    expect((reason as WatchError).code).toBe("timeout");
    expect((reason as WatchError).message).toMatch(/Provider timeout/);
  });

  it("times out even while every round is failing", async () => {
    const h = harness([fail("flaky", "network_error"), fail("flaky", "network_error")]);
    const outcome = h.poller.watch("a", { deadline: 1500 }).catch((reason: unknown) => reason);
    await h.tick(1000);
    await h.tick(1000);
    expect(await outcome).toMatchObject({ code: "timeout" });
  });

  it("settles everything at once on a round that waiting cannot fix", async () => {
    const h = harness([fail("Invalid API key", "invalid_api_key")]);
    const a = h.poller.watch("a", { deadline: 60_000 }).catch((reason: unknown) => reason);
    const b = h.poller.watch("b", { deadline: 60_000 }).catch((reason: unknown) => reason);
    await h.tick();
    expect(await a).toMatchObject({ code: "invalid_api_key", message: "Invalid API key" });
    expect(await b).toMatchObject({ code: "invalid_api_key" });
  });

  it("rides out transient round failures", async () => {
    const h = harness([fail("x", "network_error"), fail("x", "network_error"), ok([done("a")])]);
    const watched = h.poller.watch("a", { deadline: 60_000 });
    await h.tick();
    await h.tick();
    await h.tick();
    await expect(watched).resolves.toMatchObject({ status: "completed" });
  });

  it("gives up after repeated failed rounds", async () => {
    const h = harness(Array.from({ length: 4 }, () => fail("down", "provider_unavailable")));
    const outcome = h.poller.watch("a", { deadline: 60_000 }).catch((reason: unknown) => reason);
    for (let i = 0; i < 4; i++) await h.tick();
    expect(await outcome).toMatchObject({ code: "provider_unavailable" });
  });

  it("rejects a request whose error is final, keeps polling one that is not", async () => {
    const h = harness([
      ok([
        { requestId: "a", error: "gone", code: "not_found", final: true },
        { requestId: "b", error: "blip", code: "provider_unavailable", final: false },
      ]),
      ok([done("b")]),
    ]);
    const a = h.poller.watch("a", { deadline: 60_000 }).catch((reason: unknown) => reason);
    const b = h.poller.watch("b", { deadline: 60_000 });
    await h.tick();
    expect(await a).toMatchObject({ code: "not_found" });
    await h.tick();
    await expect(b).resolves.toMatchObject({ status: "completed" });
  });

  it("stop() cancels watches and ignores a round already in flight", async () => {
    let release: (value: ActionResult<StatusResult[]>) => void = () => {};
    const slow = new Promise<ActionResult<StatusResult[]>>((resolve) => {
      release = resolve;
    });
    let clockRun: (() => void) | null = null;
    const poller = createPoller({
      setTimer: (run) => {
        clockRun = run;
        return 1;
      },
      clearTimer: () => {
        clockRun = null;
      },
      fetchStatuses: () => slow,
    });
    const outcome = poller.watch("a", { deadline: Date.now() + 60_000 }).catch((reason: unknown) => reason);
    (clockRun as (() => void) | null)?.();
    poller.stop();
    expect(await outcome).toMatchObject({ code: "canceled" });
    release(ok([done("a")]));
    await Promise.resolve();
    expect(poller.size()).toBe(0);
  });

  it("never lets a throwing fetch escape as an unhandled rejection", async () => {
    const h = harness([
      () => {
        throw new Error("transport");
      },
      ok([done("a")]),
    ]);
    const watched = h.poller.watch("a", { deadline: 60_000 });
    await h.tick();
    await h.tick();
    await expect(watched).resolves.toMatchObject({ status: "completed" });
  });
});
