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
  await expect(page.locator("[data-outline-timeline]")).toBeVisible();
  await expect(page.locator("[data-timeline-chain]")).toBeVisible();
  await expect(page.locator("[data-timeline-event]")).toHaveCount(3);
  await expect(page.locator("[data-timeline-link]")).toHaveCount(2);
  await expect(page.locator("article[data-outline-scene]")).toHaveCount(0);
  await expect(page.locator("[data-timeline-lane]")).toHaveCount(1);
  await expect(page.locator("[data-timeline-cell][data-present=true]")).toHaveCount(1);
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
