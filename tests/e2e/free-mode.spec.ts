import { expect, test, type Page } from "@playwright/test";

/* The studio with no API key and no provider configured. */
const FREE = "http://127.0.0.1:3200";

test.use({ baseURL: FREE, httpCredentials: undefined });

test.beforeEach(async ({ page }) => {
  page.on("pageerror", (error) => {
    throw error;
  });
});

async function open(page: Page) {
  await page.goto("/");
  await expect(page.locator(".ohf-key")).toContainText("Free mode");
}

async function openImage(page: Page) {
  await open(page);
  await page.getByRole("tab", { name: "Image" }).click();
}

async function pickModel(page: Page, label: string) {
  await page.locator(".ohf-ctl--model").click();
  await page.locator(".ohf-model-row", { hasText: label }).first().click();
  await expect(page.locator(".ohf-ctl--model")).toContainText(label);
}

test("opens straight into free mode: no key prompt, no config error", async ({ page }) => {
  await open(page);
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await expect(page.locator(".ohf-alert")).toHaveCount(0);
  /* The saved default (a paid video model) is swapped for a free one. */
  await expect(page.locator(".ohf-ctl--model")).toContainText("Free");
});

test("the picker offers only the models this server can run", async ({ page }) => {
  await openImage(page);
  await page.locator(".ohf-ctl--model").click();
  const rows = page.locator(".ohf-model-row-name");
  await expect(rows).toHaveText(["Flux · Free", "Turbo · Free", "Stable Diffusion · Local GPU", "Demo · Offline"]);
});

test("demo model generates offline with no key", async ({ page }) => {
  await openImage(page);
  await pickModel(page, "Demo · Offline");
  await page.getByRole("textbox", { name: "Prompt" }).fill("neon koi pond at night");
  await page.locator("button.ohf-generate").click();
  const img = page.locator(".ohf-tile:not(.ohf-tile--failed) img.ohf-tile-media").first();
  await expect(img).toHaveAttribute("src", /^\/api\/demo\?p=neon\+koi\+pond/);
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
});

test("free Flux builds a keyless Pollinations image", async ({ page }) => {
  await page.route("https://image.pollinations.ai/**", (route) =>
    route.fulfill({
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
        "base64",
      ),
    }),
  );
  await openImage(page);
  await pickModel(page, "Flux · Free");
  await page.getByRole("textbox", { name: "Prompt" }).fill("a red fox in snow");
  await page.locator("button.ohf-generate").click();
  const img = page.locator(".ohf-tile:not(.ohf-tile--failed) img.ohf-tile-media").first();
  await expect(img).toHaveAttribute("src", /^https:\/\/image\.pollinations\.ai\/prompt\/a%20red%20fox%20in%20snow\?/);
});

test("local Stable Diffusion stores and serves its image", async ({ page }) => {
  await openImage(page);
  await pickModel(page, "Stable Diffusion · Local GPU");
  await page.getByRole("textbox", { name: "Prompt" }).fill("castle on a cliff");
  await page.locator("button.ohf-generate").click();
  const img = page.locator(".ohf-tile:not(.ohf-tile--failed) img.ohf-tile-media").first();
  await expect(img).toHaveAttribute("src", /^\/api\/media\/[a-f0-9]{32}\.png$/);
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
});

const BRIDGE = "http://127.0.0.1:7871";

async function bridgeLast(): Promise<{ settings: Record<string, unknown>; post: Record<string, unknown> }> {
  const res = await fetch(`${BRIDGE}/v1/debug/last`, { headers: { Authorization: "Bearer e2e-bridge-token" } });
  return res.json();
}

test("the Video tab offers the free GPU video models", async ({ page }) => {
  await open(page);
  await page.getByRole("tab", { name: "Video" }).click();
  await expect(page.locator(".ohf-ctl--model")).toContainText("Cinema Video · Free GPU");
  await page.locator(".ohf-ctl--model").click();
  await expect(page.locator(".ohf-model-row-name")).toHaveText([
    "Cinema Video · Free GPU",
    "Reference to Video · Free GPU",
    "Video Edit · Free GPU",
    "Video Extend · Free GPU",
    "Motion Transfer · Free GPU",
    "Swap & Restyle · Free GPU",
  ]);
});

test("cinematic text-to-video: Director's notes reach WanGP, progress shows, the clip lands", async ({ page }) => {
  await open(page);
  await page.getByRole("tab", { name: "Video" }).click();
  await page.getByRole("button", { name: "Director's Panel" }).click();
  const panel = page.getByRole("dialog", { name: "Director's Panel" });
  await panel.getByLabel("Genre").selectOption("noir");
  await panel.getByLabel("Camera", { exact: true }).selectOption("35mm");
  await panel.getByLabel("Camera move").selectOption("helicopter");
  await expect(panel.locator(".ohf-director-preview")).toContainText("aerial helicopter shot");
  await page.getByRole("textbox", { name: "Prompt" }).fill("a detective crosses a rain-soaked bridge");
  await page.locator("button.ohf-generate").click();

  const running = page.locator(".ohf-skeleton").first();
  await expect(running).toContainText(/Denoising · \d+%/, { timeout: 20_000 });
  const video = page.locator(".ohf-tile:not(.ohf-tile--failed) video").first();
  await expect(video).toHaveAttribute("src", /^\/api\/wangp\/files\/[A-Za-z0-9]+_0\.mp4$/, { timeout: 40_000 });

  const last = await bridgeLast();
  expect(last.settings.model_type).toBe("ltx2_22B_distilled");
  expect(String(last.settings.prompt)).toMatch(/^a detective crosses a rain-soaked bridge\n\nStyle: film noir mood/);
  expect(String(last.settings.prompt)).toContain("aerial helicopter shot");
  expect(last.settings).toMatchObject({ resolution: "1280x720", video_length: "5s" });

  /* The file route streams the bridge's output to the browser. */
  const src = await video.getAttribute("src");
  const res = await page.request.get(src!);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toBe("video/mp4");
  /* History shows the visitor's own words, not the appended notes. */
  await expect(page.locator(".ohf-tile-caption").first()).not.toContainText("Style:");
});

test("a running GPU job can be canceled", async ({ page }) => {
  await open(page);
  await page.getByRole("tab", { name: "Video" }).click();
  await page.getByRole("textbox", { name: "Prompt" }).fill("a long take to cancel");
  await page.locator("button.ohf-generate").click();
  await page.getByRole("button", { name: /^Cancel .* run$/ }).click();
  await expect(page.locator(".ohf-tile--failed").first()).toContainText("Canceled", { timeout: 15_000 });
});

test("promptless restyle preset on an uploaded clip", async ({ page }) => {
  await open(page);
  await page.getByRole("tab", { name: "Video" }).click();
  await pickModel(page, "Swap & Restyle · Free GPU");

  await page.getByRole("button", { name: /^Preset/ }).click();
  await page.getByRole("dialog", { name: "Preset" }).getByText("Style: anime", { exact: true }).click();

  await page.getByRole("button", { name: "Add an input" }).click();
  await page.getByRole("button", { name: /^Video 0\/1/ }).click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: /^Upload/ }).first().click();
  await (await chooser).setFiles({
    name: "clip.mp4",
    mimeType: "video/mp4",
    buffer: Buffer.concat([Buffer.from("000000186674797069736f6d", "hex"), Buffer.alloc(256)]),
  });
  await expect(page.locator(".ohf-strip-item")).toHaveCount(1);
  await page.keyboard.press("Escape");

  /* No words needed: the preset is the instruction. */
  await expect(page.locator("button.ohf-generate")).toBeEnabled();
  await page.locator("button.ohf-generate").click();
  await expect(page.locator(".ohf-skeleton").first()).toBeVisible();
  await expect.poll(async () => String((await bridgeLast()).settings.prompt ?? ""), { timeout: 20_000 }).toMatch(
    /^Restyle the whole video as hand-drawn anime\. Keep the original motion, the camera movement, the timing, the background/,
  );
  const last = await bridgeLast();
  expect(last.settings).toMatchObject({ model_type: "kiwi_edit_instruct_only", video_prompt_type: "UV" });
  /* The bridge downloaded the upload from the studio's public media route. */
  expect(String(last.settings.video_guide)).toMatch(/input1\.mp4$/);
});
