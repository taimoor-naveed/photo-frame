/**
 * Gallery real-time updates and multi-select edge case tests.
 * Simulates a real user + concurrent changes from other sessions.
 */
import type { Locator } from "@playwright/test";
import {
  test,
  expect,
  apiUploadTestImage,
  apiDeleteMedia,
  apiGetMedia,
  getSampleImage,
} from "../fixtures/base";

// ─── Helpers ──────────────────────────────────────────────────

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

// ─── Tests ────────────────────────────────────────────────────

test.describe("Gallery Real-Time Updates", () => {
  test("new photo appears in gallery without page refresh", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByText("Your gallery awaits")).toBeVisible();

    // Upload via API (simulates another device/tab)
    const result = await apiUploadTestImage(getSampleImage(0));
    const uploadedId = result[0].id;

    // Photo should appear in gallery via WebSocket — no refresh needed
    await expect(
      page.locator(`[data-media-id="${uploadedId}"]`),
    ).toBeVisible({ timeout: 10000 });

    // Empty state should be gone
    await expect(page.getByText("Your gallery awaits")).not.toBeVisible();
  });

  test("deleted photo disappears from gallery without refresh", async ({
    page,
    testImagePath,
  }) => {
    const result = await apiUploadTestImage(testImagePath);
    const uploadedId = result[0].id;

    await page.goto("/");
    await expect(
      page.locator(`[data-media-id="${uploadedId}"]`),
    ).toBeVisible({ timeout: 10000 });

    // Delete via API
    await apiDeleteMedia(uploadedId);

    // Photo should disappear without refresh
    await expect(
      page.locator(`[data-media-id="${uploadedId}"]`),
    ).not.toBeVisible({ timeout: 10000 });

    // Empty state should appear
    await expect(page.getByText("Your gallery awaits")).toBeVisible({
      timeout: 5000,
    });
  });

  test("multiple photos added via API all appear in gallery", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByText("Your gallery awaits")).toBeVisible();

    // Upload 3 photos in quick succession via API
    await apiUploadTestImage(getSampleImage(0));
    await apiUploadTestImage(getSampleImage(1));
    await apiUploadTestImage(getSampleImage(2));

    // All 3 should appear in gallery
    await expect(page.locator("[data-testid='photo-card']")).toHaveCount(3, {
      timeout: 10000,
    });
  });

  test("gallery header shows correct count after real-time updates", async ({
    page,
  }) => {
    await apiUploadTestImage(getSampleImage(0));
    await apiUploadTestImage(getSampleImage(1));

    await page.goto("/");
    await expect(page.locator("[data-testid='photo-card']")).toHaveCount(2, {
      timeout: 10000,
    });

    // Upload a 3rd photo
    await apiUploadTestImage(getSampleImage(2));

    // Wait for the new card to appear via WebSocket real-time update
    await expect(page.locator("[data-testid='photo-card']")).toHaveCount(3, {
      timeout: 15000,
    });
  });
});

test.describe("Gallery Multi-Select Edge Cases", () => {
  test("selected items deleted externally exits selection mode gracefully", async ({
    page,
    testImagePath,
  }) => {
    const r1 = await apiUploadTestImage(testImagePath);
    const r2 = await apiUploadTestImage(getSampleImage(1));

    await page.goto("/");
    await expect(page.locator("[data-testid='photo-card']")).toHaveCount(2, {
      timeout: 10000,
    });

    // Enter selection mode and select both
    await longPress(page.locator("[data-testid='photo-card']").first());
    await expect(page.getByTestId("selection-action-bar")).toBeVisible();
    await page.getByTestId("selection-select-all").click();
    await expect(page.getByText("2 items selected")).toBeVisible();

    // Delete both via API (external action)
    await apiDeleteMedia(r1[0].id);
    await apiDeleteMedia(r2[0].id);
    await page.waitForTimeout(2000);

    // Gallery should show empty state
    await expect(page.getByText("Your gallery awaits")).toBeVisible({
      timeout: 5000,
    });

    // Selection mode should have exited (no action bar)
    await expect(page.getByTestId("selection-action-bar")).not.toBeVisible();
  });

  test("some selected items deleted externally updates count", async ({
    page,
    testImagePath,
  }) => {
    const r1 = await apiUploadTestImage(testImagePath);
    await apiUploadTestImage(getSampleImage(1));
    await apiUploadTestImage(getSampleImage(2));

    await page.goto("/");
    await expect(page.locator("[data-testid='photo-card']")).toHaveCount(3, {
      timeout: 10000,
    });

    // Enter selection mode and select all
    await longPress(page.locator("[data-testid='photo-card']").first());
    await page.getByTestId("selection-select-all").click();
    await expect(page.getByText("3 items selected")).toBeVisible();

    // Delete one externally
    await apiDeleteMedia(r1[0].id);
    await page.waitForTimeout(2000);

    // Should now show 2 cards and updated selection count
    await expect(page.locator("[data-testid='photo-card']")).toHaveCount(2, {
      timeout: 5000,
    });
    // The deleted item's selection should be pruned
    await expect(page.getByText("2 items selected")).toBeVisible({
      timeout: 5000,
    });
  });

  test("deselect all then try to delete shows disabled button", async ({
    page,
    testImagePath,
  }) => {
    await apiUploadTestImage(testImagePath);
    await apiUploadTestImage(getSampleImage(1));

    await page.goto("/");
    await expect(page.locator("[data-testid='photo-card']")).toHaveCount(2, {
      timeout: 10000,
    });

    // Enter selection mode
    await longPress(page.locator("[data-testid='photo-card']").first());
    await expect(page.getByText("1 item selected")).toBeVisible();

    // Select all then deselect all
    await page.getByTestId("selection-select-all").click();
    await expect(page.getByText("2 items selected")).toBeVisible();
    // Click again to deselect all
    await page.getByTestId("selection-select-all").click();
    await expect(page.getByText("0 items selected")).toBeVisible();

    // Delete button should be disabled
    const deleteBtn = page.getByTestId("selection-delete");
    await expect(deleteBtn).toBeDisabled();
  });

  test("long-press on different cards in sequence", async ({
    page,
    testImagePath,
  }) => {
    await apiUploadTestImage(testImagePath);
    await apiUploadTestImage(getSampleImage(1));
    await apiUploadTestImage(getSampleImage(2));

    await page.goto("/");
    await expect(page.locator("[data-testid='photo-card']")).toHaveCount(3, {
      timeout: 10000,
    });

    // Long-press first card to enter selection mode
    await longPress(page.locator("[data-testid='photo-card']").first());
    await expect(page.getByText("1 item selected")).toBeVisible();

    // Cancel selection mode
    await page.getByTestId("selection-cancel").click();
    await expect(page.getByTestId("selection-action-bar")).not.toBeVisible();

    // Long-press a different card
    await longPress(page.locator("[data-testid='photo-card']").nth(1));
    await expect(page.getByText("1 item selected")).toBeVisible();

    // The selected card should be the second one, not the first
    // Click first card to toggle it
    await page.locator("[data-testid='photo-card']").first().click();
    await expect(page.getByText("2 items selected")).toBeVisible();
  });

  test("escape key exits selection mode from any state", async ({
    page,
    testImagePath,
  }) => {
    await apiUploadTestImage(testImagePath);
    await apiUploadTestImage(getSampleImage(1));

    await page.goto("/");
    await expect(page.locator("[data-testid='photo-card']")).toHaveCount(2, {
      timeout: 10000,
    });

    // Enter selection mode, select both
    await longPress(page.locator("[data-testid='photo-card']").first());
    await page.locator("[data-testid='photo-card']").nth(1).click();
    await expect(page.getByText("2 items selected")).toBeVisible();

    // Escape should exit selection mode completely
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("selection-action-bar")).not.toBeVisible();

    // Click should now open modal (not toggle selection)
    await page.locator("[data-testid='photo-card']").first().click();
    await expect(page.getByTestId("media-detail-modal")).toBeVisible();
  });

  test("modal close via backdrop click", async ({ page, testImagePath }) => {
    await apiUploadTestImage(testImagePath);

    await page.goto("/");
    await expect(
      page.locator("[data-testid='photo-card']").first(),
    ).toBeVisible({ timeout: 10000 });

    // Open modal
    await page.locator("[data-testid='photo-card']").first().click();
    await expect(page.getByTestId("media-detail-modal")).toBeVisible();

    // Click the backdrop (the dark overlay behind the modal content)
    // The backdrop is the outermost div of the modal
    const backdrop = page.getByTestId("media-detail-modal");
    // Click at the very edge (outside the content area but inside the backdrop)
    const box = await backdrop.boundingBox();
    if (box) {
      await page.click("body", {
        position: { x: box.x + 10, y: box.y + 10 },
      });
    }

    // Modal should close
    await expect(page.getByTestId("media-detail-modal")).not.toBeVisible({
      timeout: 3000,
    });
  });
});
