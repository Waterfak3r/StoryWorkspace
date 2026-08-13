import { expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

let projectPath = "";

test("proposes, accepts, and resolves a current-revision Scene State", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Stories in progress" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Loading projects" })).toBeHidden();

  await page.getByRole("button", { name: /New project|Create your first project/ }).first().click();
  await page.getByLabel("Project title").fill("Phase Three Continuity State");
  await page.getByLabel("Premise").fill("Temporary scene state stays reviewable and group-bound.");
  await page.getByLabel("Genre").fill("Mystery");
  await page.getByRole("button", { name: "Create project", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Phase Three Continuity State" })).toBeVisible();

  const projectCard = page.getByRole("article").filter({ has: page.getByRole("heading", { name: "Phase Three Continuity State" }) });
  await projectCard.getByRole("button", { name: "Open", exact: true }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+$/);
  projectPath = new URL(page.url()).pathname;

  await page.getByRole("button", { name: /^Scripts\b/ }).first().click();
  await expect(page.getByRole("heading", { name: "Start a script document." })).toBeVisible();
  await page.getByRole("button", { name: "New script document" }).click();
  await expect(page.getByRole("heading", { name: "Untitled script", level: 2 })).toBeVisible();

  await page.getByRole("button", { name: "Add scene", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("Wardrobe continuity");
  await page.getByLabel("Content", { exact: true }).fill("Lin Mo enters wearing a faded black coat and carries the silver key.");
  await page.getByRole("button", { name: "Save revision", exact: true }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "New entity", exact: true }).click();
  await page.getByLabel("Type", { exact: true }).selectOption("character");
  await page.getByLabel("Canonical name", { exact: true }).fill("Lin Mo");
  await page.getByRole("button", { name: "Create entity", exact: true }).click();
  await expect(page.getByText("Lin Mo", { exact: true }).last()).toBeVisible();

  await page.getByRole("button", { name: "New entity", exact: true }).click();
  await page.getByLabel("Type", { exact: true }).selectOption("prop");
  await page.getByLabel("Canonical name", { exact: true }).fill("Silver key");
  await page.getByRole("button", { name: "Create entity", exact: true }).click();
  await expect(page.getByText("Silver key", { exact: true }).last()).toBeVisible();

  await page.getByRole("button", { name: "Analyze scene", exact: true }).click();
  await expect(page.getByText("Status: Succeeded", { exact: true })).toBeVisible({ timeout: 20_000 });
  const confirmLinMo = page.getByRole("button", { name: /Confirm mention .*Lin Mo/i }).first();
  if (await confirmLinMo.isVisible()) {
    await confirmLinMo.click();
    await expect(page.getByText("confirmed", { exact: true }).first()).toBeVisible({ timeout: 15_000 });
  }

  await page.getByRole("button", { name: "New group", exact: true }).click();
  await page.getByLabel("Group type").selectOption("flashback");
  await page.getByLabel("Group name").fill("Flashback lane");
  await page.getByRole("button", { name: "Create and use group", exact: true }).click();
  await expect(page.getByText("Continuity group “Flashback lane” created and selected.", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Continuity group", { exact: true }).locator("option:checked")).toHaveText("Flashback lane · flashback");
  const stateComposer = page.getByTestId("state-patch-composer");
  await expect(stateComposer).toBeVisible();
  await expect(stateComposer.getByRole("button", { name: "Propose State Patch", exact: true })).toBeDisabled();
  await expect(stateComposer.getByText("Save this revision first so the selected continuity group is frozen before State review.", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Save revision", exact: true }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Analyze scene", exact: true }).click();
  await expect(page.getByText("Status: Succeeded", { exact: true })).toBeVisible({ timeout: 20_000 });
  const confirmCurrentLinMo = page.getByRole("button", { name: /Confirm mention .*Lin Mo/i }).first();
  if (await confirmCurrentLinMo.isVisible()) {
    await confirmCurrentLinMo.click();
    await expect(page.getByText("confirmed", { exact: true }).first()).toBeVisible({ timeout: 15_000 });
  }
  await stateComposer.getByLabel("State predicate").selectOption("wardrobe.current");
  await stateComposer.getByLabel("State value").fill("faded black coat");
  await stateComposer.getByLabel("Exact evidence quote").fill("faded black coat");
  await stateComposer.getByRole("checkbox", { name: /Carry forward within this group/ }).check();
  await stateComposer.getByRole("button", { name: "Propose State Patch", exact: true }).click();

  const statePatch = page.locator("li[data-testid^='canon-patch-']").filter({ hasText: "wardrobe.current" }).last();
  await expect(statePatch).toBeVisible({ timeout: 15_000 });
  await statePatch.getByRole("button", { name: "Accept", exact: true }).click();
  await expect(statePatch.getByText(/Canon applied|accepted/i)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("State Patch accepted; Scene State is now visible.", { exact: true })).toBeVisible({ timeout: 15_000 });

  const resolved = page.getByTestId("resolved-state-inspector");
  await expect(resolved).toBeVisible();
  await expect(resolved.getByText("Explicit Scene State", { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(resolved.getByText("faded black coat", { exact: true })).toBeVisible();
});

test("keeps Phase 3 state controls usable on mobile without horizontal overflow", async ({ page }) => {
  test.skip(!projectPath, "The Phase 3 flow did not create a project");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(projectPath);
  const openNavigation = page.getByRole("button", { name: "Open workspace navigation" });
  if (await openNavigation.isVisible()) {
    await openNavigation.click();
    await page.getByRole("dialog", { name: "Workspace navigation" }).getByRole("button", { name: /^Scripts\b/ }).click();
  } else {
    await page.getByRole("button", { name: /^Scripts\b/ }).first().click();
  }
  await expect(page.getByTestId("state-patch-composer")).toBeVisible();
  await expect(page.getByTestId("resolved-state-inspector")).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
