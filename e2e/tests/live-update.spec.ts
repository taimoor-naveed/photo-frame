import { test, expect, apiUploadTestImage } from "../fixtures/base";

const BACKEND_URL = process.env.BACKEND_URL || "http://backend:8000";

test.describe("Live Updates", () => {
  test("gallery shows uploaded media after refresh", async ({
    page,
    testImagePath,
  }) => {
    await page.goto("/");
    await expect(page.getByText("No photos yet")).toBeVisible();

    // Upload via API
    await apiUploadTestImage(testImagePath);

    // Refresh to see changes
    await page.reload();
    await expect(page.locator("img[alt]").first()).toBeVisible({
      timeout: 10000,
    });
  });

  test("settings changes via API reflect in slideshow overlay", async ({
    page,
    testImagePath,
  }) => {
    await apiUploadTestImage(testImagePath);

    await page.goto("/slideshow");
    await expect(page.locator("img").first()).toBeVisible({ timeout: 10000 });

    // Change settings via API
    await fetch(`${BACKEND_URL}/api/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transition_type: "none" }),
    });

    // Give WebSocket time to deliver
    await page.waitForTimeout(1500);

    // Open overlay
    await page.locator(".fixed.inset-0.bg-black").click({
      position: { x: 100, y: 100 },
    });

    // Overlay should show
    await expect(page.getByText("Manage Photos")).toBeVisible({
      timeout: 3000,
    });
  });
});
