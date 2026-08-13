import { expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

let projectPath = "";

test("builds a video Context Snapshot from accepted Scene State without Provider submission", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const providerRequests: string[] = [];
  page.on("request", (request) => {
    if (/provider|generation|storyboard|shot|media/i.test(request.url()) && request.method() !== "GET") providerRequests.push(request.url());
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Stories in progress" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Loading projects" })).toBeHidden();

  await page.getByRole("button", { name: /New project|Create your first project/ }).first().click();
  await page.getByLabel("Project title").fill("Phase Four Context Snapshot");
  await page.getByLabel("Premise").fill("A frozen provider-neutral Context Snapshot includes accepted Scene State.");
  await page.getByLabel("Genre").fill("Mystery");
  await page.getByRole("button", { name: "Create project", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Phase Four Context Snapshot" })).toBeVisible();
  const projectCard = page.getByRole("article").filter({ has: page.getByRole("heading", { name: "Phase Four Context Snapshot" }) });
  await projectCard.getByRole("button", { name: "Open", exact: true }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+$/);
  projectPath = new URL(page.url()).pathname;

  await page.getByRole("button", { name: /^Scripts\b/ }).first().click();
  await page.getByRole("button", { name: "New script document" }).click();
  await page.getByRole("button", { name: "Add scene", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("The black coat");
  await page.getByLabel("Content", { exact: true }).fill("Lin Mo enters wearing a faded black coat.");
  await page.getByRole("button", { name: "Save revision", exact: true }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "New entity", exact: true }).click();
  await page.getByLabel("Type", { exact: true }).selectOption("character");
  await page.getByLabel("Canonical name", { exact: true }).fill("Lin Mo");
  await page.getByRole("button", { name: "Create entity", exact: true }).click();
  await expect(page.getByText("Lin Mo", { exact: true }).last()).toBeVisible();
  await page.getByRole("button", { name: "Analyze scene", exact: true }).click();
  await expect(page.getByText("Status: Succeeded", { exact: true })).toBeVisible({ timeout: 20_000 });
  const candidate = page.getByRole("button", { name: /Confirm mention .*Lin Mo/i }).first();
  if (await candidate.isVisible()) await candidate.click();
  await expect(page.getByText("confirmed", { exact: true }).first()).toBeVisible({ timeout: 15_000 });

  const stateComposer = page.getByTestId("state-patch-composer");
  await stateComposer.getByLabel("State predicate").selectOption("wardrobe.current");
  await stateComposer.getByLabel("State value").fill("faded black coat");
  await stateComposer.getByLabel("Exact evidence quote").fill("faded black coat");
  await stateComposer.getByRole("button", { name: "Propose State Patch", exact: true }).click();
  const statePatch = page.locator("li[data-testid^='canon-patch-']").filter({ hasText: "wardrobe.current" }).last();
  await expect(statePatch).toBeVisible({ timeout: 15_000 });
  await statePatch.getByRole("button", { name: "Accept", exact: true }).click();
  await expect(page.getByText("State Patch accepted; Scene State is now visible.", { exact: true })).toBeVisible({ timeout: 15_000 });

  const inspector = page.getByTestId("context-inspector");
  await expect(inspector).toBeVisible();
  await inspector.getByLabel("Context purpose").selectOption("video");
  await expect(inspector.getByLabel("Context policy")).toHaveValue("video-default-v1");
  const buildRequestPromise = page.waitForRequest((request) => request.url().endsWith("/contexts/build") && request.method() === "POST");
  await inspector.getByRole("button", { name: "Build Context Snapshot", exact: true }).click();
  const buildRequest = await buildRequestPromise;
  expect(buildRequest.postDataJSON()).toMatchObject({ sceneId: expect.any(String), sceneRevisionId: expect.any(String), purpose: "video", policyId: "video-default-v1", allowInferred: false });
  await expect(inspector.getByTestId("context-snapshot-id")).toBeVisible({ timeout: 15_000 });
  await expect(inspector.getByTestId("context-content-hash")).toHaveText(/^[a-f0-9]{64}$/i);
  await expect(inspector.getByText("Lin Mo", { exact: true })).toBeVisible();
  await expect(inspector.getByTestId("context-entity-0")).toContainText("faded black coat");
  await expect(inspector.getByTestId("context-provenance")).toContainText(/state|entity_state|scene/i);
  expect(providerRequests).toEqual([]);
});

test("disables Context build for a dirty revision and remains usable on mobile", async ({ page }) => {
  test.skip(!projectPath, "The Context Snapshot flow did not create a project");
  await page.goto(projectPath);
  await page.getByRole("button", { name: /^Scripts\b/ }).first().click();
  const inspector = page.getByTestId("context-inspector");
  await expect(inspector).toBeVisible();
  await page.getByLabel("Content", { exact: true }).fill("Lin Mo enters wearing a changed coat.");
  await expect(inspector.getByRole("button", { name: "Build Context Snapshot", exact: true })).toBeDisabled();
  await expect(inspector.getByText("Save this revision first before building a Context Snapshot.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Save revision", exact: true }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await expect(inspector.getByRole("button", { name: "Build Context Snapshot", exact: true })).toBeEnabled({ timeout: 15_000 });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.getByRole("button", { name: "Open workspace navigation" }).click();
  await page.getByRole("button", { name: /^Scripts\b/ }).first().click();
  await expect(page.getByTestId("context-inspector")).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
