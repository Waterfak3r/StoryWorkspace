import { expect, test } from "@playwright/test";

test("creates a script revision, analyzes a scene, and reviews an entity candidate", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Stories in progress" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Loading projects" })).toBeHidden();

  await page.getByRole("button", { name: /New project|Create your first project/ }).first().click();
  await page.getByLabel("Project title").fill("Phase One Entities");
  await page.getByLabel("Premise").fill("A stable scene reveals who belongs in the story.");
  await page.getByLabel("Genre").fill("Mystery");
  await page.getByRole("button", { name: "Create project", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Phase One Entities" })).toBeVisible();
  const projectCard = page.getByRole("article").filter({ has: page.getByRole("heading", { name: "Phase One Entities" }) });
  await projectCard.getByRole("button", { name: "Open", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Story bible" })).toBeVisible();

  await page.getByRole("button", { name: /^Scripts\b/ }).first().click();
  await expect(page.getByRole("heading", { name: "Start a script document." })).toBeVisible();
  await page.getByRole("button", { name: "New script document" }).click();
  await expect(page.getByRole("heading", { name: "Untitled script", level: 2 })).toBeVisible();

  await page.getByRole("button", { name: "Add scene", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("Flooded observatory");
  await page.getByLabel("Content", { exact: true }).fill("Lin Mo sees [[character:Traveler]] beneath the beacon.");

  const revisionResponse = page.waitForResponse((response) => response.request().method() === "POST" && /\/documents\/[^/]+\/revisions$/.test(response.url()));
  await page.getByRole("button", { name: "Save revision", exact: true }).click();
  expect((await revisionResponse).ok()).toBe(true);
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await expect(page.getByText("1 active scene · revision 2", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "New entity", exact: true }).click();
  await page.getByLabel("Type", { exact: true }).selectOption("character");
  await page.getByLabel("Canonical name", { exact: true }).fill("Lin Mo");
  const aliasRequest = page.waitForRequest((request) => request.method() === "POST" && /\/aliases$/.test(request.url()));
  await page.getByLabel(/^Alias/).fill("Lin");
  await page.getByRole("button", { name: "Create entity", exact: true }).click();
  expect(JSON.parse((await aliasRequest).postData() ?? "{}").alias).toBe("Lin");
  await expect(page.getByText("Lin Mo", { exact: true }).last()).toBeVisible();

  await page.getByRole("button", { name: "Analyze scene", exact: true }).click();
  await expect(page.getByText("Status: Succeeded", { exact: true })).toBeVisible({ timeout: 20_000 });
  const travelerEvidence = page.getByLabel("Evidence for Traveler");
  await expect(travelerEvidence.getByText("Traveler", { exact: true })).toBeVisible();
  const travelerCandidate = page.getByLabel("Entity candidate links").getByRole("listitem").filter({ has: travelerEvidence });
  const confirmCandidate = travelerCandidate.getByRole("button", { name: /Confirm mention Traveler as Traveler/ });
  await expect(confirmCandidate).toBeVisible();
  await confirmCandidate.click();
  await expect(travelerCandidate.getByText("confirmed", { exact: true })).toBeVisible();
});
