import { test, expect, apiGetSettings } from "../fixtures/base";

test.describe("Settings", () => {
  test("renders settings controls without photo order", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByText("Slideshow Interval")).toBeVisible();
    await expect(page.getByText("Transition")).toBeVisible();
    // Photo Order section should not exist
    await expect(page.getByText("Photo Order")).not.toBeVisible();
  });

  test("change transition type", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByText("Transition")).toBeVisible();

    await page.getByRole("button", { name: "slide" }).click();
    await page.waitForTimeout(500);

    const settings = await apiGetSettings();
    expect(settings.transition_type).toBe("slide");
  });

  test("settings persist across page reload", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByText("Transition")).toBeVisible();

    await page.getByRole("button", { name: "none" }).click();
    await page.waitForTimeout(500);

    await page.reload();
    await expect(page.getByText("Transition")).toBeVisible();

    const noneBtn = page.getByRole("button", { name: "none" });
    await expect(noneBtn).toHaveClass(/bg-gray-900/);
  });

  test("settings page has no photo order section", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByText("Slideshow Interval")).toBeVisible();
    // No "Photo Order" label
    const photoOrderLabel = page.getByText("Photo Order");
    await expect(photoOrderLabel).toHaveCount(0);
    // No order buttons
    await expect(page.getByRole("button", { name: "random" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "sequential" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "newest" })).toHaveCount(0);
  });
});
