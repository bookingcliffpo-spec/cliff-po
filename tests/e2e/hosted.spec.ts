import { expect, test } from "@playwright/test";

/* The online link: nothing configured. Uploads have nowhere to go, so the page
   must explain that instead of failing with a configuration error. */
test.use({ baseURL: "http://127.0.0.1:3300", httpCredentials: undefined });

test("uploads explain how to get free video instead of erroring", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/simple");
  await expect(page.getByLabel("Model", { exact: true })).toHaveValue("image-free");
  const drop = page.getByRole("button", { name: "Upload images or a video" });
  await expect(drop).toContainText("Photos & videos work when your computer runs the studio");

  /* Tapping it opens the how-to, not a file picker. */
  let chooserOpened = false;
  page.on("filechooser", () => (chooserOpened = true));
  await drop.click();
  await expect(page.locator("#sp-setup")).toHaveAttribute("open", "");
  await expect(page.locator("#sp-setup")).toContainText("start-free-studio");
  expect(chooserOpened).toBe(false);
  await expect(page.locator(".sp-alert")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("OPEN_HIGGSFIELD_READ_WRITE_TOKEN");

  /* Prompt-only images still work. */
  await page.getByRole("textbox", { name: "Prompt" }).fill("a red fox in snow");
  await expect(page.getByRole("button", { name: "Generate" })).toBeEnabled();
  expect(errors).toEqual([]);
});
