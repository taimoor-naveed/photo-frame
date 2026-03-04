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

/** Get the data-media-id of the current foreground slide element. */
async function currentSlideMediaId(
  page: import("@playwright/test").Page,
): Promise<number | null> {
  const el = page.locator(".absolute.inset-0.z-10 [data-media-id]");
  const count = await el.count();
  if (count === 0) return null;
  const val = await el.first().getAttribute("data-media-id");
  return val ? Number(val) : null;
}

/** Upload N sample images and go to slideshow page. */
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

    // Verify the foreground src matches the uploaded photo's filename
    const media = await apiGetMedia();
    const src = await currentSlideSrc(page);
    expect(src).toContain(media.items[0].filename);
  });

  test("all uploaded photos are reachable via navigation", async ({ page }) => {
    await setupSlideshow(page, 5);

    // Collect all slide srcs by tapping forward through all 5
    const srcs = new Set<string>();
    srcs.add((await currentSlideSrc(page))!);

    for (let i = 1; i < 5; i++) {
      await tapRight(page);
      srcs.add((await currentSlideSrc(page))!);
    }

    // All 5 should be different images
    expect(srcs.size).toBe(5);
  });

  test("navigate forward and backward through photos", async ({ page }) => {
    await setupSlideshow(page, 4);

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
    await setupSlideshow(page, 3, { interval: 3 });

    const firstSrc = await currentSlideSrc(page);

    // Wait for auto-advance (3s interval + buffer)
    await page.waitForTimeout(4500);

    const afterSrc = await currentSlideSrc(page);
    expect(afterSrc).not.toBe(firstSrc);
  });

  test("pause stops auto-advance, unpause resumes", async ({ page }) => {
    await setupSlideshow(page, 3, { interval: 3 });

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
    await expect(page.getByTestId("slideshow-overlay")).toBeInViewport({ timeout: 3000 });
    await expect(page.getByText("Transition")).toBeVisible();

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
    await expect(page.getByTestId("slideshow-overlay")).not.toBeInViewport();
  });

  test("slideshow overlay has no order section", async ({ page }) => {
    await setupSlideshow(page, 2);

    await longPress(page);
    await expect(page.getByTestId("slideshow-overlay")).toBeInViewport({ timeout: 3000 });

    // No "Order" label or order buttons
    await expect(page.getByText("Order", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "random" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "sequential" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "newest" })).toHaveCount(0);
  });

  // ─── Add During Slideshow ──────────────────────────────────

  test("adding photo mid-slideshow doesn't change current slide", async ({
    page,
  }) => {
    await setupSlideshow(page, 3);

    const originalSrc = await currentSlideSrc(page);

    // Upload a 4th photo while slideshow is running
    await apiUploadTestImage(getSampleImage(3));
    await page.waitForTimeout(1500); // wait for WebSocket

    // Current slide should not have changed
    expect(await currentSlideSrc(page)).toBe(originalSrc);
  });

  test("newly added photo is reachable within one cycle", async ({ page }) => {
    await setupSlideshow(page, 3);

    // Upload a 4th photo
    await apiUploadTestImage(getSampleImage(3));
    await page.waitForTimeout(1500);

    // Navigate through all 4 photos
    const srcs = new Set<string>();
    srcs.add((await currentSlideSrc(page))!);
    for (let i = 0; i < 4; i++) {
      await tapRight(page);
      srcs.add((await currentSlideSrc(page))!);
    }
    // Should have seen 4 distinct photos
    expect(srcs.size).toBe(4);
  });

  test("adding multiple photos mid-slideshow all become reachable", async ({
    page,
  }) => {
    await setupSlideshow(page, 2);

    // Upload 3 more
    await apiUploadTestImage(getSampleImage(2));
    await apiUploadTestImage(getSampleImage(3));
    await apiUploadTestImage(getSampleImage(4));
    await page.waitForTimeout(2000);

    // Navigate through all 5
    const srcs = new Set<string>();
    srcs.add((await currentSlideSrc(page))!);
    for (let i = 0; i < 5; i++) {
      await tapRight(page);
      srcs.add((await currentSlideSrc(page))!);
    }
    expect(srcs.size).toBe(5);
  });

  // ─── Delete During Slideshow ───────────────────────────────

  test("delete non-displayed photo: current slide unchanged", async ({
    page,
  }) => {
    await setupSlideshow(page, 4);

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
    await setupSlideshow(page, 3);

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

  test("delete all photos one by one: empty state", async ({ page }) => {
    await setupSlideshow(page, 3);

    // Delete all via API
    const media = await apiGetMedia();
    for (const item of media.items) {
      await apiDeleteMedia(item.id);
    }
    await page.waitForTimeout(2000);

    // Should show empty state
    await expect(page.getByText("No photos to display")).toBeVisible({
      timeout: 5000,
    });
  });

  test("rapid deletion of multiple photos", async ({ page }) => {
    await setupSlideshow(page, 5);

    // Delete 3 in quick succession
    const media = await apiGetMedia();
    await apiDeleteMedia(media.items[0].id);
    await apiDeleteMedia(media.items[1].id);
    await apiDeleteMedia(media.items[2].id);
    await page.waitForTimeout(2000);

    // Slideshow should continue with 2 remaining — no crash
    const srcs = new Set<string>();
    srcs.add((await currentSlideSrc(page))!);
    await tapRight(page);
    srcs.add((await currentSlideSrc(page))!);
    expect(srcs.size).toBe(2);
  });

  // ─── Add + Delete Combined ─────────────────────────────────

  test("add then immediately delete: slideshow stable", async ({ page }) => {
    await setupSlideshow(page, 3);

    // Upload 4th
    const uploaded = await apiUploadTestImage(getSampleImage(3));
    await page.waitForTimeout(500);
    // Immediately delete it
    await apiDeleteMedia(uploaded[0].id);
    await page.waitForTimeout(1500);

    // Slideshow should have 3 items, no crash
    const srcs = new Set<string>();
    srcs.add((await currentSlideSrc(page))!);
    for (let i = 0; i < 3; i++) {
      await tapRight(page);
      srcs.add((await currentSlideSrc(page))!);
    }
    expect(srcs.size).toBe(3);
  });

  test("delete current, then add new: slideshow recovers", async ({
    page,
  }) => {
    await setupSlideshow(page, 3);

    const originalSrc = await currentSlideSrc(page);

    // Delete current
    const media = await apiGetMedia();
    const currentFilename = originalSrc!.split("/").pop()!;
    const toDelete = media.items.find((m) => m.filename === currentFilename);
    await apiDeleteMedia(toDelete!.id);
    await page.waitForTimeout(1000);

    // Add new
    await apiUploadTestImage(getSampleImage(3));
    await page.waitForTimeout(1500);

    // Should have 3 items reachable
    const srcs = new Set<string>();
    srcs.add((await currentSlideSrc(page))!);
    for (let i = 0; i < 3; i++) {
      await tapRight(page);
      srcs.add((await currentSlideSrc(page))!);
    }
    expect(srcs.size).toBe(3);
  });

  // ─── Video Handling ────────────────────────────────────────

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
    });

    await page.goto("/slideshow");
    await expect(page.locator("video").first()).toBeVisible({ timeout: 10000 });

    // Capture the video's media ID
    const videoMediaId = await currentSlideMediaId(page);
    expect(videoMediaId).toBe(videoResult[0].id);

    // After 3s (past the 2s interval), same video should still be playing
    await page.waitForTimeout(3000);
    expect(await currentSlideMediaId(page)).toBe(videoMediaId);

    // Eventually the video ends and photo appears
    await expect(
      page.locator(".absolute.inset-0.z-10 img").first(),
    ).toBeVisible({ timeout: 10000 });
    // Now the media ID should be different (the photo)
    expect(await currentSlideMediaId(page)).not.toBe(videoMediaId);
  });

  test("delete video during playback: advances to next", async ({
    page,
    testImagePath,
    testVideoPath,
  }) => {
    // Upload 1 photo + 1 video
    const photoResult = await apiUploadTestImage(testImagePath);
    const videoResult = await apiUploadTestVideo(testVideoPath);
    await apiWaitForProcessing(videoResult[0].id, 30000);

    await setSettings({ slideshow_interval: 120 });
    await page.goto("/slideshow");
    await expect(page.locator("img").first()).toBeVisible({ timeout: 10000 });

    // Navigate to find the video
    const videoLocator = page.locator(".absolute.inset-0.z-10 video");
    const imgLocator = page.locator(".absolute.inset-0.z-10 img[alt]:not([aria-hidden])");
    let foundVideo = (await videoLocator.count()) > 0;
    if (!foundVideo) {
      await tapRight(page);
      foundVideo = (await videoLocator.count()) > 0;
    }

    if (foundVideo) {
      // Confirm video ID is shown
      expect(await currentSlideMediaId(page)).toBe(videoResult[0].id);

      // Delete the video
      await apiDeleteMedia(videoResult[0].id);
      await page.waitForTimeout(1500);

      // Photo should now be shown — verify it's the photo, not the video
      await expect(imgLocator).toBeVisible({ timeout: 5000 });
      expect(await currentSlideMediaId(page)).toBe(photoResult[0].id);
    }
  });

  // ─── Edge Cases ────────────────────────────────────────────

  test("single photo slideshow: displays and loops", async ({ page }) => {
    await setupSlideshow(page, 1);

    const src = await currentSlideSrc(page);
    expect(src).toBeTruthy();

    // Tap right — should still show the same photo (loops)
    await tapRight(page);
    expect(await currentSlideSrc(page)).toBe(src);
  });

  test("slideshow with only 2 photos: alternates", async ({ page }) => {
    await setupSlideshow(page, 2);

    const first = await currentSlideSrc(page);
    await tapRight(page);
    const second = await currentSlideSrc(page);
    expect(second).not.toBe(first);

    // Back to first
    await tapLeft(page);
    expect(await currentSlideSrc(page)).toBe(first);
  });

  // ─── Keyboard ──────────────────────────────────────────────

  // ─── Critical Identity Tests ──────────────────────────────

  test("first photo added to empty slideshow displays immediately", async ({
    page,
  }) => {
    await page.goto("/slideshow");
    await expect(page.getByText("No photos to display")).toBeVisible();

    // Upload photo via API while on the empty slideshow page
    const result = await apiUploadTestImage(getSampleImage(0));
    const uploadedId = result[0].id;
    const uploadedFilename = result[0].filename;

    // Photo should appear without refresh — verify by media ID
    await expect(
      page.locator(`[data-media-id="${uploadedId}"]`),
    ).toBeVisible({ timeout: 10000 });

    // Verify src contains the uploaded filename
    const src = await currentSlideSrc(page);
    expect(src).toContain(uploadedFilename);
  });

  test("adding photo during video playback does not interrupt video", async ({
    page,
    testImagePath,
    testVideoPath,
  }) => {
    // Upload video first
    const videoResult = await apiUploadTestVideo(testVideoPath);
    await apiWaitForProcessing(videoResult[0].id, 30000);

    await setSettings({ slideshow_interval: 120 });
    await page.goto("/slideshow");

    // Wait for video to start playing
    await expect(page.locator("video").first()).toBeVisible({ timeout: 10000 });
    const videoId = await currentSlideMediaId(page);
    expect(videoId).toBe(videoResult[0].id);

    // Upload a photo while video is playing
    await apiUploadTestImage(testImagePath);
    await page.waitForTimeout(1500);

    // Video should still be playing — same media ID
    expect(await currentSlideMediaId(page)).toBe(videoId);
  });

  // ─── Keyboard ──────────────────────────────────────────────

  test("keyboard: arrow keys navigate, escape closes overlay", async ({
    page,
  }) => {
    await setupSlideshow(page, 3);

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
    await expect(page.getByTestId("slideshow-overlay")).toBeInViewport({ timeout: 3000 });
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("slideshow-overlay")).not.toBeInViewport();
  });
});
