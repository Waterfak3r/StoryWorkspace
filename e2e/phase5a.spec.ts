import { expect, test, type Page } from "@playwright/test";

test.describe.configure({ mode: "serial" });

let projectPath = "";

async function createStoryboardProject(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Stories in progress" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Loading projects" })).toBeHidden();
  await page.getByRole("button", { name: /New project|Create your first project/ }).first().click();
  await page.getByLabel("Project title").fill("Phase Five A Storyboard");
  await page.getByLabel("Premise").fill("A manual immutable storyboard is bound to a Context Snapshot.");
  await page.getByLabel("Genre").fill("Mystery");
  await page.getByRole("button", { name: "Create project", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Phase Five A Storyboard" })).toBeVisible();
  const projectCard = page.getByRole("article").filter({ has: page.getByRole("heading", { name: "Phase Five A Storyboard" }) });
  await projectCard.getByRole("button", { name: "Open", exact: true }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+$/);
  projectPath = new URL(page.url()).pathname;

  await page.getByRole("button", { name: /^Scripts\b/ }).first().click();
  await page.getByRole("button", { name: "New script document" }).click();
  await page.getByRole("button", { name: "Add scene", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("The entrance");
  await page.getByLabel("Content", { exact: true }).fill("Lin Mo enters the room and watches the door.");
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

  const inspector = page.getByTestId("context-inspector");
  await inspector.getByLabel("Context purpose").selectOption("storyboard");
  await expect(inspector.getByLabel("Context policy")).toHaveValue("storyboard-default-v1");
  await inspector.getByRole("button", { name: "Build Context Snapshot", exact: true }).click();
  await expect(inspector.getByTestId("context-snapshot-id")).toBeVisible({ timeout: 15_000 });
  await expect(inspector.getByTestId("storyboard-editor")).toBeVisible();
}

test("creates, edits, and approves a manual Storyboard/Shot from a Context Snapshot", async ({ page }) => {
  await createStoryboardProject(page);
  const editor = page.getByTestId("storyboard-editor");
  await editor.getByTestId("storyboard-title").fill("Door watch");
  await editor.getByLabel("Narrative purpose").fill("Establish Lin Mo watching the exit.");
  await editor.getByLabel("Action").fill("watches the door");
  const createRequestPromise = page.waitForRequest((request) => request.url().endsWith("/storyboards") && request.method() === "POST");
  await editor.getByTestId("storyboard-save").click();
  const createRequest = await createRequestPromise;
  expect(createRequest.postDataJSON()).toMatchObject({ contextSnapshotId: expect.any(String), title: "Door watch", shots: [{ narrativePurpose: "Establish Lin Mo watching the exit.", subjects: [{ action: "watches the door" }] }] });
  await expect(editor.getByText("draft", { exact: true })).toBeVisible();
  const approveRequestPromise = page.waitForRequest((request) => /\/storyboards\/[^/]+\/approve$/.test(request.url()) && request.method() === "POST");
  await editor.getByTestId("storyboard-approve").click();
  const approveRequest = await approveRequestPromise;
  expect(approveRequest.postDataJSON()).toMatchObject({ expectedVersion: 1, requestId: expect.any(String) });
  await expect(editor.getByText("approved", { exact: true })).toBeVisible();

  await editor.getByTestId("storyboard-title").fill("Door watch revised");
  const replacementRequestPromise = page.waitForRequest((request) => request.url().endsWith("/storyboards") && request.method() === "POST");
  await editor.getByTestId("storyboard-save").click();
  const replacementRequest = await replacementRequestPromise;
  expect(replacementRequest.postDataJSON()).toMatchObject({ supersedesStoryboardId: expect.any(String), expectedSupersededVersion: 2, title: "Door watch revised" });
  await expect(editor.getByText("draft", { exact: true })).toBeVisible();
  await editor.getByRole("button", { name: /^Door watch · v2$/ }).click();
  await expect(editor.getByTestId("storyboard-title")).toBeDisabled();
  await expect(editor.getByTestId("storyboard-save")).toHaveText("Superseded version");
  await expect(editor.getByTestId("storyboard-save")).toBeDisabled();
});

test("keeps the Context Snapshot immutable while the Scene is dirty and guards invalid local selection", async ({ page }) => {
  test.skip(!projectPath, "The Storyboard flow did not create a project");
  await page.goto(projectPath);
  await page.getByRole("button", { name: /^Scripts\b/ }).first().click();
  const inspector = page.getByTestId("context-inspector");
  await expect(inspector).toBeVisible();
  await inspector.getByLabel("Context purpose").selectOption("storyboard");
  await expect(inspector.getByTestId("context-snapshot-id")).toBeVisible({ timeout: 15_000 });
  await page.getByLabel("Content", { exact: true }).fill("A locally changed scene must not mutate the frozen Snapshot.");
  await expect(inspector.getByRole("button", { name: "Build Context Snapshot", exact: true })).toBeDisabled();
  await expect(inspector.getByTestId("storyboard-editor")).toBeVisible();
  await expect(inspector.getByTestId("storyboard-context-snapshot-id")).toBeVisible();
  await expect(inspector.getByTestId("storyboard-save")).toBeDisabled();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.getByRole("button", { name: "Open workspace navigation" }).click();
  await page.getByRole("button", { name: /^Scripts\b/ }).first().click();
  await expect(page.getByTestId("context-inspector")).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
