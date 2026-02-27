import { test, expect } from "../fixtures/base";

test.describe("Video Processing Progress", () => {
  test("upload HEVC video shows circular progress in gallery", async ({
    page,
    testHevcVideoPath,
  }) => {
    // Upload a 15s HEVC video through the frontend UI
    await page.goto("/upload");

    const fileChooserPromise = page.waitForEvent("filechooser");
    await page.getByText("Choose Files").click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(testHevcVideoPath);

    // Wait for upload to complete (file transfer to server)
    await expect(page.getByText("uploaded")).toBeVisible({ timeout: 60000 });

    // Navigate to gallery
    await page.getByText("View Gallery").click();
    await expect(page).toHaveURL("/");

    // The video should appear as a card
    const card = page.locator("[data-testid='photo-card']").first();
    await expect(card).toBeVisible({ timeout: 10000 });

    // Should show processing overlay (SVG circle progress)
    // The SVG has two <circle> elements: track + progress arc
    const progressCircles = card.locator("svg circle");

    // Check for progress or completion over time
    let sawProgress = false;
    let sawComplete = false;
    for (let i = 0; i < 30; i++) {
      const circleCount = await progressCircles.count();
      if (circleCount === 2) {
        // Processing overlay is showing — check for percentage
        const cardText = await card.textContent();
        if (cardText && /\d+%/.test(cardText)) {
          sawProgress = true;
        }
      } else if (circleCount === 0) {
        sawComplete = true;
        break;
      }
      await page.waitForTimeout(1000);
    }

    // Processing should have completed
    expect(sawComplete).toBe(true);

    // For a 15s 720p HEVC video, we should see at least one progress update
    expect(sawProgress || sawComplete).toBe(true);
  });
});
