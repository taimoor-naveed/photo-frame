import {
  test,
  expect,
  apiUploadTestImage,
  apiUploadTestVideo,
  apiGetMedia,
} from "../fixtures/base";

test.describe("Media Detail Modal", () => {
  test("click photo opens modal with correct filename and dimensions", async ({
    page,
    testImagePath,
  }) => {
    await apiUploadTestImage(testImagePath);
    const { items } = await apiGetMedia();
    const uploaded = items[0];

    await page.goto("/");
    await expect(
      page.locator(`[data-media-id="${uploaded.id}"]`).first(),
    ).toBeVisible({ timeout: 10000 });

    // Click the photo card
    await page
      .locator(`[data-media-id="${uploaded.id}"]`)
      .first()
      .click();

    // Modal should appear
    const modal = page.getByTestId("media-detail-modal");
    await expect(modal).toBeVisible();

    // Filename should be visible in header
    await expect(modal.getByText(uploaded.original_name)).toBeVisible();

    // Dimensions should be visible in metadata bar
    const mediaDetail = await fetch(
      `${process.env.BACKEND_URL || "http://backend:8000"}/api/media/${uploaded.id}`,
    ).then((r) => r.json());
    await expect(
      modal.getByText(`${mediaDetail.width} × ${mediaDetail.height}`),
    ).toBeVisible();
  });

  test("delete from modal removes photo", async ({ page, testImagePath }) => {
    await apiUploadTestImage(testImagePath);

    await page.goto("/");
    await expect(page.locator("[data-testid='photo-card']").first()).toBeVisible({
      timeout: 10000,
    });

    // Open modal
    await page.locator("[data-testid='photo-card']").first().click();
    await expect(page.getByTestId("media-detail-modal")).toBeVisible();

    // Click trash (within the modal) → confirm
    const modal = page.getByTestId("media-detail-modal");
    await modal.getByLabel("Delete", { exact: true }).click();
    await expect(page.getByText("Delete media")).toBeVisible();
    // The red confirm button in the ConfirmDialog (second "Delete" button on page)
    await page.getByRole("button", { name: "Delete", exact: true }).last().click();

    // Modal should close
    await expect(page.getByTestId("media-detail-modal")).not.toBeVisible({
      timeout: 5000,
    });

    // Gallery should show empty state
    await expect(page.getByText("No photos yet")).toBeVisible({
      timeout: 5000,
    });
  });

  test("close via X button", async ({ page, testImagePath }) => {
    await apiUploadTestImage(testImagePath);

    await page.goto("/");
    await expect(page.locator("[data-testid='photo-card']").first()).toBeVisible({
      timeout: 10000,
    });

    // Open modal
    await page.locator("[data-testid='photo-card']").first().click();
    await expect(page.getByTestId("media-detail-modal")).toBeVisible();

    // Close via X
    await page.getByLabel("Close").click();
    await expect(page.getByTestId("media-detail-modal")).not.toBeVisible();

    // Photo still in gallery
    await expect(page.locator("[data-testid='photo-card']").first()).toBeVisible();
  });

  test("close via Escape key", async ({ page, testImagePath }) => {
    await apiUploadTestImage(testImagePath);

    await page.goto("/");
    await expect(page.locator("[data-testid='photo-card']").first()).toBeVisible({
      timeout: 10000,
    });

    // Open modal
    await page.locator("[data-testid='photo-card']").first().click();
    await expect(page.getByTestId("media-detail-modal")).toBeVisible();

    // Press Escape
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("media-detail-modal")).not.toBeVisible();
  });

  test("video plays in modal", async ({ page, testVideoPath }) => {
    await apiUploadTestVideo(testVideoPath);

    await page.goto("/");
    await expect(page.locator("[data-testid='photo-card']").first()).toBeVisible({
      timeout: 10000,
    });

    // Open modal
    await page.locator("[data-testid='photo-card']").first().click();
    await expect(page.getByTestId("media-detail-modal")).toBeVisible();

    // Video element should be present with autoplay
    const video = page.locator("[data-testid='media-detail-modal'] video");
    await expect(video).toBeVisible({ timeout: 5000 });
    await expect(video).toHaveAttribute("autoplay", "");
  });
});
