import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

const PROJECT_TITLE = "Storyboard Generate Lock";
const SCRIPT = "Jill waits under a lantern.\n\nShe looks toward the water.";

test.describe.configure({ mode: "serial" });

async function waitForSaveState(page: Page, state: "saved" | "saving" | "conflict") {
  await expect(page.locator("[data-save-state]")).toHaveAttribute("data-save-state", state);
}

test("generates a comic page on Story, locks it, and shows the lock on Workflow", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Stories in progress" })).toBeVisible();
  await page.getByRole("button", { name: "New project" }).first().click();
  await page.getByLabel("Project title").fill(PROJECT_TITLE);
  await page.getByRole("button", { name: "Create project" }).click();

  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByRole("heading", { name: PROJECT_TITLE })).toBeVisible();
  await page.getByRole("button", { name: "Open" }).click();
  await expect(page).toHaveURL(/\/projects\/storyboard-generate-lock(?:\?|$)/);

  await page.getByRole("navigation", { name: "Workspace sections" }).getByRole("button", { name: "Story", exact: true }).click();
  await expect(page.getByLabel("Script")).toBeVisible();
  await waitForSaveState(page, "saved");

  const save = page.waitForResponse((response) => {
    return (
      response.request().method() === "PATCH"
      && /\/api\/studio\/projects\/[^/]+\/volumes\/[^/]+\/chapters\/[^/]+\/scenes\/[^/]+$/.test(
        new URL(response.url()).pathname,
      )
      && response.ok()
    );
  }, { timeout: 15_000 });
  await page.getByLabel("Script").fill(SCRIPT);
  await waitForSaveState(page, "saving");
  await save;
  await waitForSaveState(page, "saved");

  const directed = page.waitForResponse((response) => {
    return (
      response.request().method() === "POST"
      && /\/director$/.test(new URL(response.url()).pathname)
      && response.ok()
    );
  }, { timeout: 30_000 });
  await page.getByRole("button", { name: "Run director" }).click();
  await directed;
  await expect(page.getByRole("button", { name: "Generate comic page" })).toBeVisible();

  const generated = page.waitForResponse((response) => {
    return (
      response.request().method() === "POST"
      && /\/shots\/[^/]+\/generate$/.test(new URL(response.url()).pathname)
      && response.ok()
    );
  }, { timeout: 30_000 });
  await page.getByRole("button", { name: "Generate comic page" }).click();
  await generated;

  const pageImage = page.getByRole("img", { name: "Generated comic page" });
  await expect(pageImage).toBeVisible();
  await expect(pageImage).toHaveAttribute("src", /\/api\/studio\/projects\/[^/]+\/files\/outputs\//);
  await expect.poll(async () => pageImage.evaluate((element) => {
    const image = element as HTMLImageElement;
    return image.naturalWidth;
  })).toBeGreaterThan(0);

  const locked = page.waitForResponse((response) => {
    return (
      response.request().method() === "POST"
      && /\/shots\/[^/]+\/lock$/.test(new URL(response.url()).pathname)
      && response.ok()
    );
  }, { timeout: 15_000 });
  await page.getByRole("button", { name: "Lock", exact: true }).click();
  await locked;
  await expect(page.getByText("Locked", { exact: true }).first()).toBeVisible();

  await page.getByRole("navigation", { name: "Workspace sections" }).getByRole("button", { name: "Workflow", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Workflow nodes" })).toBeVisible();
  await expect(page.getByText("锁定", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Re-run" }).first()).toBeDisabled();
  await expect(page.getByRole("button", { name: "Unlock" }).first()).toBeVisible();

  const evidenceDir = process.env.STORYBOARD_EVIDENCE_DIR;
  if (evidenceDir) {
    await page.screenshot({ path: path.join(evidenceDir, "story-generate-lock.png"), fullPage: true });
  }
});
