import {
  test,
  expect,
  apiUploadTestImage,
  apiUploadTestVideo,
  apiGetMedia,
  apiDeleteMedia,
  apiWaitForProcessing,
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

/** Foreground image src of the current slide (z-10 layer). */
async function currentSlideSrc(page: import("@playwright/test").Page) {
  return page
    .locator(".absolute.inset-0.z-10 img[alt]:not([aria-hidden])")
    .getAttribute("src");
}

/** Tap the right half of the screen (go next). */
async function tapRight(page: import("@playwright/test").Page) {
  const vp = page.viewportSize()!;
  await page.click("body", {
    position: { x: vp.width * 0.75, y: vp.height / 2 },
  });
  await page.waitForTimeout(700); // wait for transition
}

/** Tap the left half of the screen (go prev). */
async function tapLeft(page: import("@playwright/test").Page) {
  const vp = page.viewportSize()!;
  await page.click("body", {
    position: { x: vp.width * 0.25, y: vp.height / 2 },
  });
  await page.waitForTimeout(700);
}

/** Long-press to toggle overlay. */
async function longPress(page: import("@playwright/test").Page) {
  const container = page.locator(".fixed.inset-0.bg-black");
  await container.dispatchEvent("pointerdown");
  await page.waitForTimeout(600);
  await container.dispatchEvent("pointerup");
}

/** Upload N sample images and return to a started slideshow page. */
async function setupSlideshow(
  page: import("@playwright/test").Page,
  count: number,
  opts: { interval?: number; order?: string; transition?: string } = {},
) {
  for (let i = 0; i < count; i++) {
    await apiUploadTestImage(getSampleImage(i));
  }
  await setSettings({
    slideshow_interval: opts.interval ?? 120,
    photo_order: opts.order ?? "sequential",
    transition_type: opts.transition ?? "crossfade",
  });
  await page.goto("/slideshow");
  await expect(page.locator("img").first()).toBeVisible({ timeout: 10000 });
}

// ─── Tests ────────────────────────────────────────────────────

test.describe("Slideshow", () => {
  test("shows empty state when no media", async ({ page }) => {
    await page.goto("/slideshow");
    await expect(page.getByText("No photos to display")).toBeVisible();
    await expect(
      page.getByText("Upload photos to start slideshow"),
    ).toBeVisible();
  });

  test("displays photo with blur background", async ({ page }) => {
    await setupSlideshow(page, 1);

    // Should have at least 2 img elements (blur bg + foreground)
    const images = page.locator("img");
    const count = await images.count();
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test("navigate forward and backward through 4 photos", async ({ page }) => {
    await setupSlideshow(page, 4, { order: "sequential" });

    // Collect all 4 slide srcs by tapping forward
    const srcs: string[] = [];
    srcs.push((await currentSlideSrc(page))!);

    for (let i = 1; i < 4; i++) {
      await tapRight(page);
      const src = await currentSlideSrc(page);
      srcs.push(src!);
    }

    // All 4 should be different images
    const unique = new Set(srcs);
    expect(unique.size).toBe(4);

    // Tapping right once more wraps around to the first
    await tapRight(page);
    expect(await currentSlideSrc(page)).toBe(srcs[0]);

    // Tap left goes back to the last
    await tapLeft(page);
    expect(await currentSlideSrc(page)).toBe(srcs[3]);

    // Tap left 3 more times to return to the first
    await tapLeft(page);
    expect(await currentSlideSrc(page)).toBe(srcs[2]);
    await tapLeft(page);
    expect(await currentSlideSrc(page)).toBe(srcs[1]);
    await tapLeft(page);
    expect(await currentSlideSrc(page)).toBe(srcs[0]);
  });

  test("auto-advance moves to next slide after interval", async ({ page }) => {
    await setupSlideshow(page, 3, { interval: 3, order: "sequential" });

    const firstSrc = await currentSlideSrc(page);

    // Wait for auto-advance (3s interval + buffer)
    await page.waitForTimeout(4500);

    const afterSrc = await currentSlideSrc(page);
    expect(afterSrc).not.toBe(firstSrc);
  });

  test("pause stops auto-advance, unpause resumes", async ({ page }) => {
    await setupSlideshow(page, 3, { interval: 3, order: "sequential" });

    const firstSrc = await currentSlideSrc(page);

    // Pause with spacebar
    await page.keyboard.press("Space");
    await expect(page.getByText("Paused")).toBeVisible();

    // Wait longer than the interval
    await page.waitForTimeout(4500);

    // Should still be on the same slide
    expect(await currentSlideSrc(page)).toBe(firstSrc);

    // Unpause
    await page.keyboard.press("Space");
    await expect(page.getByText("Paused")).not.toBeVisible();

    // Wait for auto-advance
    await page.waitForTimeout(4500);
    expect(await currentSlideSrc(page)).not.toBe(firstSrc);
  });

  test("overlay: long press shows it, settings work", async ({ page }) => {
    await setupSlideshow(page, 2);

    // Long press opens overlay
    await longPress(page);
    await expect(page.getByText("Manage Photos")).toBeVisible({ timeout: 3000 });
    await expect(page.getByText("Transition")).toBeVisible();
    await expect(page.getByText("Order")).toBeVisible();

    // Change transition to "none"
    await page.getByRole("button", { name: "none" }).click();

    // Verify via API
    await page.waitForTimeout(500);
    const settings = await (
      await fetch(`${BACKEND_URL}/api/settings`)
    ).json();
    expect(settings.transition_type).toBe("none");

    // Escape closes overlay (slides off-screen via translate-y-full)
    await page.keyboard.press("Escape");
    await expect(page.getByText("Manage Photos")).not.toBeInViewport();
  });

  test("add photo mid-slideshow: current slide unchanged, new photo reachable", async ({
    page,
  }) => {
    await setupSlideshow(page, 2, { order: "sequential" });

    const originalSrc = await currentSlideSrc(page);

    // Upload a 3rd photo while slideshow is running
    await apiUploadTestImage(getSampleImage(2));
    await page.waitForTimeout(1500); // wait for WebSocket

    // Current slide should not have changed
    expect(await currentSlideSrc(page)).toBe(originalSrc);

    // Navigate through all 3 photos to verify the new one is accessible
    const srcs = new Set<string>();
    srcs.add((await currentSlideSrc(page))!);
    for (let i = 0; i < 3; i++) {
      await tapRight(page);
      srcs.add((await currentSlideSrc(page))!);
    }
    // Should have seen 3 distinct photos (4th tap wraps back)
    expect(srcs.size).toBe(3);
  });

  test("delete non-displayed photo: current slide unchanged", async ({
    page,
  }) => {
    await setupSlideshow(page, 4, { order: "sequential" });

    const originalSrc = await currentSlideSrc(page);

    // Delete a photo that is NOT currently displayed
    const media = await apiGetMedia();
    const currentFilename = originalSrc!.split("/").pop()!;
    const other = media.items.find((m) => m.filename !== currentFilename);
    expect(other).toBeTruthy();
    await apiDeleteMedia(other!.id);
    await page.waitForTimeout(1500); // wait for WebSocket

    // Current slide should be exactly the same
    expect(await currentSlideSrc(page)).toBe(originalSrc);

    // Navigation still works with 3 remaining photos
    const srcs = new Set<string>();
    srcs.add((await currentSlideSrc(page))!);
    for (let i = 0; i < 3; i++) {
      await tapRight(page);
      srcs.add((await currentSlideSrc(page))!);
    }
    expect(srcs.size).toBe(3);
  });

  test("delete currently displayed photo: advances to remaining", async ({
    page,
  }) => {
    await setupSlideshow(page, 3, { order: "sequential" });

    const originalSrc = await currentSlideSrc(page);

    // Delete the currently displayed photo
    const media = await apiGetMedia();
    const currentFilename = originalSrc!.split("/").pop()!;
    const toDelete = media.items.find((m) => m.filename === currentFilename);
    expect(toDelete).toBeTruthy();
    await apiDeleteMedia(toDelete!.id);
    await page.waitForTimeout(1500);

    // Should now show a different photo
    const afterSrc = await currentSlideSrc(page);
    expect(afterSrc).not.toBe(originalSrc);

    // Should have 2 remaining photos in rotation
    const srcs = new Set<string>();
    srcs.add(afterSrc!);
    await tapRight(page);
    srcs.add((await currentSlideSrc(page))!);
    await tapRight(page);
    // Wraps back
    expect(await currentSlideSrc(page)).toBe(afterSrc);
    expect(srcs.size).toBe(2);
  });

  test("video: waits for long video to finish before advancing", async ({
    page,
    testImagePath,
    testVideoPath,
  }) => {
    // Upload photo first, then video
    await apiUploadTestImage(testImagePath);
    const videoResult = await apiUploadTestVideo(testVideoPath);
    await apiWaitForProcessing(videoResult[0].id, 30000);

    // Interval shorter than video (2s < 5s video)
    await setSettings({
      slideshow_interval: 2,
      photo_order: "sequential",
    });

    await page.goto("/slideshow");
    await expect(page.locator("video").first()).toBeVisible({ timeout: 10000 });

    // After 3s (past the 2s interval), video should still be playing
    await page.waitForTimeout(3000);
    await expect(page.locator("video").first()).toBeVisible();

    // Eventually the video ends and photo appears
    await expect(
      page.locator(".absolute.inset-0.z-10 img").first(),
    ).toBeVisible({ timeout: 10000 });
  });

  test("keyboard: arrow keys navigate, escape closes overlay", async ({
    page,
  }) => {
    await setupSlideshow(page, 3, { order: "sequential" });

    const firstSrc = await currentSlideSrc(page);

    // ArrowRight advances
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(700);
    const secondSrc = await currentSlideSrc(page);
    expect(secondSrc).not.toBe(firstSrc);

    // ArrowLeft goes back
    await page.keyboard.press("ArrowLeft");
    await page.waitForTimeout(700);
    expect(await currentSlideSrc(page)).toBe(firstSrc);

    // Open overlay, then Escape closes it
    await longPress(page);
    await expect(page.getByText("Manage Photos")).toBeVisible({ timeout: 3000 });
    await page.keyboard.press("Escape");
    await expect(page.getByText("Manage Photos")).not.toBeInViewport();
  });
});
