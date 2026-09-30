import { expect, test, type Page } from "@playwright/test";

const MOCK = "http://127.0.0.1:4010";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

type MockCall = {
  method: string;
  path: string;
  authorized: boolean;
  body: Record<string, unknown> | null;
  media: Record<string, number>;
};

async function mockCalls(): Promise<MockCall[]> {
  const res = await fetch(`${MOCK}/__calls`);
  return (await res.json()) as MockCall[];
}

/* Fresh browser state per test, and a fresh mock log. */
test.beforeEach(async ({ page }) => {
  await fetch(`${MOCK}/__reset`, { method: "POST" });
  page.on("pageerror", (error) => {
    throw error;
  });
});

async function openStudio(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("button", { name: /server's HF_API_KEY/ })).toBeVisible();
}

async function pickModel(page: Page, label: string) {
  await page.locator(".ohf-ctl--model").click();
  await page.locator(".ohf-model-row", { hasText: label }).first().click();
  await expect(page.locator(".ohf-ctl--model")).toContainText(label);
}

async function prompt(page: Page, text: string) {
  const box = page.getByRole("textbox", { name: "Prompt" });
  await box.fill(text);
  await page.locator("button.ohf-generate").click();
}

test("health reports configuration as booleans only", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.ok()).toBe(true);
  const body = await res.json();
  expect(body).toEqual({ providerConfigured: true, storageConfigured: true });
});

test("the studio is behind APP_PASSWORD", async ({ browser }) => {
  const context = await browser.newContext({ httpCredentials: undefined });
  const res = await context.request.get("http://127.0.0.1:3100/");
  expect(res.status()).toBe(401);
  await context.close();
});

test("image generation: submit, poll, and the result lands in the gallery", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await openStudio(page);
  await page.getByRole("tab", { name: "Image" }).click();
  await pickModel(page, "Soul 2");
  await prompt(page, "a lighthouse at dusk, e2e");

  const tile = page.locator(".ohf-tile:not(.ohf-tile--failed) img.ohf-tile-media");
  await expect(tile.first()).toHaveAttribute("src", `${MOCK}/asset.png`, { timeout: 30_000 });

  const calls = await mockCalls();
  const submits = calls.filter((call) => call.method === "POST");
  expect(submits).toHaveLength(1);
  expect(submits[0]!.path).toBe("/higgsfield-ai/soul/v2/standard");
  expect(submits[0]!.authorized).toBe(true);
  expect(submits[0]!.body).toMatchObject({ prompt: "a lighthouse at dusk, e2e" });
  expect(calls.some((call) => call.method === "GET" && call.path.startsWith("/requests/"))).toBe(true);
  expect(consoleErrors.filter((text) => /Minified React error|hydrat/i.test(text))).toEqual([]);

  /* Reload: the finished run is persisted, not re-submitted. */
  await page.reload();
  await expect(tile.first()).toHaveAttribute("src", `${MOCK}/asset.png`);
  expect((await mockCalls()).filter((call) => call.method === "POST")).toHaveLength(1);
});

test("provider failures show the real, safe message — not a masked React error", async ({ page }) => {
  await openStudio(page);
  await page.getByRole("tab", { name: "Image" }).click();
  await pickModel(page, "Soul 2");
  await prompt(page, "NO_CREDITS please");

  const alert = page.locator(".ohf-alert");
  await expect(alert).toContainText("Insufficient provider balance");
  await expect(page.locator("body")).not.toContainText("Minified React error");
  await expect(page.locator("body")).not.toContainText("e2e_secret_value");

  await alert.getByRole("button", { name: "Dismiss error" }).click();
  await prompt(page, "BAD_SETTINGS now");
  await expect(page.locator(".ohf-alert")).toContainText("Unsupported settings — duration: must be at most 15");
});

test("upload a start frame and generate Seedance 2.5 image-to-video", async ({ page }) => {
  await openStudio(page);
  await page.getByRole("tab", { name: "Video" }).click();
  await expect(page.locator(".ohf-ctl--model")).toContainText("Seedance 2.5");

  await page.getByRole("button", { name: "Add an input" }).click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: /^Upload/ }).first().click();
  await (await chooser).setFiles({ name: "frame.png", mimeType: "image/png", buffer: PNG });

  /* The uploaded frame joins the strip above the prompt. */
  await expect(page.locator(".ohf-strip-thumb").first()).toHaveAttribute("src", /\/api\/media\/[a-f0-9]{32}\.png$/);
  await page.keyboard.press("Escape");

  await prompt(page, "the frame comes alive");
  await expect(page.locator(".ohf-tile:not(.ohf-tile--failed)").first()).toBeVisible({ timeout: 30_000 });

  const submits = (await mockCalls()).filter((call) => call.method === "POST");
  expect(submits).toHaveLength(1);
  expect(submits[0]!.path).toBe("/bytedance/seedance-2.5/image-to-video");
  expect(submits[0]!.body).toMatchObject({ resolution: "720p", duration: 5, generate_audio: true, output_format: "mp4" });
  expect(String(submits[0]!.body?.image_url)).toMatch(/^http:\/\/127\.0\.0\.1:3100\/api\/media\//);
  /* The provider could actually fetch the uploaded file (without the studio password). */
  expect(submits[0]!.media.image_url).toBe(200);
});

test("an unsupported upload is refused before it is sent", async ({ page }) => {
  await openStudio(page);
  await page.getByRole("tab", { name: "Video" }).click();
  await page.getByRole("button", { name: "Add an input" }).click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: /^Upload/ }).first().click();
  await (await chooser).setFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
  await expect(page.locator(".ohf-alert")).toContainText("Upload failed");
});

test.describe("mobile", () => {
  test.use({ viewport: { width: 375, height: 667 }, hasTouch: true, isMobile: true });

  test("the key dialog fits the screen and closes", async ({ page }) => {
    await openStudio(page);
    await page.getByRole("button", { name: /server's HF_API_KEY/ }).click();
    const panel = page.locator("dialog[open] .ohf-keys-panel");
    await expect(panel).toBeVisible();
    const box = (await panel.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(375);
    expect(box.y + box.height).toBeLessThanOrEqual(667);
    await page.getByRole("button", { name: "Close" }).click();
    await expect(page.locator("dialog[open]")).toHaveCount(0);
  });

  test("the composer and generate button are reachable", async ({ page }) => {
    await openStudio(page);
    const generate = page.locator("button.ohf-generate");
    await expect(generate).toBeVisible();
    const box = (await generate.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(375);
    expect(box.y + box.height).toBeLessThanOrEqual(667);
  });
});
