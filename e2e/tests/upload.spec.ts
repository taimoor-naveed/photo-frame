import { test, expect } from "../fixtures/base";

test.describe("Upload", () => {
  test("upload page renders correctly", async ({ page }) => {
    await page.goto("/upload");
    await expect(page.getByRole("heading", { name: "Upload" })).toBeVisible();
    await expect(page.getByText("Choose Files")).toBeVisible();
  });

  test("upload a photo via file picker", async ({ page, testImagePath }) => {
    await page.goto("/upload");

    const fileChooserPromise = page.waitForEvent("filechooser");
    await page.getByText("Choose Files").click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(testImagePath);

    // Should show success
    await expect(page.getByText("uploaded")).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("Upload more")).toBeVisible();
    await expect(page.getByText("View Gallery")).toBeVisible();
  });

  test("upload more button resets the form", async ({
    page,
    testImagePath,
  }) => {
    await page.goto("/upload");

    const fileChooserPromise = page.waitForEvent("filechooser");
    await page.getByText("Choose Files").click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(testImagePath);

    await expect(page.getByText("uploaded")).toBeVisible({ timeout: 15000 });

    await page.getByText("Upload more").click();
    await expect(page.getByText("Choose Files")).toBeVisible();
  });
});
