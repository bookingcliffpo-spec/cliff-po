import { expect, test } from "@playwright/test";

/* The hosted site with Supabase connected: pictures upload straight from the
   browser to storage through a signed URL, and the server key never reaches
   the page. Checked at desktop and phone size. */
test.use({ baseURL: "http://127.0.0.1:3400", httpCredentials: undefined });

const MOCK = "http://127.0.0.1:4010";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

const DEVICES = [
  { name: "desktop", viewport: { width: 1280, height: 800 }, isMobile: false },
  { name: "phone", viewport: { width: 390, height: 844 }, isMobile: true },
];

for (const device of DEVICES) {
  test.describe(device.name, () => {
    test.use({ viewport: device.viewport, isMobile: device.isMobile, hasTouch: device.isMobile });

    test(`pictures upload to Supabase storage from the online page (${device.name})`, async ({ page, request }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      const signed: string[] = [];
      page.on("response", async (res) => {
        if (res.url().includes("/api/supabase/sign")) signed.push(await res.text());
      });

      await page.goto("/simple");
      const drop = page.getByRole("button", { name: "Upload images or a video" });
      await expect(drop).not.toContainText("work when your computer runs the studio");

      const chooser = page.waitForEvent("filechooser");
      if (device.isMobile) await drop.tap();
      else await drop.click();
      await (await chooser).setFiles([{ name: "me.png", mimeType: "image/png", buffer: PNG }]);

      await expect(page.locator(".sp-thumb")).toHaveCount(1);
      await expect(page.locator(".sp-thumb")).toHaveAttribute("data-error", "false");
      await page.getByRole("textbox", { name: "Prompt" }).fill("a portrait in neon rain");
      await expect(page.getByRole("button", { name: "Generate" })).toBeEnabled();

      const uploads = (await (await request.get(`${MOCK}/storage/v1/__uploads`)).json()) as Array<{
        key: string;
        type: string;
        size: number;
      }>;
      const mine = uploads.at(-1);
      expect(mine).toMatchObject({ type: "image/png", size: PNG.length });
      expect(mine!.key).toMatch(/^studio-uploads\/[0-9a-f]{32}\/[0-9a-f]{32}\.png$/);

      /* The public URL serves the file, as a provider would fetch it. */
      const pub = await request.get(`${MOCK}/storage/v1/object/public/${mine!.key}`);
      expect(pub.status()).toBe(200);

      expect(signed.join("")).not.toContain("e2e_supabase_key");
      await expect(page.locator(".sp-alert")).toHaveCount(0);

      if (device.isMobile) {
        /* No sideways scrolling on a phone. */
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow).toBeLessThanOrEqual(0);
        await page.screenshot({ path: "test-results/phone-upload.png", fullPage: true });
      }
      expect(errors).toEqual([]);
    });
  });
}
