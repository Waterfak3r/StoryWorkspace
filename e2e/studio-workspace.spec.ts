import { expect, test, type Page } from "@playwright/test";

const PROJECT_TITLE = "Harbor Night";
const SCRIPT = "Harbor lanterns cut the fog in a thin gold line.";
const CHARACTER_NAME = "Jill";
const CHARACTER_DESCRIPTION = "A night-shift lookout who keeps the harbor charts.";

test.describe.configure({ mode: "serial" });

async function waitForSaveState(page: Page, state: "saved" | "saving" | "conflict") {
  await expect(page.locator("[data-save-state]")).toHaveAttribute("data-save-state", state);
}

async function fillAndWaitForAutosave(
  page: Page,
  fill: () => Promise<void>,
  pathnamePattern: RegExp,
) {
  const save = page.waitForResponse((response) => {
    return (
      response.request().method() === "PATCH"
      && pathnamePattern.test(new URL(response.url()).pathname)
      && response.ok()
    );
  }, { timeout: 15_000 });

  await fill();
  await waitForSaveState(page, "saving");
  await save;
  await waitForSaveState(page, "saved");
}

test("creates a JSON project, keeps a scene script, and keeps a character after reload", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Stories in progress" })).toBeVisible();
  await page.getByRole("button", { name: "New project" }).first().click();
  await page.getByLabel("Project title").fill(PROJECT_TITLE);
  await page.getByRole("button", { name: "Create project" }).click();

  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByRole("heading", { name: PROJECT_TITLE })).toBeVisible();
  await page.getByRole("button", { name: "Open" }).click();
  await expect(page).toHaveURL(/\/projects\/harbor-night(?:\?|$)/);

  await page.getByRole("navigation", { name: "Workspace sections" }).getByRole("button", { name: "Story" }).click();
  await expect(page.getByRole("button", { name: "Untitled scene" })).toBeVisible();
  await expect(page.getByLabel("Script")).toBeVisible();
  await waitForSaveState(page, "saved");

  await fillAndWaitForAutosave(
    page,
    async () => {
      await page.getByLabel("Script").fill(SCRIPT);
    },
    /\/api\/studio\/projects\/[^/]+\/volumes\/[^/]+\/chapters\/[^/]+\/scenes\/[^/]+$/,
  );

  await page.reload();
  await expect(page.getByLabel("Script")).toHaveValue(SCRIPT);

  await page.getByRole("navigation", { name: "Workspace sections" }).getByRole("button", { name: "Entities" }).click();
  await page.getByLabel("Character name").fill(CHARACTER_NAME);
  await page.getByRole("button", { name: "New character" }).click();
  await expect(page.getByRole("button", { name: CHARACTER_NAME })).toBeVisible();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(CHARACTER_NAME);
  await waitForSaveState(page, "saved");

  await fillAndWaitForAutosave(
    page,
    async () => {
      await page.getByLabel("Description").fill(CHARACTER_DESCRIPTION);
    },
    /\/api\/studio\/projects\/[^/]+\/entities\/[^/]+$/,
  );

  await page.reload();
  await expect(page.getByRole("button", { name: CHARACTER_NAME })).toBeVisible();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(CHARACTER_NAME);
  await expect(page.getByLabel("Description")).toHaveValue(CHARACTER_DESCRIPTION);
});
