import { test, expect, apiUploadTestImage } from "../fixtures/base";

test.describe("Slideshow", () => {
  test("shows empty state when no media", async ({ page }) => {
    await page.goto("/slideshow");
    await expect(page.getByText("No photos to display")).toBeVisible();
    await expect(
      page.getByText("Upload photos to start slideshow"),
    ).toBeVisible();
  });

  test("displays photo with blur background", async ({
    page,
    testImagePath,
  }) => {
    await apiUploadTestImage(testImagePath);

    await page.goto("/slideshow");

    // Should display the image (both bg and fg)
    const images = page.locator("img");
    await expect(images.first()).toBeVisible({ timeout: 10000 });

    // Should have at least 2 img elements (blur bg + foreground)
    const count = await images.count();
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test("keyboard space toggles pause", async ({
    page,
    testImagePath,
  }) => {
    await apiUploadTestImage(testImagePath);

    await page.goto("/slideshow");
    await expect(page.locator("img").first()).toBeVisible({ timeout: 10000 });

    // Press space to pause
    await page.keyboard.press("Space");
    await expect(page.getByText("Paused")).toBeVisible();

    // Press space again to resume
    await page.keyboard.press("Space");
    await expect(page.getByText("Paused")).not.toBeVisible();
  });

  test("clicking toggles overlay", async ({
    page,
    testImagePath,
  }) => {
    await apiUploadTestImage(testImagePath);

    await page.goto("/slideshow");
    await expect(page.locator("img").first()).toBeVisible({ timeout: 10000 });

    // Click to show overlay
    await page.locator(".fixed.inset-0.bg-black").click({
      position: { x: 100, y: 100 },
    });

    // Overlay should appear
    await expect(page.getByText("Manage Photos")).toBeVisible({ timeout: 3000 });
    await expect(page.getByText("Transition")).toBeVisible();
  });
});
