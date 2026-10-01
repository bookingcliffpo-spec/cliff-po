import { expect, test, type Page } from "@playwright/test";

/* The phone-first home page, at phone size, on the no-key server with the
   fake WanGP bridge, and on hosted-like servers. */
const FREE = "http://127.0.0.1:3200";
const HOSTED = "http://127.0.0.1:3300";
const SUPABASE = "http://127.0.0.1:3400";
const BRIDGE = "http://127.0.0.1:7871";

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, httpCredentials: undefined });

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

test.beforeEach(async ({ page }) => {
  page.on("pageerror", (error) => {
    throw error;
  });
});

async function bridgeLast(): Promise<{ settings: Record<string, unknown> }> {
  const res = await fetch(`${BRIDGE}/v1/debug/last`, { headers: { Authorization: "Bearer e2e-bridge-token" } });
  return res.json();
}

async function uploadPhoto(page: Page) {
  await page.getByRole("tab", { name: "Upload" }).tap();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Upload images or a video" }).tap();
  await (await chooser).setFiles([{ name: "me.png", mimeType: "image/png", buffer: PNG }]);
  await expect(page.locator(".mo-strip .mo-thumb")).toHaveCount(1);
  await expect(page.locator(".mo-thumb-bar")).toHaveCount(0);
}

async function noSideScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
}

test("the home page: tabs, model card, prompt, panels, Generate, jobs", async ({ page }) => {
  await page.goto(`${FREE}/`);
  for (const tab of ["Jobs", "Video", "Image", "Assets"]) {
    await expect(page.getByRole("tablist", { name: "Sections" }).getByRole("tab", { name: tab })).toBeVisible();
  }
  await expect(page.getByRole("button", { name: "Model: WanGP Video" })).toContainText("Text → Video");
  await expect(page.getByRole("button", { name: "Generate" })).toBeDisabled();
  await expect(page.getByRole("group", { name: "Aspect ratio" })).toBeVisible();
  await expect(page.getByLabel("Duration")).toBeVisible();
  await expect(page.getByRole("switch", { name: "Audio" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("region", { name: "Active jobs" })).toContainText("No jobs running");

  /* The model card opens the list of models this server can run. */
  await page.getByRole("button", { name: "Model: WanGP Video" }).tap();
  const options = await page.getByRole("listbox", { name: "Models" }).getByRole("option").allTextContents();
  expect(options.map((o) => o.split("Runs")[0]!.split("Free")[0]!.trim())).toEqual(["WanGP Video", "Flux Image"]);
  await page.getByRole("option", { name: /WanGP Video/ }).tap();
  await noSideScroll(page);
  await page.screenshot({ path: "test-results/motion-home.png", fullPage: true });
});

test("upload a photo, type a prompt, batch 2 → two jobs, then results in Video", async ({ page }) => {
  await page.goto(`${FREE}/`);
  await uploadPhoto(page);
  await expect(page.getByRole("button", { name: /^Model:/ })).toContainText("Image → Video");

  await page.getByRole("tab", { name: "Settings" }).tap();
  await page.getByRole("group", { name: "Aspect ratio" }).getByRole("button", { name: "9:16" }).tap();
  await page.getByRole("textbox", { name: "Prompt" }).fill("I walk into neon rain and smile");
  await page.getByRole("button", { name: "Batch size 1" }).tap();
  await expect(page.getByRole("button", { name: "Batch size 2" })).toBeVisible();
  await page.getByRole("button", { name: "Generate" }).tap();

  const jobs = page.getByRole("region", { name: "Active jobs" });
  await expect(jobs.locator(".mo-job")).toHaveCount(2, { timeout: 15_000 });
  await expect(jobs).toContainText(/Denoising · \d+%/, { timeout: 20_000 });
  await page.screenshot({ path: "test-results/motion-jobs.png", fullPage: true });

  const { settings } = await bridgeLast();
  expect(settings).toMatchObject({ model_type: "ltx2_22B_msr", resolution: "720x1280" });
  expect((settings.image_refs as string[])[0]).toMatch(/up_[0-9a-f]{32}\.png$/);

  await expect(jobs.locator(".mo-job")).toHaveCount(0, { timeout: 60_000 });
  await page.getByRole("tab", { name: "Video" }).tap();
  await expect(page.locator(".mo-result video").first()).toHaveAttribute("src", /^\/api\/wangp\/files\/\w+_0\.mp4$/);
  expect(await page.locator(".mo-result video").count()).toBeGreaterThanOrEqual(2);

  await page.getByRole("tab", { name: "Assets" }).tap();
  await expect(page.locator(".mo-grid .mo-thumb")).toHaveCount(1);
});

test("the online site without storage explains uploads in the Upload panel", async ({ page }) => {
  await page.goto(`${HOSTED}/`);
  await expect(page.getByRole("button", { name: "Model: Flux Image" })).toContainText("Text → Image");
  await page.getByRole("tab", { name: "Upload" }).tap();
  await expect(page.locator(".mo-setup")).toContainText("start-free-studio");
  await expect(page.locator("body")).not.toContainText("OPEN_HIGGSFIELD_READ_WRITE_TOKEN");
  await page.getByRole("textbox", { name: "Prompt" }).fill("a red fox in snow");
  await expect(page.getByRole("button", { name: "Generate" })).toBeEnabled();
  await noSideScroll(page);
});

test("the online site with Supabase takes photos from the phone", async ({ page }) => {
  await page.goto(`${SUPABASE}/`);
  await uploadPhoto(page);
  await expect(page.locator(".mo-thumb")).toHaveAttribute("data-error", "false");
  await expect(page.locator(".mo-alert")).toHaveCount(0);
  await page.screenshot({ path: "test-results/motion-upload.png", fullPage: true });
});
