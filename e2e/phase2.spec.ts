import { expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

let projectPath = "";

test("proposes, accepts, rejects, and explains a conflicting Canon patch", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Stories in progress" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Loading projects" })).toBeHidden();

  await page.getByRole("button", { name: /New project|Create your first project/ }).first().click();
  await page.getByLabel("Project title").fill("Phase Two Canon Review");
  await page.getByLabel("Premise").fill("A visible evidence span becomes an auditable Canon fact.");
  await page.getByLabel("Genre").fill("Mystery");
  await page.getByRole("button", { name: "Create project", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Phase Two Canon Review" })).toBeVisible();
  const projectCard = page.getByRole("article").filter({ has: page.getByRole("heading", { name: "Phase Two Canon Review" }) });
  await projectCard.getByRole("button", { name: "Open", exact: true }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+$/);
  projectPath = new URL(page.url()).pathname;

  await page.getByRole("button", { name: /^Scripts\b/ }).first().click();
  await expect(page.getByRole("heading", { name: "Start a script document." })).toBeVisible();
  await page.getByRole("button", { name: "New script document" }).click();
  await expect(page.getByRole("heading", { name: "Untitled script", level: 2 })).toBeVisible();

  await page.getByRole("button", { name: "Add scene", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("The silver earring");
  await page.getByLabel("Content", { exact: true }).fill("Lin Mo checks the silver earring beneath the lamp.");
  await page.getByRole("button", { name: "Save revision", exact: true }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "New entity", exact: true }).click();
  await page.getByLabel("Type", { exact: true }).selectOption("character");
  await page.getByLabel("Canonical name", { exact: true }).fill("Lin Mo");
  await page.getByRole("button", { name: "Create entity", exact: true }).click();
  await expect(page.getByText("Lin Mo", { exact: true }).last()).toBeVisible();
  await expect(page.getByTestId("canon-patch-review")).toBeVisible();
  await page.getByRole("button", { name: "Analyze scene", exact: true }).click();
  await expect(page.getByText("Status: Succeeded", { exact: true })).toBeVisible({ timeout: 20_000 });

  const composer = page.getByTestId("fact-candidate-composer");
  await composer.getByLabel("Schema predicate").selectOption("appearance.hair");
  await composer.getByLabel(/^Value/).fill("black hair");
  await composer.getByLabel("Evidence quote").fill("silver earring");
  await composer.getByRole("button", { name: "Propose Canon Patch" }).click();
  const firstPatch = page.locator("li[data-testid^='canon-patch-']").filter({ hasText: "black hair" }).first();
  await expect(firstPatch.getByText("appearance.hair", { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(firstPatch).toBeVisible();
  const acceptRequestPromise = page.waitForRequest((request) => request.method() === "POST" && request.url().endsWith("/accept"));
  await firstPatch.getByRole("button", { name: "Accept", exact: true }).click();
  const acceptRequest = await acceptRequestPromise;
  expect(acceptRequest.postDataJSON()).toMatchObject({ expectedVersion: 1 });
  expect(acceptRequest.postDataJSON().requestId).toEqual(expect.any(String));
  await expect(firstPatch.getByText(/Canon applied/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Patch accepted; Canon fact is now visible.", { exact: true })).toBeVisible();

  await composer.getByLabel(/^Value/).fill("red hair");
  await composer.getByLabel("Evidence quote").fill("silver earring");
  await composer.getByRole("button", { name: "Propose Canon Patch" }).click();
  const hardConflict = page.locator("li[data-testid^='canon-patch-']").filter({ hasText: "red hair" }).first();
  await expect(hardConflict).toBeVisible({ timeout: 15_000 });
  await expect(hardConflict.getByText("Hard conflict", { exact: true })).toBeVisible();
  await expect(hardConflict.getByRole("button", { name: "Accept", exact: true })).toBeDisabled();
  const rejectRequestPromise = page.waitForRequest((request) => request.method() === "POST" && request.url().endsWith("/reject"));
  await hardConflict.getByRole("button", { name: "Reject", exact: true }).click();
  const rejectRequest = await rejectRequestPromise;
  expect(rejectRequest.postDataJSON()).toMatchObject({ expectedVersion: 1 });
  expect(rejectRequest.postDataJSON().requestId).toEqual(expect.any(String));
  await expect(hardConflict.getByText(/Rejected/)).toBeVisible({ timeout: 15_000 });
});

test("keeps Canon review usable on a narrow viewport", async ({ page }) => {
  test.skip(!projectPath, "The Canon review flow did not create a project");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(projectPath);
  const openNavigation = page.getByRole("button", { name: "Open workspace navigation" });
  if (await openNavigation.isVisible()) {
    await openNavigation.click();
    await page.getByRole("dialog", { name: "Workspace navigation" }).getByRole("button", { name: /^Scripts\b/ }).click();
  } else {
    await page.getByRole("button", { name: /^Scripts\b/ }).first().click();
  }
  await expect(page.getByTestId("canon-patch-review")).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
