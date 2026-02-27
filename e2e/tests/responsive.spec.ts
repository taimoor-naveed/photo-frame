import { test, expect } from "../fixtures/base";

test.describe("Responsive Layout", () => {
  test("navbar shows hamburger on mobile", async ({ page, isMobile }) => {
    test.skip(!isMobile, "Mobile only test");

    await page.goto("/");
    await expect(page.getByLabel("Toggle menu")).toBeVisible();
  });

  test("navbar shows links on desktop", async ({ page, isMobile }) => {
    test.skip(isMobile === true, "Desktop only test");

    await page.goto("/");
    // Desktop nav links
    const galleryLink = page.locator("nav").getByRole("link", {
      name: "Gallery",
    });
    await expect(galleryLink).toBeVisible();
    await expect(
      page.locator("nav").getByRole("link", { name: "Upload" }),
    ).toBeVisible();
    await expect(
      page.locator("nav").getByRole("link", { name: "Settings" }),
    ).toBeVisible();
  });

  test("mobile menu opens and navigates", async ({ page, isMobile }) => {
    test.skip(!isMobile, "Mobile only test");

    await page.goto("/");
    await page.getByLabel("Toggle menu").click();

    const navUpload = page.locator("nav").getByRole("link", { name: "Upload" });
    await expect(navUpload).toBeVisible();
    await navUpload.click();
    await expect(page).toHaveURL("/upload");
  });

  test("gallery loads at current viewport", async ({ page }) => {
    await page.goto("/");
    // Page should load (may show empty or gallery depending on state)
    await expect(page.locator("body")).not.toBeEmpty();
  });
});
