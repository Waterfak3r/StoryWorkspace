import { expect, test } from "@playwright/test";

test("story outline is a timeline and workflow is a connected stage graph", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Stories in progress" })).toBeVisible();
  await page.getByRole("button", { name: "New project" }).first().click();
  await page.getByLabel("Project title").fill("Timeline Harbor");
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.getByRole("article").filter({ hasText: "Timeline Harbor" }).getByRole("button", { name: "Open" }).click();
  await expect(page).toHaveURL(/\/projects\/timeline-harbor(?:\?|$)/);

  await page.getByRole("navigation", { name: "Workspace sections" }).getByRole("button", { name: "Story outline" }).click();
  await expect(page.locator("[data-outline-timeline]")).toBeVisible();
  await expect(page.locator("[data-timeline-event]")).toHaveCount(1);
  await expect(page.locator("article[data-outline-scene]")).toHaveCount(0);
  const evidence = process.env.GOAL_SCRATCH;
  if (evidence) {
    await page.screenshot({ path: `${evidence}/outline.png`, fullPage: true });
  }

  await page.getByRole("navigation", { name: "Workspace sections" }).getByRole("button", { name: "Workflow" }).click();
  await expect(page.locator("[data-workflow-pipeline]")).toBeVisible();
  await expect(page.locator("[data-pipeline-stage=text]")).toHaveAttribute("data-pipeline-label", "文字生成");
  await expect(page.locator("[data-pipeline-stage=import]")).toHaveAttribute("data-pipeline-label", "导入阶段");
  await expect(page.locator("[data-pipeline-stage=storyboard]")).toHaveAttribute("data-pipeline-label", "分镜阶段");
  await expect(page.locator("[data-pipeline-stage=comics]")).toHaveAttribute("data-pipeline-label", "最终生成漫画");
  await expect(page.locator("[data-pipeline-edge='text->import']")).toBeVisible();
  await expect(page.locator("[data-pipeline-edge='import->storyboard']")).toBeVisible();
  await expect(page.locator("[data-pipeline-edge='storyboard->dialogue']")).toBeVisible();
  await expect(page.locator("[data-pipeline-edge='dialogue->comics']")).toBeVisible();
  if (evidence) {
    await page.screenshot({ path: `${evidence}/workflow.png`, fullPage: true });
  }
});
