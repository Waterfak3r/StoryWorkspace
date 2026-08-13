import { expect, test, type Page } from "@playwright/test";

test.describe.configure({ mode: "serial" });

let projectPath = "";

async function createCompilationProject(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Stories in progress" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Loading projects" })).toBeHidden();
  await page.getByRole("button", { name: /New project|Create your first project/ }).first().click();
  await page.getByLabel("Project title").fill("Phase Five B Compilation");
  await page.getByLabel("Premise").fill("An approved Storyboard compiles into a deterministic fake video request preview.");
  await page.getByLabel("Genre").fill("Mystery");
  await page.getByRole("button", { name: "Create project", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Phase Five B Compilation" })).toBeVisible();
  const projectCard = page.getByRole("article").filter({ has: page.getByRole("heading", { name: "Phase Five B Compilation" }) });
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
  await inspector.getByRole("button", { name: "Build Context Snapshot", exact: true }).click();
  await expect(inspector.getByTestId("context-snapshot-id")).toBeVisible({ timeout: 15_000 });
  const editor = inspector.getByTestId("storyboard-editor");
  await editor.getByTestId("storyboard-title").fill("Door watch");
  await editor.getByLabel("Narrative purpose").fill("Establish Lin Mo watching the exit.");
  await editor.getByLabel("Action").fill("watches the door");
  await editor.getByTestId("storyboard-save").click();
  await expect(editor.getByText("draft", { exact: true })).toBeVisible();
  await editor.getByTestId("storyboard-approve").click();
  await expect(editor.getByText("approved", { exact: true })).toBeVisible();
}

test("compiles an approved Shot with approved reference metadata and exposes the fake request", async ({ page }) => {
  await createCompilationProject(page);
  const preview = page.getByTestId("compilation-preview-0");
  await expect(preview.getByTestId("compilation-capability-profile")).toContainText("fake-video");
  await expect(preview).toContainText("Supported durations: 4 / 6 / 8");

  const label = preview.getByLabel("Metadata label");
  const createButton = preview.getByRole("button", { name: "Create approved reference metadata", exact: true });
  for (const metadataLabel of ["Lin Mo front", "Lin Mo watch profile"]) {
    await label.fill(metadataLabel);
    const createRequestPromise = page.waitForRequest((request) => request.url().endsWith("/reference-assets") && request.method() === "POST");
    await createButton.click();
    const createRequest = await createRequestPromise;
    expect(createRequest.postDataJSON()).toMatchObject({ entityId: expect.any(String), label: metadataLabel, requestId: expect.any(String) });
    await expect(preview.getByText(metadataLabel, { exact: true })).toBeVisible({ timeout: 15_000 });
  }

  const references = preview.locator('[data-testid="reference-asset-list"] input[type="checkbox"]');
  await expect(references).toHaveCount(2);
  await references.nth(0).check();
  await references.nth(1).check();
  const compileRequestPromise = page.waitForRequest((request) => /\/shots\/[^/]+\/compile$/.test(request.url()) && request.method() === "POST");
  await preview.getByTestId("compile-preview").click();
  const compileRequest = await compileRequestPromise;
  expect(compileRequest.postDataJSON()).toMatchObject({ referenceAssetIds: [expect.any(String), expect.any(String)], parameters: { durationSeconds: null, aspectRatio: "16:9" } });
  await expect(preview.getByTestId("compile-result")).toBeVisible({ timeout: 15_000 });
  await expect(preview.getByTestId("compiled-hash")).toContainText(/compiledHash [a-f0-9]{64}/i);
  await expect(preview.getByTestId("fake-preview-request")).toContainText("fake://video/generate");
  await expect(preview.getByTestId("preview-request-hash")).toContainText(/requestHash [a-f0-9]{64}/i);
  await expect(preview.getByTestId("preview-body")).toContainText("referenceAssetIds");
});

test("compiles a text-only fallback and surfaces server normalization warnings", async ({ page }) => {
  test.skip(!projectPath, "The reference compilation flow did not create a project");
  await page.goto(projectPath);
  await page.getByRole("button", { name: /^Scripts\b/ }).first().click();
  const inspector = page.getByTestId("context-inspector");
  await inspector.getByLabel("Context purpose").selectOption("storyboard");
  const preview = page.getByTestId("compilation-preview-0");
  await expect(preview).toBeVisible({ timeout: 15_000 });
  const references = preview.locator('[data-testid="reference-asset-list"] input[type="checkbox"]');
  await expect(references).toHaveCount(2);
  await references.nth(0).uncheck();
  await references.nth(1).uncheck();
  await preview.getByLabel("Duration seconds").fill("5.5");
  await preview.getByLabel("Aspect ratio").fill("cinematic");
  const compileRequestPromise = page.waitForRequest((request) => /\/shots\/[^/]+\/compile$/.test(request.url()) && request.method() === "POST");
  await preview.getByTestId("compile-preview").click();
  const compileRequest = await compileRequestPromise;
  expect(compileRequest.postDataJSON()).toMatchObject({ referenceAssetIds: [], parameters: { durationSeconds: 5.5, aspectRatio: "cinematic" } });
  await expect(preview.getByTestId("compile-result")).toBeVisible({ timeout: 15_000 });
  await expect(preview.getByRole("heading", { name: "Selected asset inputs" })).toBeVisible();
  await expect(preview.getByTestId("compile-warnings")).not.toContainText("None recorded.");
  await expect(preview.getByTestId("compiled-normalized-parameters")).toContainText(/4|6|8/);
  await expect(preview.getByTestId("preview-request-hash")).toContainText(/requestHash [a-f0-9]{64}/i);
});
