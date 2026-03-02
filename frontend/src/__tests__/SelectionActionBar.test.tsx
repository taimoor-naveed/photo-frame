import { render, screen, fireEvent } from "@testing-library/react";
import SelectionActionBar from "../components/SelectionActionBar";

const defaultProps = {
  selectedCount: 3,
  totalCount: 5,
  onCancel: vi.fn(),
  onSelectAll: vi.fn(),
  onDeselectAll: vi.fn(),
  onDelete: vi.fn(),
};

beforeEach(() => {
  vi.restoreAllMocks();
  defaultProps.onCancel = vi.fn();
  defaultProps.onSelectAll = vi.fn();
  defaultProps.onDeselectAll = vi.fn();
  defaultProps.onDelete = vi.fn();
});

describe("SelectionActionBar", () => {
  it("displays correct selected count", () => {
    render(<SelectionActionBar {...defaultProps} selectedCount={5} />);
    expect(screen.getByText("5 items selected")).toBeInTheDocument();
  });

  it("delete button opens confirm dialog with count in message", () => {
    render(<SelectionActionBar {...defaultProps} />);
    fireEvent.click(screen.getByTestId("selection-delete"));
    expect(screen.getByText("Delete 3 items? This cannot be undone.")).toBeInTheDocument();
  });

  it("confirm delete calls onDelete", () => {
    render(<SelectionActionBar {...defaultProps} />);
    fireEvent.click(screen.getByTestId("selection-delete"));
    // Click the confirm button in the dialog (last Delete button)
    const deleteButtons = screen.getAllByRole("button", { name: "Delete" });
    fireEvent.click(deleteButtons[deleteButtons.length - 1]);
    expect(defaultProps.onDelete).toHaveBeenCalledOnce();
  });

  it("cancel confirm dialog does not delete", () => {
    render(<SelectionActionBar {...defaultProps} />);
    fireEvent.click(screen.getByTestId("selection-delete"));
    const cancelButtons = screen.getAllByRole("button", { name: "Cancel" });
    fireEvent.click(cancelButtons[cancelButtons.length - 1]);
    expect(defaultProps.onDelete).not.toHaveBeenCalled();
  });

  it("shows 'Select all' button and calls onSelectAll when not all selected", () => {
    render(<SelectionActionBar {...defaultProps} selectedCount={2} totalCount={5} />);
    const btn = screen.getByTestId("selection-select-all");
    expect(btn).toHaveTextContent("Select all");
    fireEvent.click(btn);
    expect(defaultProps.onSelectAll).toHaveBeenCalledOnce();
  });

  it("shows 'Deselect all' button and calls onDeselectAll when all selected", () => {
    render(<SelectionActionBar {...defaultProps} selectedCount={5} totalCount={5} />);
    const btn = screen.getByTestId("selection-select-all");
    expect(btn).toHaveTextContent("Deselect all");
    fireEvent.click(btn);
    expect(defaultProps.onDeselectAll).toHaveBeenCalledOnce();
  });

  it("cancel button calls onCancel", () => {
    render(<SelectionActionBar {...defaultProps} />);
    fireEvent.click(screen.getByTestId("selection-cancel"));
    expect(defaultProps.onCancel).toHaveBeenCalledOnce();
  });

  it("delete button disabled when selectedCount is 0", () => {
    render(<SelectionActionBar {...defaultProps} selectedCount={0} />);
    expect(screen.getByTestId("selection-delete")).toBeDisabled();
  });

  it("confirm message uses singular for 1 item", () => {
    render(<SelectionActionBar {...defaultProps} selectedCount={1} />);
    expect(screen.getByText("1 item selected")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("selection-delete"));
    expect(screen.getByText("Delete 1 item? This cannot be undone.")).toBeInTheDocument();
  });
});
