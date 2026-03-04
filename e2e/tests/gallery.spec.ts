import type { Locator } from "@playwright/test";
import { test, expect, apiUploadTestImage, getSampleImage } from "../fixtures/base";

test.describe("Gallery", () => {
  test("shows empty state when no media", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Your gallery awaits")).toBeVisible();
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
    await expect(page.getByText("Your gallery awaits")).toBeVisible({
      timeout: 5000,
    });
  });
});

// ─── Multi-Select / Bulk Delete ─────────────────────────────

test.describe("Multi-Select", () => {
  /** Long-press a card by holding pointer for 600ms */
  async function longPress(locator: Locator) {
    const box = await locator.boundingBox();
    if (!box) throw new Error("Card not visible");
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await locator.page().mouse.move(cx, cy);
    await locator.page().mouse.down();
    await locator.page().waitForTimeout(600);
    await locator.page().mouse.up();
  }

  test("long-press enters selection mode with action bar", async ({
    page,
    testImagePath,
  }) => {
    await apiUploadTestImage(testImagePath);
    await apiUploadTestImage(getSampleImage(1));

    await page.goto("/");
    await expect(page.locator("[data-testid='photo-card']")).toHaveCount(2, { timeout: 10000 });

    // Long-press first card
    await longPress(page.locator("[data-testid='photo-card']").first());

    await expect(page.getByTestId("selection-action-bar")).toBeVisible();
    await expect(page.getByText("1 item selected")).toBeVisible();
  });

  test("tap to toggle selection in selection mode", async ({
    page,
    testImagePath,
  }) => {
    await apiUploadTestImage(testImagePath);
    await apiUploadTestImage(getSampleImage(1));

    await page.goto("/");
    await expect(page.locator("[data-testid='photo-card']")).toHaveCount(2, { timeout: 10000 });

    // Enter selection mode
    await longPress(page.locator("[data-testid='photo-card']").first());
    await expect(page.getByText("1 item selected")).toBeVisible();

    // Tap second card to select it
    await page.locator("[data-testid='photo-card']").nth(1).click();
    await expect(page.getByText("2 items selected")).toBeVisible();

    // Tap first card to deselect
    await page.locator("[data-testid='photo-card']").first().click();
    await expect(page.getByText("1 item selected")).toBeVisible();
  });

  test("select all and bulk delete", async ({ page, testImagePath }) => {
    await apiUploadTestImage(testImagePath);
    await apiUploadTestImage(getSampleImage(1));
    await apiUploadTestImage(getSampleImage(2));

    await page.goto("/");
    await expect(page.locator("[data-testid='photo-card']")).toHaveCount(3, { timeout: 10000 });

    // Enter selection mode
    await longPress(page.locator("[data-testid='photo-card']").first());

    // Select all
    await page.getByTestId("selection-select-all").click();
    await expect(page.getByText("3 items selected")).toBeVisible();

    // Delete + confirm
    await page.getByTestId("selection-delete").click();
    await expect(page.getByText("Delete 3 items?")).toBeVisible();
    await page.getByRole("button", { name: "Delete", exact: true }).last().click();

    // Should show empty state
    await expect(page.getByText("Your gallery awaits")).toBeVisible({ timeout: 10000 });
  });

  test("bulk delete partial — some items remain", async ({
    page,
    testImagePath,
  }) => {
    const [uploaded1] = await apiUploadTestImage(testImagePath);
    await apiUploadTestImage(getSampleImage(1));
    const [uploaded3] = await apiUploadTestImage(getSampleImage(2));

    await page.goto("/");
    await expect(page.locator("[data-testid='photo-card']")).toHaveCount(3, { timeout: 10000 });

    // Enter selection mode on first card
    await longPress(page.locator("[data-testid='photo-card']").first());

    // Select second card too
    await page.locator("[data-testid='photo-card']").nth(1).click();
    await expect(page.getByText("2 items selected")).toBeVisible();

    // Delete + confirm
    await page.getByTestId("selection-delete").click();
    await page.getByRole("button", { name: "Delete", exact: true }).last().click();

    // 1 card should remain
    await expect(page.locator("[data-testid='photo-card']")).toHaveCount(1, { timeout: 10000 });
  });

  test("cancel selection restores normal click behavior", async ({
    page,
    testImagePath,
  }) => {
    await apiUploadTestImage(testImagePath);

    await page.goto("/");
    await expect(page.locator("[data-testid='photo-card']")).toHaveCount(1, { timeout: 10000 });

    // Enter selection mode
    await longPress(page.locator("[data-testid='photo-card']").first());
    await expect(page.getByTestId("selection-action-bar")).toBeVisible();

    // Cancel
    await page.getByTestId("selection-cancel").click();
    await expect(page.getByTestId("selection-action-bar")).not.toBeVisible();

    // Normal click should open modal
    await page.locator("[data-testid='photo-card']").first().click();
    await expect(page.getByTestId("media-detail-modal")).toBeVisible();
  });

  test("escape exits selection mode", async ({ page, testImagePath }) => {
    await apiUploadTestImage(testImagePath);

    await page.goto("/");
    await expect(page.locator("[data-testid='photo-card']")).toHaveCount(1, { timeout: 10000 });

    // Enter selection mode
    await longPress(page.locator("[data-testid='photo-card']").first());
    await expect(page.getByTestId("selection-action-bar")).toBeVisible();

    // Press Escape
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("selection-action-bar")).not.toBeVisible();

    // Click card opens modal
    await page.locator("[data-testid='photo-card']").first().click();
    await expect(page.getByTestId("media-detail-modal")).toBeVisible();
  });
});
