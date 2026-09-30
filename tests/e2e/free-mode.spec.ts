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
  await open(page);
  await page.locator(".ohf-ctl--model").click();
  const rows = page.locator(".ohf-model-row-name");
  await expect(rows).toHaveText(["Flux · Free", "Turbo · Free", "Stable Diffusion · Local GPU", "Demo · Offline"]);
});

test("demo model generates offline with no key", async ({ page }) => {
  await open(page);
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
  await open(page);
  await pickModel(page, "Flux · Free");
  await page.getByRole("textbox", { name: "Prompt" }).fill("a red fox in snow");
  await page.locator("button.ohf-generate").click();
  const img = page.locator(".ohf-tile:not(.ohf-tile--failed) img.ohf-tile-media").first();
  await expect(img).toHaveAttribute("src", /^https:\/\/image\.pollinations\.ai\/prompt\/a%20red%20fox%20in%20snow\?/);
});

test("local Stable Diffusion stores and serves its image", async ({ page }) => {
  await open(page);
  await pickModel(page, "Stable Diffusion · Local GPU");
  await page.getByRole("textbox", { name: "Prompt" }).fill("castle on a cliff");
  await page.locator("button.ohf-generate").click();
  const img = page.locator(".ohf-tile:not(.ohf-tile--failed) img.ohf-tile-media").first();
  await expect(img).toHaveAttribute("src", /^\/api\/media\/[a-f0-9]{32}\.png$/);
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
});

test("the Video tab explains that video needs a key", async ({ page }) => {
  await open(page);
  await page.getByRole("tab", { name: "Video" }).click();
  await expect(page.locator(".ohf-alert")).toContainText("Video needs a provider key");
});
