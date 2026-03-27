import { render, screen, fireEvent } from "@testing-library/react";
import CropEditor from "../components/CropEditor";

const defaultProps = {
  src: "/uploads/originals/test.jpg",
  imageWidth: 800,
  imageHeight: 1200,
  initialCrop: null as { crop_x: number; crop_y: number; crop_scale: number } | null,
  onSave: vi.fn(),
  onCancel: vi.fn(),
};

describe("CropEditor", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
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
    expect(cropData.crop_x).toBeCloseTo(0.5, 1);
    expect(cropData.crop_y).toBeCloseTo(0.5, 1);
    expect(cropData.crop_scale).toBeGreaterThanOrEqual(1);
  });

  it("initializes with existing crop data when provided", () => {
    const onSave = vi.fn();
    // Use a wide image (minScale=1.0) so 1.8 is valid
    render(
      <CropEditor
        {...defaultProps}
        imageWidth={2000}
        imageHeight={800}
        initialCrop={{ crop_x: 0.3, crop_y: 0.2, crop_scale: 3.0 }}
        onSave={onSave}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    const cropData = onSave.mock.calls[0][0];
    expect(cropData.crop_x).toBeCloseTo(0.3, 1);
    expect(cropData.crop_y).toBeCloseTo(0.2, 1);
    expect(cropData.crop_scale).toBeCloseTo(3.0, 1);
  });

  it("updates scale when zoom slider is changed", () => {
    const onSave = vi.fn();
    // Use a wide image (minScale=1.0) so 2.5 is valid
    render(
      <CropEditor
        {...defaultProps}
        imageWidth={2000}
        imageHeight={800}
        onSave={onSave}
      />,
    );
    const slider = screen.getByRole("slider");
    fireEvent.change(slider, { target: { value: "2.5" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    const cropData = onSave.mock.calls[0][0];
    expect(cropData.crop_scale).toBeCloseTo(2.5, 1);
  });

  it("clamps scale to minimum when slider is set below min", () => {
    const onSave = vi.fn();
    // 600x1200 is very tall — minScale = (1024/600) / (600/1200) = 1.707/0.5 = 3.413
    render(
      <CropEditor
        {...defaultProps}
        imageWidth={600}
        imageHeight={1200}
        onSave={onSave}
      />,
    );
    const slider = screen.getByRole("slider");
    fireEvent.change(slider, { target: { value: "1.0" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    const cropData = onSave.mock.calls[0][0];
    // minScale for 600x1200 = (1024/600) / (600/1200) = ~3.41
    // Must be clamped to at least minScale, not just >= 1.0
    const expectedMinScale = (1024 / 600) / (600 / 1200);
    expect(cropData.crop_scale).toBeCloseTo(expectedMinScale, 1);
  });

  it("shows 'Saving...' and disables Save button when saving is true", () => {
    render(<CropEditor {...defaultProps} saving={true} />);
    const saveBtn = screen.getByRole("button", { name: /saving/i });
    expect(saveBtn).toBeDisabled();
  });

  it("computes correct minScale for wide images", () => {
    const onSave = vi.fn();
    // 2000x800: aspect=2.5 > 1.707 → minScale=1.0
    render(
      <CropEditor
        {...defaultProps}
        imageWidth={2000}
        imageHeight={800}
        onSave={onSave}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    const cropData = onSave.mock.calls[0][0];
    expect(cropData.crop_scale).toBeCloseTo(1.0, 1);
  });

  it("computes correct minScale for tall images", () => {
    const onSave = vi.fn();
    // 800x1200: aspect=0.667, minScale = 1.707/0.667 = ~2.56
    render(
      <CropEditor
        {...defaultProps}
        imageWidth={800}
        imageHeight={1200}
        onSave={onSave}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    const cropData = onSave.mock.calls[0][0];
    expect(cropData.crop_scale).toBeCloseTo(1024 / 600 / (800 / 1200), 1);
  });

  it("clamps crop position when zoomed to prevent empty space", () => {
    const onSave = vi.fn();
    // Wide image at minScale=1.0, crop should be centered
    render(
      <CropEditor
        {...defaultProps}
        imageWidth={2000}
        imageHeight={800}
        initialCrop={{ crop_x: 0.0, crop_y: 0.0, crop_scale: 1.0 }}
        onSave={onSave}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    const cropData = onSave.mock.calls[0][0];
    // Position should be clamped so crop rect doesn't go outside image
    expect(cropData.crop_x).toBeGreaterThan(0);
    expect(cropData.crop_y).toBeGreaterThanOrEqual(0.5); // height fills exactly at scale 1
  });
});
