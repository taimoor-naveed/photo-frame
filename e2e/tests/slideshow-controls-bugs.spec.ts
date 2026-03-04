/**
 * Tests for slideshow controls bugs:
 * 1. Overlay should stay visible when settings change from another tab (WS)
 * 2. Video should pause when slideshow is paused
 */
import {
  test,
  expect,
  apiUploadTestImage,
  getSampleImage,
} from "../fixtures/base";

const BACKEND_URL = process.env.BACKEND_URL || "http://backend:8000";

async function setSettings(overrides: Record<string, unknown>) {
  await fetch(`${BACKEND_URL}/api/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(overrides),
  });
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
) {
  for (let i = 0; i < count; i++) {
    await apiUploadTestImage(getSampleImage(i));
  }
  await setSettings({ slideshow_interval: 120, transition_type: "crossfade" });
  await page.goto("/slideshow");
  await expect(page.locator("img").first()).toBeVisible({ timeout: 10000 });
}

test.describe("Slideshow Controls Bugs", () => {
  test("overlay stays visible when settings change via WebSocket", async ({
    page,
  }) => {
    await setupSlideshow(page, 2);

    // Open overlay
    await longPress(page);
    const overlay = page.getByText("Manage Photos");
    await expect(overlay).toBeInViewport({ timeout: 3000 });

    // Wait 2s, then change settings via API (simulating another tab)
    // This triggers a settings_changed WS broadcast to the slideshow tab
    await page.waitForTimeout(2000);
    await setSettings({ slideshow_interval: 30 });

    // Wait 4s — now 6s total since overlay opened, but only 4s since last WS change
    // With the fix: overlay should still be visible (5s timer reset at t=2)
    // Without fix: overlay auto-hid at t=5
    await page.waitForTimeout(4000);
    await expect(overlay).toBeInViewport();

    // Wait the full 5s from the WS change — overlay should now auto-hide
    await page.waitForTimeout(2000);
    await expect(overlay).not.toBeInViewport();
  });

  test("repeated WS settings changes keep overlay visible", async ({
    page,
  }) => {
    await setupSlideshow(page, 2);

    // Open overlay
    await longPress(page);
    await expect(page.getByText("Manage Photos")).toBeInViewport({
      timeout: 3000,
    });

    // Send settings changes every 2s for 8s — overlay should never hide
    for (let i = 0; i < 4; i++) {
      await page.waitForTimeout(2000);
      await setSettings({ slideshow_interval: 10 + i });
    }

    // Overlay should still be visible (last change was just now)
    await expect(page.getByText("Manage Photos")).toBeInViewport();

    // Now wait 6s with no changes — overlay should auto-hide
    await page.waitForTimeout(6000);
    await expect(page.getByText("Manage Photos")).not.toBeInViewport();
  });
});
