import { expect, test } from "@playwright/test";

test("switches the interface language and remembers the choice", async ({ page, context }) => {
  await page.goto("/");

  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.getByRole("button", { name: "Switch to Simplified Chinese" }).click();

  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(page.getByRole("heading", { name: "正在创作的故事" })).toBeVisible();
  await expect.poll(async () => (await context.cookies()).find((cookie) => cookie.name === "story-locale")?.value).toBe("zh-CN");

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(page.getByRole("heading", { name: "正在创作的故事" })).toBeVisible();

  await page.getByRole("button").filter({ hasText: "English" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { name: "Stories in progress" })).toBeVisible();
});
