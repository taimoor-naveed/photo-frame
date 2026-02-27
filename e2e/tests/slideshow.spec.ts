import {
  test,
  expect,
  apiUploadTestImage,
  apiUploadTestVideo,
  apiGetMedia,
  apiDeleteMedia,
  apiWaitForProcessing,
} from "../fixtures/base";

test.describe("Slideshow", () => {
  test("shows empty state when no media", async ({ page }) => {
    await page.goto("/slideshow");
    await expect(page.getByText("No photos to display")).toBeVisible();
    await expect(
      page.getByText("Upload photos to start slideshow"),
    ).toBeVisible();
  });

  test("displays photo with blur background", async ({
    page,
    testImagePath,
  }) => {
    await apiUploadTestImage(testImagePath);

    await page.goto("/slideshow");

    // Should display the image (both bg and fg)
    const images = page.locator("img");
    await expect(images.first()).toBeVisible({ timeout: 10000 });

    // Should have at least 2 img elements (blur bg + foreground)
    const count = await images.count();
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test("keyboard space toggles pause", async ({
    page,
    testImagePath,
  }) => {
    await apiUploadTestImage(testImagePath);

    await page.goto("/slideshow");
    await expect(page.locator("img").first()).toBeVisible({ timeout: 10000 });

    // Press space to pause
    await page.keyboard.press("Space");
    await expect(page.getByText("Paused")).toBeVisible();

    // Press space again to resume
    await page.keyboard.press("Space");
    await expect(page.getByText("Paused")).not.toBeVisible();
  });

  test("long press toggles overlay", async ({
    page,
    testImagePath,
  }) => {
    await apiUploadTestImage(testImagePath);

    await page.goto("/slideshow");
    await expect(page.locator("img").first()).toBeVisible({ timeout: 10000 });

    const container = page.locator(".fixed.inset-0.bg-black");

    // Long press to show overlay
    await container.dispatchEvent("pointerdown");
    await page.waitForTimeout(600);
    await container.dispatchEvent("pointerup");

    // Overlay should appear
    await expect(page.getByText("Manage Photos")).toBeVisible({
      timeout: 3000,
    });
    await expect(page.getByText("Transition")).toBeVisible();
  });

  test("tap right advances to next slide", async ({
    page,
    testImagePath,
  }) => {
    // Upload 2 different images
    await apiUploadTestImage(testImagePath);
    await apiUploadTestImage(testImagePath);

    // Set sequential order and long interval so auto-advance doesn't fire
    await fetch(
      `${process.env.BACKEND_URL || "http://backend:8000"}/api/settings`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slideshow_interval: 60,
          photo_order: "sequential",
        }),
      },
    );

    await page.goto("/slideshow");
    await expect(page.locator("img").first()).toBeVisible({ timeout: 10000 });

    // Get the current image src
    const firstSrc = await page
      .locator("img[alt]:not([aria-hidden])")
      .getAttribute("src");

    // Click right half of screen to go next
    const viewport = page.viewportSize()!;
    await page.click("body", {
      position: { x: viewport.width * 0.75, y: viewport.height / 2 },
    });

    // Wait for transition
    await page.waitForTimeout(700);

    // The slide should have changed (different img src or second slide visible)
    const secondSrc = await page
      .locator(".absolute.inset-0.z-10 img[alt]:not([aria-hidden])")
      .getAttribute("src");
    expect(secondSrc).not.toBe(firstSrc);
  });

  test("tap left goes to previous slide", async ({
    page,
    testImagePath,
  }) => {
    // Upload 2 different images
    await apiUploadTestImage(testImagePath);
    await apiUploadTestImage(testImagePath);

    await fetch(
      `${process.env.BACKEND_URL || "http://backend:8000"}/api/settings`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slideshow_interval: 60,
          photo_order: "sequential",
        }),
      },
    );

    await page.goto("/slideshow");
    await expect(page.locator("img").first()).toBeVisible({ timeout: 10000 });

    // Get initial image src
    const firstSrc = await page
      .locator("img[alt]:not([aria-hidden])")
      .getAttribute("src");

    // Tap right to advance first
    const viewport = page.viewportSize()!;
    await page.click("body", {
      position: { x: viewport.width * 0.75, y: viewport.height / 2 },
    });
    await page.waitForTimeout(700);

    // Now tap left to go back
    await page.click("body", {
      position: { x: viewport.width * 0.25, y: viewport.height / 2 },
    });
    await page.waitForTimeout(700);

    // Should be back to the first slide
    const backSrc = await page
      .locator(".absolute.inset-0.z-10 img[alt]:not([aria-hidden])")
      .getAttribute("src");
    expect(backSrc).toBe(firstSrc);
  });

  test("new photo appears in running slideshow via WebSocket", async ({
    page,
    testImagePath,
  }) => {
    // Start with 1 photo
    await apiUploadTestImage(testImagePath);

    // Long interval + sequential so we control navigation manually
    await fetch(
      `${process.env.BACKEND_URL || "http://backend:8000"}/api/settings`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slideshow_interval: 60,
          photo_order: "sequential",
        }),
      },
    );

    await page.goto("/slideshow");
    await expect(page.locator("img").first()).toBeVisible({ timeout: 10000 });

    // Tap right — with only 1 photo it should wrap back to the same one
    const viewport = page.viewportSize()!;
    await page.click("body", {
      position: { x: viewport.width * 0.75, y: viewport.height / 2 },
    });
    await page.waitForTimeout(700);
    const beforeSrc = await page
      .locator(".absolute.inset-0.z-10 img[alt]:not([aria-hidden])")
      .getAttribute("src");

    // Tap right again — still the same photo (only 1 in playlist)
    await page.click("body", {
      position: { x: viewport.width * 0.75, y: viewport.height / 2 },
    });
    await page.waitForTimeout(700);
    const stillSameSrc = await page
      .locator(".absolute.inset-0.z-10 img[alt]:not([aria-hidden])")
      .getAttribute("src");
    expect(stillSameSrc).toBe(beforeSrc); // only 1 photo in rotation

    // Now upload a SECOND photo while the slideshow is running
    await apiUploadTestImage(testImagePath);

    // Wait for WebSocket event to be received and media list to refetch
    await page.waitForTimeout(2000);

    // After the WS update, the playlist now has 2 photos.
    // Grab current slide, then tap right — should show a different photo.
    const currentSrc = await page
      .locator(".absolute.inset-0.z-10 img[alt]:not([aria-hidden])")
      .getAttribute("src");

    await page.click("body", {
      position: { x: viewport.width * 0.75, y: viewport.height / 2 },
    });
    await page.waitForTimeout(700);

    const nextSrc = await page
      .locator(".absolute.inset-0.z-10 img[alt]:not([aria-hidden])")
      .getAttribute("src");

    // With 2 photos in rotation, current and next must differ
    expect(nextSrc).not.toBe(currentSrc);
  });

  test("deleted photo disappears from running slideshow via WebSocket", async ({
    page,
    testImagePath,
  }) => {
    // Start with 2 photos
    await apiUploadTestImage(testImagePath);
    await apiUploadTestImage(testImagePath);

    await fetch(
      `${process.env.BACKEND_URL || "http://backend:8000"}/api/settings`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slideshow_interval: 60,
          photo_order: "sequential",
        }),
      },
    );

    await page.goto("/slideshow");
    await expect(page.locator("img").first()).toBeVisible({ timeout: 10000 });

    // Note: with 2 photos, tapping right moves to the second, tapping again wraps to first
    // Record src of current (first) photo
    const firstSrc = await page
      .locator(".absolute.inset-0.z-10 img[alt]:not([aria-hidden])")
      .getAttribute("src");

    // Tap to advance to second photo
    const viewport = page.viewportSize()!;
    await page.click("body", {
      position: { x: viewport.width * 0.75, y: viewport.height / 2 },
    });
    await page.waitForTimeout(700);
    const secondSrc = await page
      .locator(".absolute.inset-0.z-10 img[alt]:not([aria-hidden])")
      .getAttribute("src");
    expect(secondSrc).not.toBe(firstSrc); // confirm 2 different photos

    // Delete the SECOND photo (the one currently displayed) via API
    const media = await apiGetMedia();
    // Find the media item whose filename matches the currently displayed src
    const currentFilename = secondSrc!.split("/").pop()!;
    const toDelete = media.items.find((m) => m.filename === currentFilename);
    expect(toDelete).toBeTruthy();
    await apiDeleteMedia(toDelete!.id);

    // Wait for WebSocket event to propagate
    await page.waitForTimeout(2000);

    // After deletion, the slideshow should have updated.
    // The deleted photo should no longer be displayed.
    // With only 1 photo remaining, any navigation wraps to that same photo.
    const afterDeleteSrc = await page
      .locator(".absolute.inset-0.z-10 img[alt]:not([aria-hidden])")
      .getAttribute("src");

    // Tap right — should wrap to the same (only remaining) photo
    await page.click("body", {
      position: { x: viewport.width * 0.75, y: viewport.height / 2 },
    });
    await page.waitForTimeout(700);
    const afterNavigateSrc = await page
      .locator(".absolute.inset-0.z-10 img[alt]:not([aria-hidden])")
      .getAttribute("src");

    // Both should be the first photo (the only one left)
    expect(afterDeleteSrc).toBe(firstSrc);
    expect(afterNavigateSrc).toBe(firstSrc);
  });

  test("waits for video to finish before advancing", async ({
    page,
    testImagePath,
    testVideoPath,
  }) => {
    // Upload photo first, then video — video is newer so it appears first
    // in the API response (uploaded_at desc) which is "sequential" order
    await apiUploadTestImage(testImagePath);
    const videoResult = await apiUploadTestVideo(testVideoPath);

    // Wait for video transcoding to complete before starting slideshow
    await apiWaitForProcessing(videoResult[0].id, 30000);

    // Set interval to 2s (shorter than the 5s video) and sequential order
    await fetch(
      `${process.env.BACKEND_URL || "http://backend:8000"}/api/settings`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slideshow_interval: 2,
          photo_order: "sequential",
        }),
      },
    );

    await page.goto("/slideshow");

    // Video should be playing (first slide since it's newest)
    await expect(page.locator("video").first()).toBeVisible({ timeout: 10000 });

    // After 3s (past the 2s interval), video should still be visible
    await page.waitForTimeout(3000);
    await expect(page.locator("video").first()).toBeVisible();

    // Wait for video to end (~5s total from start) + transition buffer
    // The photo should appear after the video finishes
    await expect(page.locator(".absolute.inset-0.z-10 img").first()).toBeVisible({
      timeout: 10000,
    });
  });
});
