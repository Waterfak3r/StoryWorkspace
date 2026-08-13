import { expect, test, type Page } from "@playwright/test";

test.describe.configure({ mode: "serial" });

let projectPath = "";

async function createGenerationProject(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Stories in progress" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Loading projects" })).toBeHidden();
  await page.getByRole("button", { name: /New project|Create your first project/ }).first().click();
  await page.getByLabel("Project title").fill("Phase Five C Generation");
  await page.getByLabel("Premise").fill("An immutable fake generation follows an approved compiled Shot.");
  await page.getByLabel("Genre").fill("Mystery");
  await page.getByRole("button", { name: "Create project", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Phase Five C Generation" })).toBeVisible();
  const projectCard = page.getByRole("article").filter({ has: page.getByRole("heading", { name: "Phase Five C Generation" }) });
  await projectCard.getByRole("button", { name: "Open", exact: true }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+$/);
  projectPath = new URL(page.url()).pathname;

  await page.getByRole("button", { name: /^Scripts\b/ }).first().click();
  await page.getByRole("button", { name: "New script document" }).click();
  await page.getByRole("button", { name: "Add scene", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("The generation test");
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
  await inspector.getByRole("button", { name: "Build Context Snapshot", exact: true }).click();
  await expect(inspector.getByTestId("context-snapshot-id")).toBeVisible({ timeout: 15_000 });
  const editor = inspector.getByTestId("storyboard-editor");
  await editor.getByTestId("storyboard-title").fill("Generation board");
  await editor.getByLabel("Narrative purpose").fill("Establish the immutable generation input.");
  await editor.getByLabel("Action").fill("watches the door");
  await editor.getByTestId("storyboard-save").click();
  await expect(editor.getByText("draft", { exact: true })).toBeVisible();
  await editor.getByTestId("storyboard-approve").click();
  await expect(editor.getByText("approved", { exact: true })).toBeVisible();
}

async function compileTextOnly(page: Page) {
  const preview = page.getByTestId("compilation-preview-0");
  await expect(preview).toBeVisible({ timeout: 15_000 });
  const references = preview.locator('[data-testid="reference-asset-list"] input[type="checkbox"]');
  for (let index = 0; index < await references.count(); index += 1) {
    if (await references.nth(index).isChecked()) await references.nth(index).uncheck();
  }
  await preview.getByLabel("Duration seconds").fill("5.5");
  await preview.getByLabel("Aspect ratio").fill("cinematic");
  const compileRequestPromise = page.waitForRequest((request) => /\/shots\/[^/]+\/compile$/.test(request.url()) && request.method() === "POST");
  await preview.getByTestId("compile-preview").click();
  const compileRequest = await compileRequestPromise;
  expect(compileRequest.postDataJSON()).toMatchObject({ referenceAssetIds: [], parameters: { durationSeconds: 5.5, aspectRatio: "cinematic" } });
  await expect(preview.getByTestId("compile-result")).toBeVisible({ timeout: 15_000 });
  await expect(preview.getByTestId("compiled-hash")).toContainText(/compiledHash [a-f0-9]{64}/i);
  await expect(preview.getByTestId("preview-request-hash")).toContainText(/requestHash [a-f0-9]{64}/i);
  return preview;
}

test("submits an approved compiled Shot and shows the immutable Manifest and fake result", async ({ page }) => {
  await createGenerationProject(page);
  const preview = await compileTextOnly(page);
  const submitRequestPromise = page.waitForRequest((request) => /\/generations$/.test(request.url()) && request.method() === "POST");
  await preview.getByTestId("generation-submit").click();
  const submitRequest = await submitRequestPromise;
  expect(submitRequest.postDataJSON()).toMatchObject({ compiledRequestId: expect.any(String), requestId: expect.any(String), actorId: "local-user", fakeBehavior: "success" });
  await expect(preview.getByTestId("generation-manifest")).toBeVisible({ timeout: 15_000 });
  await expect(preview.getByTestId("generation-job")).toContainText("succeeded");
  await expect(preview.getByTestId("generation-result")).toBeVisible({ timeout: 15_000 });
  await expect(preview.getByTestId("generation-result")).toContainText("fake://video/results/");
  await expect(preview.getByTestId("generation-submit")).toHaveCount(0);
  await expect(preview.getByTestId("generation-retry")).toHaveCount(0);
});

test("normalizes a timeout and retries without changing provider submission identity", async ({ page }) => {
  test.skip(!projectPath, "The normal generation flow did not create a project");
  await page.goto(projectPath);
  await page.getByRole("button", { name: /^Scripts\b/ }).first().click();
  const inspector = page.getByTestId("context-inspector");
  await inspector.getByLabel("Context purpose").selectOption("storyboard");
  await expect(inspector.getByTestId("context-snapshot-id")).toBeVisible({ timeout: 15_000 });
  const preview = await compileTextOnly(page);
  await preview.getByTestId("generation-fake-behavior").selectOption("timeout_after_accept_once");
  const submitRequestPromise = page.waitForRequest((request) => /\/generations$/.test(request.url()) && request.method() === "POST");
  await preview.getByTestId("generation-submit").click();
  const submitRequest = await submitRequestPromise;
  expect(submitRequest.postDataJSON()).toMatchObject({ fakeBehavior: "timeout_after_accept_once" });
  await expect(preview.getByTestId("generation-normalized-error")).toContainText("timeout");
  const providerJobId = await preview.getByTestId("generation-provider-job-id").textContent();
  expect(providerJobId).toBeTruthy();
  const retryRequestPromise = page.waitForRequest((request) => /\/generation-jobs\/[^/]+\/retry$/.test(request.url()) && request.method() === "POST");
  await preview.getByTestId("generation-retry").click();
  const retryRequest = await retryRequestPromise;
  expect(retryRequest.postDataJSON()).toMatchObject({ expectedVersion: expect.any(Number), requestId: expect.any(String), actorId: "local-user" });
  await expect(preview.getByTestId("generation-result")).toBeVisible({ timeout: 15_000 });
  await expect(preview.getByTestId("generation-provider-job-id")).toHaveText(providerJobId ?? "");
  await expect(preview.getByTestId("generation-result")).toContainText("fake://video/results/");
  await expect(preview.getByTestId("generation-retry")).toHaveCount(0);
});

test("preserves a non-retryable failure and starts a new Manifest after correction", async ({ page }) => {
  test.skip(!projectPath, "The normal generation flow did not create a project");
  await page.goto(projectPath);
  await page.getByRole("button", { name: /^Scripts\b/ }).first().click();
  const inspector = page.getByTestId("context-inspector");
  await inspector.getByLabel("Context purpose").selectOption("storyboard");
  await expect(inspector.getByTestId("context-snapshot-id")).toBeVisible({ timeout: 15_000 });
  const preview = await compileTextOnly(page);
  await preview.getByTestId("generation-fake-behavior").selectOption("invalid_input");
  const failedRequestPromise = page.waitForRequest((request) => /\/generations$/.test(request.url()) && request.method() === "POST");
  await preview.getByTestId("generation-submit").click();
  const failedRequest = await failedRequestPromise;
  expect(failedRequest.postDataJSON()).toMatchObject({ fakeBehavior: "invalid_input" });
  const failedRequestId = failedRequest.postDataJSON().requestId as string;
  await expect(preview.getByTestId("generation-normalized-error")).toContainText("invalid_input");
  await expect(preview.getByTestId("generation-retry")).toHaveCount(0);
  await expect(preview.getByTestId("generation-submit")).toHaveText("Start new Fake generation");

  await preview.getByTestId("generation-fake-behavior").selectOption("success");
  const correctedRequestPromise = page.waitForRequest((request) => /\/generations$/.test(request.url()) && request.method() === "POST");
  await preview.getByTestId("generation-submit").click();
  const correctedRequest = await correctedRequestPromise;
  expect(correctedRequest.postDataJSON()).toMatchObject({ fakeBehavior: "success" });
  expect(correctedRequest.postDataJSON().requestId).not.toBe(failedRequestId);
  await expect(preview.getByTestId("generation-job")).toContainText("succeeded");
  await expect(preview.getByTestId("generation-result")).toContainText("fake://video/results/");
  await expect(preview.getByTestId("generation-submit")).toHaveCount(0);
});
