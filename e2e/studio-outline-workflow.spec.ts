import { expect, test, type Page } from "@playwright/test";

async function createOpenProject(page: Page, title: string) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Stories in progress" })).toBeVisible();
  await page.getByRole("button", { name: "New project" }).first().click();
  await page.getByLabel("Project title").fill(title);
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.getByRole("article").filter({ hasText: title }).getByRole("button", { name: "Open" }).click();
}

test("story outline is a linked timeline and workflow is a connected stage graph", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await createOpenProject(page, "Timeline Harbor");
  await expect(page).toHaveURL(/\/projects\/timeline-harbor(?:\?|$)/);

  await expect(page.locator("[data-comics-style]")).toBeEnabled();
  await page.locator("[data-comics-style]").selectOption("noir-comics");
  await expect(page.locator("[data-comics-style]")).toHaveValue("noir-comics");
  const evidence = process.env.GOAL_SCRATCH;
  if (evidence) {
    await page.screenshot({ path: `${evidence}/style-or-refs.png`, fullPage: true });
  }

  await page.getByRole("navigation", { name: "Workspace sections" }).getByRole("button", { name: "Entities", exact: true }).click();
  await page.getByLabel("Character name").fill("Sue");
  await page.getByRole("button", { name: "New character" }).click();
  await expect(page.getByRole("button", { name: "Sue" })).toBeVisible();
  await expect(page.locator("[data-complete-reference]")).toBeVisible();

  await page.getByRole("navigation", { name: "Workspace sections" }).getByRole("button", { name: "Story", exact: true }).click();
  await page.getByRole("button", { name: "Add scene" }).click();
  await page.getByRole("button", { name: "Add scene" }).click();
  await page.getByRole("button", { name: "Untitled scene", exact: true }).first().click();
  await page.getByRole("button", { name: "Add to scene: Sue" }).click();
  await expect(page.getByRole("button", { name: "Remove from scene" })).toBeVisible();

  await page.getByRole("navigation", { name: "Workspace sections" }).getByRole("button", { name: "Story outline", exact: true }).click();
  await expect(page.locator("[data-outline-map]")).toBeVisible();
  await expect(page.locator("[data-outline-time]")).toHaveCount(2);
  await expect(page.locator("[data-outline-event]")).toHaveCount(3);
  await expect(page.locator("[data-outline-edge][data-edge-kind=contains]").first()).toBeVisible();
  await expect(page.locator("[data-outline-entity]").first()).toBeVisible();
  await expect(page.locator("[data-outline-edge][data-edge-kind=participates]").first()).toBeVisible();
  await expect(page.locator("article[data-outline-scene]")).toHaveCount(0);
  await expect(page.locator("[data-timeline-lane]")).toHaveCount(0);
  await expect(page.locator("[data-timeline-cell]")).toHaveCount(0);
  await expect(page.locator("[data-timeline-chain]")).toHaveCount(0);
  if (evidence) {
    await page.screenshot({ path: `${evidence}/outline.png`, fullPage: true });
  }

  await page.getByRole("navigation", { name: "Workspace sections" }).getByRole("button", { name: "Workflow", exact: true }).click();
  await expect(page.locator("[data-workflow-pipeline]")).toBeVisible();
  await page.locator("[data-pipeline-stage=dialogue]").click();
  await expect(page.locator("[data-dialogue-list]")).toBeVisible();
  await expect(page.locator("[data-pipeline-stage=text]")).toHaveAttribute("data-pipeline-label", "文字生成");
  await expect(page.locator("[data-pipeline-stage=import]")).toHaveAttribute("data-pipeline-label", "导入阶段");
  await expect(page.locator("[data-pipeline-stage=storyboard]")).toHaveAttribute("data-pipeline-label", "分镜阶段");
  await expect(page.locator("[data-pipeline-stage=dialogue]")).toHaveAttribute("data-pipeline-label", "对话处理");
  await expect(page.locator("[data-pipeline-stage=comics]")).toHaveAttribute("data-pipeline-label", "最终生成漫画");
  await expect(page.locator("[data-pipeline-edge='text->import']")).toBeVisible();
  await expect(page.locator("[data-pipeline-edge='import->storyboard']")).toBeVisible();
  await expect(page.locator("[data-pipeline-edge='storyboard->dialogue']")).toBeVisible();
  await expect(page.locator("[data-pipeline-edge='dialogue->comics']")).toBeVisible();
  if (evidence) {
    await page.screenshot({ path: `${evidence}/workflow.png`, fullPage: true });
  }

  expect(pageErrors).toEqual([]);
});

test("Workflow clicks run director, confirm dialogue, and generate a page", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await createOpenProject(page, "Workflow Click Harbor");
  await expect(page).toHaveURL(/\/projects\/workflow-click-harbor(?:\?|$)/);

  await page.getByRole("navigation", { name: "Workspace sections" }).getByRole("button", { name: "Story", exact: true }).click();
  await expect(page.getByLabel("Script")).toBeVisible();
  const save = page.waitForResponse((response) => {
    return (
      response.request().method() === "PATCH"
      && /\/api\/studio\/projects\/[^/]+\/volumes\/[^/]+\/chapters\/[^/]+\/scenes\/[^/]+$/.test(
        new URL(response.url()).pathname,
      )
      && response.ok()
    );
  }, { timeout: 15_000 });
  await page.getByLabel("Script").fill('Sue: "The last leaf is still there."\nJohnsy: "I thought it would fall."');
  await save;

  await page.getByRole("navigation", { name: "Workspace sections" }).getByRole("button", { name: "Workflow", exact: true }).click();
  await expect(page.locator("[data-workflow-pipeline]")).toBeVisible();
  await expect(page.locator("[data-pipeline-stage=storyboard]")).toHaveAttribute("data-pipeline-status", "pending");
  await expect(page.locator("[data-pipeline-stage=dialogue]")).toHaveAttribute("data-pipeline-status", "pending");
  await expect(page.locator("[data-pipeline-stage=comics]")).toHaveAttribute("data-pipeline-status", "pending");

  await page.locator("[data-pipeline-stage=storyboard]").click();
  const directed = page.waitForResponse((response) => {
    return (
      response.request().method() === "POST"
      && /\/director$/.test(new URL(response.url()).pathname)
      && response.ok()
    );
  }, { timeout: 30_000 });
  await page.locator("[data-workflow-action=storyboard]").click();
  await directed;
  await expect(page.locator("[data-pipeline-stage=storyboard]")).toHaveAttribute("data-pipeline-status", "success");
  await expect(page.locator("[data-pipeline-stage=dialogue]")).toHaveAttribute("data-pipeline-status", "pending");

  await page.locator("[data-pipeline-stage=dialogue]").click();
  const confirmed = page.waitForResponse((response) => {
    return (
      response.request().method() === "POST"
      && /\/dialogue\/confirm$/.test(new URL(response.url()).pathname)
      && response.ok()
    );
  }, { timeout: 15_000 });
  await page.locator("[data-workflow-action=dialogue]").click();
  await confirmed;
  await expect(page.locator("[data-pipeline-stage=dialogue]")).toHaveAttribute("data-pipeline-status", "success");

  await page.locator("[data-pipeline-stage=comics]").click();
  const generated = page.waitForResponse((response) => {
    return (
      response.request().method() === "POST"
      && /\/shots\/[^/]+\/generate$/.test(new URL(response.url()).pathname)
      && response.ok()
    );
  }, { timeout: 30_000 });
  await page.locator("[data-workflow-action=comics]").click();
  await generated;
  await expect(page.locator("[data-pipeline-stage=comics]")).toHaveAttribute("data-pipeline-status", "success");

  const pageImage = page.getByRole("img", { name: "Generated comic page" }).first();
  await expect(pageImage).toBeVisible();
  await expect.poll(async () => pageImage.evaluate((element) => {
    const image = element as HTMLImageElement;
    return image.naturalWidth;
  })).toBeGreaterThan(0);

  const evidence = process.env.GOAL_SCRATCH;
  if (evidence) {
    await page.screenshot({ path: `${evidence}/workflow-click-generate.png`, fullPage: true });
  }

  expect(pageErrors).toEqual([]);
});
