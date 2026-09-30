import { expect, test, type Page } from "@playwright/test";

/* The Simple home page on the no-key server, with the fake WanGP bridge
   standing in for the GPU. */
const FREE = "http://127.0.0.1:3200";
const BRIDGE = "http://127.0.0.1:7871";

test.use({ baseURL: FREE, httpCredentials: undefined });

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);
const MP4 = Buffer.concat([Buffer.from("000000186674797069736f6d", "hex"), Buffer.alloc(256)]);

test.beforeEach(async ({ page }) => {
  page.on("pageerror", (error) => {
    throw error;
  });
});

async function bridgeLast(): Promise<{ settings: Record<string, unknown> }> {
  const res = await fetch(`${BRIDGE}/v1/debug/last`, { headers: { Authorization: "Bearer e2e-bridge-token" } });
  return res.json();
}

async function open(page: Page) {
  await page.goto("/");
  await expect(page.getByLabel("Model", { exact: true })).toHaveValue("video-free");
}

async function upload(page: Page, files: Array<{ name: string; mimeType: string; buffer: Buffer }>) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Upload images or a video" }).click();
  await (await chooser).setFiles(files);
}

test("the home page is just upload, prompt, model, duration, aspect, Generate", async ({ page }) => {
  await open(page);
  await expect(page.getByRole("button", { name: "Upload images or a video" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Prompt" })).toBeVisible();
  await expect(page.getByLabel("Duration")).toBeVisible();
  await expect(page.getByLabel("Aspect ratio")).toBeVisible();
  await expect(page.getByRole("button", { name: "Generate" })).toBeDisabled();
  /* Advanced controls stay folded away. */
  await expect(page.getByLabel("Cinematic look")).toBeHidden();
  /* Only real options — no demo when real models exist. */
  const options = await page.getByLabel("Model", { exact: true }).locator("option").allTextContents();
  expect(options).toEqual(["Video · Free (my GPU)", "Image · Free"]);
  await expect(page.getByRole("link", { name: "Advanced studio →" })).toHaveAttribute("href", "/studio");
});

test("upload images, type a prompt, press Generate → a video from your images", async ({ page }) => {
  await open(page);
  await upload(page, [
    { name: "me.png", mimeType: "image/png", buffer: PNG },
    { name: "room.png", mimeType: "image/png", buffer: PNG },
  ]);
  await expect(page.locator(".sp-thumb")).toHaveCount(2);
  await page.getByRole("textbox", { name: "Prompt" }).fill("I walk into the room and wave");
  await page.getByLabel("Duration").selectOption("10");
  await page.getByLabel("Aspect ratio").selectOption("9:16");
  await expect(page.locator(".sp-plan")).toContainText("Video from your images");
  await page.getByRole("button", { name: "Generate" }).click();

  const card = page.locator(".sp-result").first();
  await expect(card).toContainText(/Denoising · \d+%/, { timeout: 20_000 });
  await expect(card.locator("video")).toHaveAttribute("src", /^\/api\/wangp\/files\/\w+_0\.mp4$/, { timeout: 40_000 });

  const { settings } = await bridgeLast();
  expect(settings).toMatchObject({ model_type: "ltx2_22B_msr", resolution: "720x1280", video_length: "10s" });
  expect(settings.image_refs as string[]).toHaveLength(2);
  expect((settings.image_refs as string[])[0]).toMatch(/up_[0-9a-f]{32}\.png$/);

  /* It is in the shared gallery after a reload. */
  await page.reload();
  await expect(page.locator(".sp-result video").first()).toBeVisible();
});

test("prompt only, with a cinematic look from More settings", async ({ page }) => {
  await open(page);
  await page.getByRole("textbox", { name: "Prompt" }).fill("a lighthouse in a storm");
  await page.getByText("More settings").click();
  await page.getByLabel("Cinematic look").selectOption("noir");
  await page.getByRole("button", { name: "Generate" }).click();
  await expect(page.locator(".sp-result").first()).toBeVisible();
  await expect
    .poll(async () => String((await bridgeLast()).settings.prompt ?? ""), { timeout: 20_000 })
    .toMatch(/^a lighthouse in a storm\n\nStyle: film noir mood/);
  expect((await bridgeLast()).settings.model_type).toBe("ltx2_22B_distilled");
});

test("a video + 'Restyle it' needs no prompt", async ({ page }) => {
  await open(page);
  await upload(page, [{ name: "clip.mp4", mimeType: "video/mp4", buffer: MP4 }]);
  await page.getByText("More settings").click();
  await page.getByLabel("Use my video to").selectOption("restyle");
  await page.getByLabel("Style", { exact: true }).selectOption("style-claymation");
  await expect(page.getByRole("button", { name: "Generate" })).toBeEnabled();
  await page.getByRole("button", { name: "Generate" }).click();
  await expect
    .poll(async () => String((await bridgeLast()).settings.prompt ?? ""), { timeout: 20_000 })
    .toMatch(/^Restyle the whole video as claymation/);
});

test("a run can be canceled from the gallery", async ({ page }) => {
  await open(page);
  await page.getByRole("textbox", { name: "Prompt" }).fill("cancel me");
  await page.getByRole("button", { name: "Generate" }).click();
  await page.locator(".sp-result").first().getByRole("button", { name: "Cancel" }).click();
  await expect(page.locator(".sp-result").first()).toContainText("Canceled");
});

test("tells you what is missing", async ({ page }) => {
  await open(page);
  await expect(page.locator(".sp-plan")).toContainText("Type a prompt first");
  await upload(page, [{ name: "clip.mp4", mimeType: "video/mp4", buffer: MP4 }]);
  await page.getByText("More settings").click();
  await page.getByLabel("Use my video to").selectOption("motion");
  await expect(page.locator(".sp-plan")).toContainText("Upload an image of the character");
  await expect(page.getByRole("button", { name: "Generate" })).toBeDisabled();
});

test.describe("phone", () => {
  test.use({ viewport: { width: 375, height: 740 }, isMobile: true, hasTouch: true });

  test("fits the screen and the whole flow is reachable", async ({ page }) => {
    await open(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    await page.getByRole("textbox", { name: "Prompt" }).fill("sunrise over the city");
    const generate = page.getByRole("button", { name: "Generate" });
    await generate.scrollIntoViewIfNeeded();
    const box = (await generate.boundingBox())!;
    expect(box.width).toBeGreaterThan(300);
    await generate.click();
    await expect(page.locator(".sp-result").first()).toBeVisible();
  });
});
