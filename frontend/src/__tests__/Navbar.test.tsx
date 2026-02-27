import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Navbar from "../components/Navbar";

function renderNavbar(route = "/") {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Navbar />
    </MemoryRouter>,
  );
}

describe("Navbar", () => {
  it("renders app title", () => {
    renderNavbar();
    expect(screen.getByText("Photo Frame")).toBeInTheDocument();
  });

  it("renders all navigation links", () => {
    renderNavbar();
    expect(screen.getByText("Gallery")).toBeInTheDocument();
    expect(screen.getByText("Upload")).toBeInTheDocument();
    expect(screen.getByText("Settings")).toBeInTheDocument();
    expect(screen.getByText("Slideshow")).toBeInTheDocument();
  });

  it("toggles mobile menu", () => {
    renderNavbar();
    const toggle = screen.getByLabelText("Toggle menu");
    // Mobile menu links are hidden initially (only desktop links visible)
    // Click to open
    fireEvent.click(toggle);
    // Now mobile links should be visible — there will be duplicates (desktop + mobile)
    const galleryLinks = screen.getAllByText("Gallery");
    expect(galleryLinks.length).toBeGreaterThanOrEqual(2);
  });
});
