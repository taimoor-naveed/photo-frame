/**
 * Tests for race conditions and rapid user interactions.
 * These simulate a real user doing unexpected things quickly.
 */
import {
  test,
  expect,
  apiUploadTestImage,
  apiGetMedia,
  apiDeleteMedia,
  apiGetSettings,
  getSampleImage,
} from "../fixtures/base";

const BACKEND_URL = process.env.BACKEND_URL || "http://backend:8000";

// ─── Helpers ──────────────────────────────────────────────────

async function setSettings(overrides: Record<string, unknown>) {
  await fetch(`${BACKEND_URL}/api/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(overrides),
  });
}

async function currentSlideSrc(page: import("@playwright/test").Page) {
  return page
    .locator(".absolute.inset-0.z-10 img[alt]:not([aria-hidden])")
    .getAttribute("src");
}

async function currentSlideMediaId(
  page: import("@playwright/test").Page,
): Promise<number | null> {
  const el = page.locator(".absolute.inset-0.z-10 [data-media-id]");
  const count = await el.count();
  if (count === 0) return null;
  const val = await el.first().getAttribute("data-media-id");
  return val ? Number(val) : null;
}

async function tapRight(page: import("@playwright/test").Page) {
  const vp = page.viewportSize()!;
  await page.click("body", {
    position: { x: vp.width * 0.75, y: vp.height / 2 },
  });
  await page.waitForTimeout(700);
}

async function setupSlideshow(
  page: import("@playwright/test").Page,
  count: number,
  opts: { interval?: number; transition?: string } = {},
) {
  for (let i = 0; i < count; i++) {
    await apiUploadTestImage(getSampleImage(i));
  }
  await setSettings({
    slideshow_interval: opts.interval ?? 120,
    transition_type: opts.transition ?? "crossfade",
  });
  await page.goto("/slideshow");
  await expect(page.locator("img").first()).toBeVisible({ timeout: 10000 });
}

// ─── Tests ────────────────────────────────────────────────────

test.describe("Race Conditions", () => {
  test("rapid slideshow navigation faster than transition duration", async ({
    page,
  }) => {
    await setupSlideshow(page, 5, { transition: "crossfade" });

    // Rapidly click through 10 times (faster than 500ms transition)
    const vp = page.viewportSize()!;
    for (let i = 0; i < 10; i++) {
      await page.click("body", {
        position: { x: vp.width * 0.75, y: vp.height / 2 },
      });
      await page.waitForTimeout(100); // much faster than 500ms transition
    }

    // Wait for transitions to settle
    await page.waitForTimeout(1500);

    // Slideshow should still be functional — not stuck, not crashed
    const src = await currentSlideSrc(page);
    expect(src).toBeTruthy();

    // Can still navigate normally
    await tapRight(page);
    const nextSrc = await currentSlideSrc(page);
    expect(nextSrc).toBeTruthy();
    // With 5 photos, after 10+1 taps we should land on a valid slide
    expect(nextSrc).not.toBe("");
  });

  test("rapid navigation with slide transition", async ({ page }) => {
    await setupSlideshow(page, 5, { transition: "slide" });

    const vp = page.viewportSize()!;
    // Rapidly tap forward 8 times with minimal delay
    for (let i = 0; i < 8; i++) {
      await page.click("body", {
        position: { x: vp.width * 0.75, y: vp.height / 2 },
      });
      await page.waitForTimeout(80);
    }

    await page.waitForTimeout(1500);

    // Should still work — verify a valid slide is showing
    const mediaId = await currentSlideMediaId(page);
    expect(mediaId).not.toBeNull();

    // Verify the displayed media ID is one of our uploaded media
    const media = await apiGetMedia();
    const allIds = media.items.map((m) => m.id);
    expect(allIds).toContain(mediaId);
  });

  test("delete current photo during active transition", async ({ page }) => {
    await setupSlideshow(page, 4, { transition: "crossfade" });

    const beforeId = await currentSlideMediaId(page);
    expect(beforeId).not.toBeNull();

    // Start a transition
    const vp = page.viewportSize()!;
    await page.click("body", {
      position: { x: vp.width * 0.75, y: vp.height / 2 },
    });

    // Immediately (during transition) delete the photo we're transitioning TO
    const afterId = await currentSlideMediaId(page);
    if (afterId && afterId !== beforeId) {
      await apiDeleteMedia(afterId);
    }

    // Wait for transition + WS event to settle
    await page.waitForTimeout(2000);

    // Slideshow should recover — showing a valid slide, not crashed
    const finalId = await currentSlideMediaId(page);
    expect(finalId).not.toBeNull();

    // Verify it's a real media item
    const media = await apiGetMedia();
    const allIds = media.items.map((m) => m.id);
    expect(allIds).toContain(finalId);
  });

  test("rapid add and delete while slideshow is running", async ({ page }) => {
    await setupSlideshow(page, 3);

    // Rapidly add 3 photos then delete 2 in quick succession
    const r1 = await apiUploadTestImage(getSampleImage(3));
    const r2 = await apiUploadTestImage(getSampleImage(4));
    await apiUploadTestImage(getSampleImage(0)); // use index 0 again — dedup appends random bytes
    await apiDeleteMedia(r1[0].id);
    await apiDeleteMedia(r2[0].id);

    await page.waitForTimeout(3000);

    // Should have 4 items total (3 original + 1 added, 2 deleted)
    const media = await apiGetMedia();
    expect(media.total).toBe(4);

    // Slideshow should be stable with all 4 reachable
    const srcs = new Set<string>();
    srcs.add((await currentSlideSrc(page))!);
    for (let i = 0; i < 4; i++) {
      await tapRight(page);
      srcs.add((await currentSlideSrc(page))!);
    }
    expect(srcs.size).toBe(4);
  });

  test("settings interval change via API while slideshow auto-advances", async ({
    page,
  }) => {
    // Start with 3s interval
    await setupSlideshow(page, 3, { interval: 3 });

    const firstSrc = await currentSlideSrc(page);

    // After 1s, change interval to 60s via API
    await page.waitForTimeout(1000);
    await setSettings({ slideshow_interval: 60 });

    // Wait past the original 3s interval
    await page.waitForTimeout(4000);

    // The new interval should have taken effect — slide should NOT have advanced
    // (or it advanced once under the old interval, but shouldn't advance again)
    // Key test: the auto-advance timer should reset with new settings
    const currentSrc = await currentSlideSrc(page);
    // The slide may have advanced once under the old timer, but should now be stable
    // Wait another 5s — should NOT advance again
    await page.waitForTimeout(5000);
    expect(await currentSlideSrc(page)).toBe(currentSrc);
  });

  test("open detail modal then delete same photo via API", async ({
    page,
    testImagePath,
  }) => {
    await apiUploadTestImage(testImagePath);
    await apiUploadTestImage(getSampleImage(1));

    await page.goto("/");
    await expect(page.locator("[data-testid='photo-card']")).toHaveCount(2, {
      timeout: 10000,
    });

    // Click first card to open modal
    const firstCard = page.locator("[data-testid='photo-card']").first();
    const mediaId = await firstCard.getAttribute("data-media-id");
    await firstCard.click();
    await expect(page.getByTestId("media-detail-modal")).toBeVisible();

    // Delete the same photo via API (simulating another user/tab)
    await apiDeleteMedia(Number(mediaId));
    await page.waitForTimeout(2000);

    // Modal should close automatically (media no longer exists)
    await expect(page.getByTestId("media-detail-modal")).not.toBeVisible({
      timeout: 5000,
    });

    // Gallery should show 1 remaining photo
    await expect(page.locator("[data-testid='photo-card']")).toHaveCount(1, {
      timeout: 5000,
    });
  });

  test("bulk delete all items while modal is open", async ({
    page,
    testImagePath,
  }) => {
    await apiUploadTestImage(testImagePath);
    await apiUploadTestImage(getSampleImage(1));

    await page.goto("/");
    await expect(page.locator("[data-testid='photo-card']")).toHaveCount(2, {
      timeout: 10000,
    });

    // Open modal on first photo
    await page.locator("[data-testid='photo-card']").first().click();
    await expect(page.getByTestId("media-detail-modal")).toBeVisible();

    // Delete all via API
    const media = await apiGetMedia();
    for (const item of media.items) {
      await apiDeleteMedia(item.id);
    }
    await page.waitForTimeout(2000);

    // Modal should close and gallery should show empty state
    await expect(page.getByTestId("media-detail-modal")).not.toBeVisible({
      timeout: 5000,
    });
    await expect(page.getByText("No photos yet")).toBeVisible({
      timeout: 5000,
    });
  });

  test("spam pause/unpause does not break auto-advance", async ({ page }) => {
    await setupSlideshow(page, 3, { interval: 3 });

    // Rapidly toggle pause 10 times
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press("Space");
      await page.waitForTimeout(100);
    }

    // After 10 toggles, should be unpaused (even number of toggles)
    // Wait and verify auto-advance works
    const src = await currentSlideSrc(page);
    await page.waitForTimeout(4500);

    // Should have advanced (unpaused with 3s interval)
    expect(await currentSlideSrc(page)).not.toBe(src);
  });
});
