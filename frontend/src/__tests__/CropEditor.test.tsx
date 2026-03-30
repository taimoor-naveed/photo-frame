import { render, screen, fireEvent } from "@testing-library/react";
import CropEditor from "../components/CropEditor";

// jsdom doesn't compute layout — mock clientWidth/clientHeight on elements
// so getLayout() in CropEditor can compute geometry.
function mockLayout(containerW: number, containerH: number) {
  const originalClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
  const originalClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");

  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get() { return containerW; },
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get() { return containerH; },
  });

  return () => {
    if (originalClientWidth) Object.defineProperty(HTMLElement.prototype, "clientWidth", originalClientWidth);
    if (originalClientHeight) Object.defineProperty(HTMLElement.prototype, "clientHeight", originalClientHeight);
  };
}

const defaultProps = {
  src: "/uploads/originals/test.jpg",
  imageWidth: 800,
  imageHeight: 1200,
  initialCrop: null as { crop_x: number; crop_y: number; crop_scale: number } | null,
  onSave: vi.fn(),
  onCancel: vi.fn(),
};

describe("CropEditor", () => {
  let restoreLayout: (() => void) | null = null;

  beforeEach(() => {
    vi.restoreAllMocks();
    restoreLayout = mockLayout(400, 600);
  });

  afterEach(() => {
    restoreLayout?.();
  });

  it("renders the crop preview image", () => {
    render(<CropEditor {...defaultProps} />);
    expect(screen.getByAltText("Crop preview")).toBeInTheDocument();
  });

  it("renders the dimmed overlay with box-shadow", () => {
    render(<CropEditor {...defaultProps} />);
    const overlay = document.querySelector('[style*="box-shadow"]');
    expect(overlay).toBeTruthy();
  });

  it("exposes save function via saveRef with valid crop data", () => {
    const onSave = vi.fn();
    const saveRef = { current: null as (() => void) | null };
    render(<CropEditor {...defaultProps} onSave={onSave} saveRef={saveRef} />);
    expect(saveRef.current).toBeInstanceOf(Function);
    saveRef.current!();
    expect(onSave).toHaveBeenCalledOnce();
    const cropData = onSave.mock.calls[0][0];
    // Assert specific values: default crop should center at 0.5, 0.5 with scale >= 1
    expect(cropData.crop_x).toBeCloseTo(0.5, 1);
    expect(cropData.crop_y).toBeCloseTo(0.5, 1);
    expect(cropData.crop_scale).toBeGreaterThanOrEqual(1);
    expect(cropData.crop_scale).toBeLessThanOrEqual(10);
  });

  it("initializes from existing crop data via saveRef round-trip", () => {
    const onSave = vi.fn();
    const saveRef = { current: null as (() => void) | null };
    render(
      <CropEditor
        {...defaultProps}
        imageWidth={2000}
        imageHeight={800}
        initialCrop={{ crop_x: 0.3, crop_y: 0.4, crop_scale: 3.0 }}
        onSave={onSave}
        saveRef={saveRef}
      />,
    );
    // Trigger image load to initialize from initialCrop
    fireEvent.load(screen.getByAltText("Crop preview"));
    saveRef.current!();
    const cropData = onSave.mock.calls[0][0];
    expect(cropData.crop_x).toBeCloseTo(0.3, 1);
    expect(cropData.crop_y).toBeCloseTo(0.4, 1);
    expect(cropData.crop_scale).toBeCloseTo(3.0, 0);
  });

  it("clamps crop_scale to maximum of 10 on save", () => {
    const onSave = vi.fn();
    const saveRef = { current: null as (() => void) | null };
    // Use a very small image relative to container so minZoom is tiny,
    // making crop_scale = zoom/minZoom potentially very large
    render(
      <CropEditor
        {...defaultProps}
        imageWidth={100}
        imageHeight={100}
        onSave={onSave}
        saveRef={saveRef}
      />,
    );
    fireEvent.load(screen.getByAltText("Crop preview"));
    saveRef.current!();
    const cropData = onSave.mock.calls[0][0];
    expect(cropData.crop_scale).toBeLessThanOrEqual(10);
  });

  it("renders with landscape image (imageWidth > imageHeight)", () => {
    const onSave = vi.fn();
    const saveRef = { current: null as (() => void) | null };
    render(
      <CropEditor
        {...defaultProps}
        imageWidth={2000}
        imageHeight={800}
        onSave={onSave}
        saveRef={saveRef}
      />,
    );
    fireEvent.load(screen.getByAltText("Crop preview"));
    saveRef.current!();
    expect(onSave).toHaveBeenCalledOnce();
    const cropData = onSave.mock.calls[0][0];
    expect(cropData.crop_x).toBeCloseTo(0.5, 1);
    expect(cropData.crop_y).toBeCloseTo(0.5, 1);
  });
});
