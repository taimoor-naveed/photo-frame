import { test, expect, apiGetSettings } from "../fixtures/base";

test.describe("Settings", () => {
  test("renders settings controls", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByText("Slideshow Interval")).toBeVisible();
    await expect(page.getByText("Transition")).toBeVisible();
    await expect(page.getByText("Photo Order")).toBeVisible();
  });

  test("change transition type", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByText("Transition")).toBeVisible();

    await page.getByRole("button", { name: "slide" }).click();
    await page.waitForTimeout(500);

    const settings = await apiGetSettings();
    expect(settings.transition_type).toBe("slide");
  });

  test("change photo order", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByText("Photo Order")).toBeVisible();

    await page.getByRole("button", { name: "sequential" }).click();
    await page.waitForTimeout(500);

    const settings = await apiGetSettings();
    expect(settings.photo_order).toBe("sequential");
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
});
