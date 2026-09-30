import { describe, expect, it } from "vitest";

import { validatePlane } from "@/generation/validate-plane";
import { PlanError, availableTargets, planSimple, type SimpleInput } from "@/simple/plan";

const IMG = "https://cdn.test/a.png";
const IMG2 = "https://cdn.test/b.png";
const VID = "https://cdn.test/v.mp4";

const base: SimpleInput = { target: "video-free", prompt: "a fox runs", images: [], duration: 5, aspect: "16:9" };
const run = (patch: Partial<SimpleInput>) => planSimple({ ...base, ...patch });
/* Every plan must pass the same server validation a real press goes through. */
const valid = (patch: Partial<SimpleInput>) => {
  const plan = run(patch);
  expect(() => validatePlane(plan.plane)).not.toThrow();
  return plan;
};

describe("simple page → generation", () => {
  it("prompt only → free text-to-video", () => {
    const plan = valid({});
    expect(plan.plane.model).toBe("wangp-cinema");
    expect(plan.plane.settings).toMatchObject({ duration: 5, aspectRatio: "16:9", resolution: "720p", generateAudio: true });
  });

  it("images → reference-to-video, capped at 5 with a note", () => {
    const images = Array.from({ length: 7 }, (_, i) => ({ url: `https://cdn.test/${i}.png` }));
    const plan = valid({ images });
    expect(plan.plane.model).toBe("wangp-reference");
    expect(plan.plane.media.reference).toHaveLength(5);
    expect(plan.notes.join(" ")).toMatch(/up to 5/);
  });

  it("video + prompt → edit, using the first image as a reference", () => {
    const plan = valid({ video: VID, images: [{ url: IMG }, { url: IMG2 }] });
    expect(plan.plane.model).toBe("wangp-edit");
    expect(plan.plane.media.reference).toHaveLength(1);
  });

  it("video actions from More settings", () => {
    expect(valid({ video: VID, videoAction: "extend", duration: 30 }).plane).toMatchObject({
      model: "wangp-extend",
      settings: { duration: 20 },
    });
    expect(valid({ video: VID, images: [{ url: IMG }], videoAction: "motion", prompt: "" }).plane.model).toBe("wangp-motion");
    expect(valid({ video: VID, images: [{ url: IMG }], videoAction: "swap-character", prompt: "" }).plane.settings.preset).toBe(
      "swap-character",
    );
    expect(
      valid({ video: VID, images: [{ url: IMG, tag: "product" }], videoAction: "swap-object", prompt: "" }).plane.settings.preset,
    ).toBe("swap-product");
    expect(valid({ video: VID, videoAction: "restyle", restyle: "style-noir", prompt: "" }).plane.settings.preset).toBe("style-noir");
  });

  it("start and end frames → animate between them", () => {
    const plan = valid({ start: IMG, end: IMG2, images: [{ url: IMG }] });
    expect(plan.plane.model).toBe("wangp-cinema");
    expect(plan.plane.media.start).toHaveLength(1);
    expect(plan.plane.media.end).toHaveLength(1);
    expect(plan.notes.join(" ")).toMatch(/reference images are ignored/);
  });

  it("explains what is missing instead of failing later", () => {
    expect(() => run({ prompt: "" })).toThrow(PlanError);
    expect(() => run({ end: IMG })).toThrow(/end frame needs a start frame/);
    expect(() => run({ video: VID, videoAction: "motion" })).toThrow(/image of the character/);
    expect(() => run({ video: VID, videoAction: "swap-object" })).toThrow(/replacement/);
  });

  it("Seedance: references, start frame, video edit; swaps point to the free model", () => {
    expect(valid({ target: "video-seedance", images: [{ url: IMG }] }).plane.model).toBe("seedance-2.5");
    expect(valid({ target: "video-seedance", start: IMG }).plane.media.start).toHaveLength(1);
    expect(valid({ target: "video-seedance", video: VID }).plane.model).toBe("seedance-2.5-edit");
    expect(() => run({ target: "video-seedance", video: VID, videoAction: "motion" })).toThrow(/Video · Free/);
  });

  it("free image ignores uploads, with a note", () => {
    const plan = valid({ target: "image-free", images: [{ url: IMG }], aspect: "9:16" });
    expect(plan.plane).toMatchObject({ model: "free-flux", settings: { aspectRatio: "9:16" } });
    expect(plan.notes).toHaveLength(1);
  });

  it("offers only what the server can run, and the demo only as a last resort", () => {
    expect(availableTargets(["wangp", "pollinations", "demo"]).map((t) => t.id)).toEqual(["video-free", "image-free"]);
    expect(availableTargets(["demo"]).map((t) => t.id)).toEqual(["demo"]);
    expect(availableTargets(["higgsfield", "pollinations"]).map((t) => t.id)).toEqual(["video-seedance", "image-free"]);
  });
});
