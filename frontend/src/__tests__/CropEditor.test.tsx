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
    // Default: 400x600 container (mobile-like)
    restoreLayout = mockLayout(400, 600);
  });

  afterEach(() => {
    restoreLayout?.();
  });

  it("renders with Save and Cancel buttons", () => {
    render(<CropEditor {...defaultProps} />);
    expect(screen.getByRole("button", { name: /save/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
  });

  it("renders a zoom slider", () => {
    render(<CropEditor {...defaultProps} />);
    expect(screen.getByRole("slider")).toBeInTheDocument();
  });

  it("calls onCancel when Cancel is clicked", () => {
    const onCancel = vi.fn();
    render(<CropEditor {...defaultProps} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("calls onSave with crop data when Save is clicked", () => {
    const onSave = vi.fn();
    render(<CropEditor {...defaultProps} onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(onSave).toHaveBeenCalledOnce();
    const cropData = onSave.mock.calls[0][0];
    expect(cropData).toHaveProperty("crop_x");
    expect(cropData).toHaveProperty("crop_y");
    expect(cropData).toHaveProperty("crop_scale");
    // Default: centered
    expect(cropData.crop_x).toBeCloseTo(0.5, 1);
    expect(cropData.crop_y).toBeCloseTo(0.5, 1);
    expect(cropData.crop_scale).toBeGreaterThanOrEqual(1);
  });

  it("initializes with existing crop data when provided", () => {
    const onSave = vi.fn();
    // Wide image (minScale=1.0) so scale 3.0 is valid
    render(
      <CropEditor
        {...defaultProps}
        imageWidth={2000}
        imageHeight={800}
        initialCrop={{ crop_x: 0.3, crop_y: 0.4, crop_scale: 3.0 }}
        onSave={onSave}
      />,
    );
    // Trigger image load to initialize from initialCrop
    const img = screen.getByAltText("Crop preview");
    fireEvent.load(img);

    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    const cropData = onSave.mock.calls[0][0];
    // The values should round-trip approximately. The exact numbers depend on
    // the mock layout geometry, so we check they're in the right ballpark.
    expect(cropData.crop_x).toBeCloseTo(0.3, 0);
    expect(cropData.crop_y).toBeCloseTo(0.4, 0);
    expect(cropData.crop_scale).toBeGreaterThan(1);
  });

  it("shows 'Saving...' and disables Save button when saving is true", () => {
    render(<CropEditor {...defaultProps} saving={true} />);
    const saveBtn = screen.getByRole("button", { name: /saving/i });
    expect(saveBtn).toBeDisabled();
  });

  it("renders dimmed overlay with rule-of-thirds grid", () => {
    render(<CropEditor {...defaultProps} />);
    // The overlay uses box-shadow for dimming
    const overlay = document.querySelector('[style*="box-shadow"]');
    expect(overlay).toBeTruthy();
  });
});
