import { test, expect, apiUploadTestImage } from "../fixtures/base";

test.describe("Gallery", () => {
  test("shows empty state when no media", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("No photos yet")).toBeVisible();
    await expect(page.getByText("Upload Photos")).toBeVisible();
  });

  test("upload link navigates to upload page", async ({ page }) => {
    await page.goto("/");
    await page.getByText("Upload Photos").click();
    await expect(page).toHaveURL("/upload");
  });

  test("shows photos after upload via file picker", async ({
    page,
    testImagePath,
  }) => {
    await page.goto("/upload");

    const fileChooserPromise = page.waitForEvent("filechooser");
    await page.getByText("Choose Files").click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(testImagePath);

    // Wait for success — "X file(s) uploaded"
    await expect(page.getByText("uploaded")).toBeVisible({ timeout: 15000 });

    await page.getByText("View Gallery").click();
    await expect(page).toHaveURL("/");

    // Gallery should show at least one image
    await expect(page.locator("img[alt]").first()).toBeVisible({
      timeout: 5000,
    });
  });

  test("delete photo from gallery", async ({ page, testImagePath }) => {
    await apiUploadTestImage(testImagePath);

    await page.goto("/");
    await expect(page.locator("[data-testid='photo-card']").first()).toBeVisible({
      timeout: 10000,
    });

    // Click card to open modal
    await page.locator("[data-testid='photo-card']").first().click();
    await expect(page.getByTestId("media-detail-modal")).toBeVisible();

    // Delete from modal
    const modal = page.getByTestId("media-detail-modal");
    await modal.getByLabel("Delete", { exact: true }).click();
    await expect(page.getByText("Delete media")).toBeVisible();
    await page.getByRole("button", { name: "Delete", exact: true }).last().click();

    // Should show empty state
    await expect(page.getByText("No photos yet")).toBeVisible({
      timeout: 5000,
    });
  });
});
