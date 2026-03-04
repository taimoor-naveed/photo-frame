/**
 * Slideshow overlay auto-hide, dismiss, and edge case tests.
 * Tests the overlay behavior that spec requires but has no test coverage.
 */
import {
  test,
  expect,
  apiUploadTestImage,
  apiGetMedia,
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

async function longPress(page: import("@playwright/test").Page) {
  const container = page.locator(".fixed.inset-0.bg-black");
  await container.dispatchEvent("pointerdown");
  await page.waitForTimeout(600);
  await container.dispatchEvent("pointerup");
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

test.describe("Slideshow Overlay Edge Cases", () => {
  test("overlay auto-hides after 5 seconds of inactivity", async ({
    page,
  }) => {
    await setupSlideshow(page, 2);

    // Open overlay
    await longPress(page);
    await expect(page.getByTestId("slideshow-overlay")).toBeInViewport({
      timeout: 3000,
    });

    // Wait 6 seconds (5s auto-hide + 1s buffer)
    await page.waitForTimeout(6000);

    // Overlay should have auto-hidden (translate-y-full = not in viewport)
    await expect(page.getByTestId("slideshow-overlay")).not.toBeInViewport();
  });

  test("overlay interaction resets auto-hide timer", async ({ page }) => {
    await setupSlideshow(page, 2);

    // Open overlay
    await longPress(page);
    await expect(page.getByTestId("slideshow-overlay")).toBeInViewport({
      timeout: 3000,
    });

    // Wait 3 seconds (more than half of 5s timeout)
    await page.waitForTimeout(3000);

    // Click a button inside the overlay (this should reset the timer)
    await page.getByRole("button", { name: "Pause slideshow" }).click();

    // Wait another 3 seconds (total 6s since open, but only 3s since last interaction)
    await page.waitForTimeout(3000);

    // Overlay should still be visible (timer was reset)
    await expect(page.getByTestId("slideshow-overlay")).toBeInViewport();

    // Wait the full 5s from last interaction
    await page.waitForTimeout(3000);

    // Now it should be hidden
    await expect(page.getByTestId("slideshow-overlay")).not.toBeInViewport();
  });

  test("clicking outside overlay dismisses it", async ({ page }) => {
    await setupSlideshow(page, 2);

    // Open overlay
    await longPress(page);
    await expect(page.getByTestId("slideshow-overlay")).toBeInViewport({
      timeout: 3000,
    });

    // Click on the slideshow area (top of screen, far from overlay)
    const vp = page.viewportSize()!;
    await page.click("body", {
      position: { x: vp.width / 2, y: 50 }, // top center — not on overlay
    });

    // Overlay should be dismissed
    await page.waitForTimeout(500);
    await expect(page.getByTestId("slideshow-overlay")).not.toBeInViewport();
  });

  test("overlay controls don't trigger slideshow navigation", async ({
    page,
  }) => {
    await setupSlideshow(page, 3);

    const srcBefore = await currentSlideSrc(page);

    // Open overlay
    await longPress(page);
    await expect(page.getByTestId("slideshow-overlay")).toBeInViewport({
      timeout: 3000,
    });

    // Click buttons inside the overlay with small waits to avoid event coalescence
    await page.getByRole("button", { name: "Pause slideshow" }).click();
    await page.waitForTimeout(300);
    await page.getByRole("button", { name: "none", exact: true }).click();
    await page.waitForTimeout(300);
    await page.getByRole("button", { name: "crossfade", exact: true }).click();
    await page.waitForTimeout(300);

    // Overlay should still be visible (interactions reset hide timer)
    await expect(page.getByTestId("slideshow-overlay")).toBeInViewport();

    // Slide should NOT have changed (overlay clicks don't propagate)
    expect(await currentSlideSrc(page)).toBe(srcBefore);
  });

  test("transition type change in overlay takes effect immediately", async ({
    page,
  }) => {
    await setupSlideshow(page, 3, { transition: "crossfade" });

    // Open overlay and change to "none"
    await longPress(page);
    await expect(page.getByTestId("slideshow-overlay")).toBeInViewport({
      timeout: 3000,
    });
    await page.getByRole("button", { name: "none" }).click();
    await page.waitForTimeout(500);

    // Verify via API
    const settings = await apiGetSettings();
    expect(settings.transition_type).toBe("none");

    // Close overlay
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);

    // Navigate — transition should be "none" (instant, no animation)
    const srcBefore = await currentSlideSrc(page);
    const vp = page.viewportSize()!;
    await page.click("body", {
      position: { x: vp.width * 0.75, y: vp.height / 2 },
    });
    // With "none" transition, the change should be nearly instant
    await page.waitForTimeout(200);
    const srcAfter = await currentSlideSrc(page);
    expect(srcAfter).not.toBe(srcBefore);
  });

  test("interval change in overlay affects auto-advance timing", async ({
    page,
  }) => {
    // Start with long interval (won't auto-advance)
    await setupSlideshow(page, 3, { interval: 120 });

    const srcBefore = await currentSlideSrc(page);

    // Change interval to 3s via API (the overlay slider triggers the same API call)
    await setSettings({ slideshow_interval: 3 });

    // Wait for WebSocket settings_changed event to propagate
    await page.waitForTimeout(1500);

    // Wait for auto-advance with new 3s interval
    await page.waitForTimeout(4500);

    // Slide should have advanced
    expect(await currentSlideSrc(page)).not.toBe(srcBefore);
  });

  test("space key toggles pause and shows indicator", async ({ page }) => {
    await setupSlideshow(page, 3, { interval: 120 });

    // Press Space to pause
    await page.keyboard.press("Space");
    await expect(page.getByText("Paused")).toBeVisible();

    // Press Space again to unpause
    await page.keyboard.press("Space");
    await expect(page.getByText("Paused")).not.toBeVisible();
  });

  test("overlay shows correct current settings", async ({ page }) => {
    // Set specific settings
    await setSettings({ slideshow_interval: 15, transition_type: "slide" });
    await apiUploadTestImage(getSampleImage(0));
    await apiUploadTestImage(getSampleImage(1));
    await page.goto("/slideshow");
    await expect(page.locator("img").first()).toBeVisible({ timeout: 10000 });

    // Open overlay
    await longPress(page);
    await expect(page.getByTestId("slideshow-overlay")).toBeInViewport({
      timeout: 3000,
    });

    // Verify interval shows "15s"
    await expect(page.getByText("15s")).toBeVisible();

    // Verify "slide" button is active (has copper bg styling)
    const slideBtn = page.getByRole("button", { name: "slide", exact: true });
    await expect(slideBtn).toHaveClass(/bg-copper/);
  });

});
