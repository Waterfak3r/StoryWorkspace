import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test.describe.configure({ mode: "serial" });

let projectPath = "";

test("creates, adapts, exports, and reloads a story workspace", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Stories in progress" })).toBeVisible();

  await page.getByRole("button", { name: /New project|Create your first project/ }).first().click();
  await page.getByLabel("Project title").fill("Lantern Signal");
  await page.getByLabel("Premise").fill("A signal from a flooded observatory draws Mara into the storm.");
  await page.getByLabel("Genre").fill("Speculative mystery");
  await page.getByRole("button", { name: "Create project", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Lantern Signal" })).toBeVisible();
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+$/);
  projectPath = new URL(page.url()).pathname;
  await expect(page.getByRole("heading", { name: "Story bible" })).toBeVisible();

  await page.getByRole("button", { name: "New entry", exact: true }).click();
  await page.getByLabel("Title").fill("The Signal");
  await page.getByLabel("Category").selectOption("world");
  await page.getByLabel("Markdown body").fill("Mara hears the beacon beneath the flood.");
  await page.getByRole("button", { name: "Save entry", exact: true }).click();
  await expect(page.getByRole("button", { name: /^The Signal\b/ })).toBeVisible();

  await page.getByRole("button", { name: /^Outline\b/ }).first().click();
  await expect(page.getByRole("heading", { name: "Give the story a shape." })).toBeVisible();
  await page.getByRole("button", { name: "New node", exact: true }).click();
  await page.getByLabel("Title").fill("The Beacon");
  await page.getByLabel("Kind").selectOption("scene");
  await page.getByLabel("Summary").fill("Mara chooses the flooded tower.");
  await page.getByRole("button", { name: "Save node", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Workspace sections" }).getByRole("button", { name: /^The Beacon\b/ })).toBeVisible();

  await page.getByRole("button", { name: /^Chapters\b/ }).first().click();
  await expect(page.getByRole("heading", { name: "Start with the first chapter." })).toBeVisible();
  await page.getByRole("button", { name: "New chapter", exact: true }).last().click();
  await expect(page.getByRole("heading", { name: "Chapter draft" })).toBeVisible();
  await page.getByRole("textbox", { name: "Title" }).fill("Lantern opening");
  await page.getByLabel("Summary").fill("Mara follows the signal into the storm.");
  await page.getByLabel("Markdown body").fill("Mara walks into the flooded observatory.");
  await expect(page.getByText("Unsaved", { exact: true })).toBeVisible();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Open AI assist" }).click();
  const assistant = page.getByRole("complementary", { name: "AI assist" });
  await expect(assistant).toBeVisible();
  await assistant.getByLabel("Action").selectOption("adapt");
  await assistant.getByLabel("Instruction").fill("Turn this chapter into a screenplay scene.");
  await assistant.getByRole("checkbox").nth(0).check();
  await assistant.getByRole("checkbox").nth(1).check();
  await assistant.getByRole("button", { name: "Generate draft", exact: true }).click();
  await expect(assistant.getByRole("heading", { name: "Draft result" })).toBeVisible({ timeout: 20_000 });
  await expect(assistant.getByText(/Adapt.*2 references/)).toBeVisible();
  await expect(assistant.locator("pre")).toContainText("CONTEXT CHECK: THE SIGNAL + THE BEACON");
  await expect(assistant.locator("pre")).toContainText("INT. LANTERN ROOM - NIGHT");
  await assistant.getByRole("button", { name: "Save as adaptation", exact: true }).click();

  await expect(page.getByRole("heading", { name: "Adaptation draft" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Lantern opening");
  await expect(page.getByText("Screenplay scene", { exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "Title" }).fill("Lantern opening revised");
  await page.getByLabel("Markdown body").fill("INT. LANTERN ROOM - NIGHT\n\nMARA studies the storm map while the lantern signal returns.\n\nMARA\nThe signal is still alive.\n\nThe revised scene endures.");
  await expect(page.getByText("Unsaved", { exact: true })).toBeVisible();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Export Markdown", exact: true }).click();
  const preview = page.getByRole("dialog", { name: "Preview Markdown" });
  await expect(preview).toBeVisible();
  const closePreview = preview.getByRole("button", { name: "Close export preview", exact: true });
  await expect(closePreview).toBeVisible();
  const previewBox = await preview.boundingBox();
  expect(previewBox).not.toBeNull();
  if (previewBox) {
    const viewportHeight = await page.evaluate(() => window.innerHeight);
    expect(previewBox.y).toBeGreaterThanOrEqual(0);
    expect(previewBox.y + previewBox.height).toBeLessThanOrEqual(viewportHeight);
  }
  for (const label of ["Project", "Story bible entries", "Outline nodes", "Chapters", "Adaptations"]) {
    const row = preview.locator("dl > div").filter({ hasText: label });
    await expect(row.getByText("1", { exact: true })).toBeVisible();
  }

  const downloadPromise = page.waitForEvent("download");
  await preview.getByRole("button", { name: "Download Markdown", exact: true }).click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const markdown = await readFile(downloadPath as string, "utf8");
  expect(markdown).toContain("# Lantern Signal");
  expect(markdown).toContain("A signal from a flooded observatory draws Mara into the storm.");
  expect(markdown).toContain("## Story Bible");
  expect(markdown).toContain("The Signal");
  expect(markdown).toContain("Mara hears the beacon beneath the flood.");
  expect(markdown).toContain("## Outline");
  expect(markdown).toContain("The Beacon");
  expect(markdown).toContain("## Chapters");
  expect(markdown).toContain("Lantern opening");
  expect(markdown).toContain("Mara walks into the flooded observatory.");
  expect(markdown).toContain("## Adaptations");
  expect(markdown).toContain("Lantern opening revised");
  expect(markdown).toContain("The revised scene endures.");
  const sectionOrder = ["# Lantern Signal", "## Story Bible", "## Outline", "## Chapters", "## Adaptations"];
  let previousIndex = -1;
  for (const section of sectionOrder) {
    const index = markdown.indexOf(section);
    expect(index, `Missing export section ${section}`).toBeGreaterThan(previousIndex);
    previousIndex = index;
  }
  await expect(preview).toBeHidden();
  await expect(page.getByRole("button", { name: "Export Markdown", exact: true })).toBeFocused();

  await page.reload();
  await expect(page.getByRole("heading", { name: "Keep the story consistent." })).toBeVisible();
  await expect(page.getByRole("button", { name: /^The Signal\b/ })).toBeVisible();
  await page.getByRole("button", { name: /^Adaptations\b/ }).first().click();
  await expect(page.getByRole("heading", { name: "Adaptation draft" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Lantern opening revised");
  await expect(page.getByLabel("Markdown body")).toHaveValue(/The revised scene endures\./);
});

test("keeps the workspace usable on a mobile viewport", async ({ page }) => {
  test.skip(!projectPath, "The critical path did not create a project");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.goto(projectPath);
  const canvasToken = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--canvas").trim());
  expect(canvasToken).toBe("#13181c");
  const transitionDurationMs = await page.getByRole("button", { name: "Export Markdown", exact: true }).evaluate((element) => {
    const duration = getComputedStyle(element).transitionDuration.split(",")[0].trim();
    return duration.endsWith("ms") ? Number.parseFloat(duration) : Number.parseFloat(duration) * 1000;
  });
  expect(transitionDurationMs).toBeLessThanOrEqual(0.02);
  const openNavigation = page.getByRole("button", { name: "Open workspace navigation" });
  await expect(openNavigation).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(openNavigation).toBeFocused();
  await page.keyboard.press("Enter");
  const drawer = page.getByRole("dialog", { name: "Workspace navigation" });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("button", { name: /^Story bible\b/ })).toBeVisible();
  const closeDrawer = drawer.getByRole("button", { name: "Close workspace navigation" });
  await expect(closeDrawer).toBeFocused();
  await expect.poll(() => closeDrawer.evaluate((element) => {
    const style = window.getComputedStyle(element);
    return style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) >= 3 && style.outlineColor !== "rgba(0, 0, 0, 0)";
  })).toBe(true);
  await closeDrawer.press("Escape");
  await expect(drawer).toBeHidden();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(openNavigation).toBeFocused();
});
