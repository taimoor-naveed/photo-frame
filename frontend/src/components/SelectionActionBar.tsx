import { useState } from "react";
import ConfirmDialog from "./ConfirmDialog";

interface SelectionActionBarProps {
  selectedCount: number;
  totalCount: number;
  onCancel: () => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onDelete: () => void;
}

export default function SelectionActionBar({
  selectedCount,
  totalCount,
  onCancel,
  onSelectAll,
  onDeselectAll,
  onDelete,
}: SelectionActionBarProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const allSelected = totalCount > 0 && selectedCount === totalCount;

  return (
    <>
      <div className="fixed bottom-0 inset-x-0 z-40 px-4 pb-4 sm:pb-6 pointer-events-none">
        <div
          data-testid="selection-action-bar"
          className="pointer-events-auto mx-auto max-w-lg w-full rounded-2xl bg-white/80 backdrop-blur-xl border border-gray-200/60 shadow-lg px-4 py-3 flex items-center justify-between gap-3"
        >
          {/* Left: Cancel */}
          <button
            data-testid="selection-cancel"
            onClick={onCancel}
            className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors shrink-0"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
            Cancel
          </button>

          {/* Center: Count + Select all */}
          <div className="flex flex-col items-center min-w-0">
            <span className="text-sm font-semibold text-gray-900 whitespace-nowrap">
              {selectedCount} {selectedCount === 1 ? "item" : "items"} selected
            </span>
            <button
              data-testid="selection-select-all"
              onClick={() => (allSelected ? onDeselectAll() : onSelectAll())}
              className="text-xs font-medium text-blue-600 hover:text-blue-800 transition-colors whitespace-nowrap"
            >
              {allSelected ? "Deselect all" : "Select all"}
            </button>
          </div>

          {/* Right: Delete */}
          <button
            data-testid="selection-delete"
            onClick={() => setConfirmOpen(true)}
            disabled={selectedCount === 0}
            className="flex items-center gap-1.5 rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-red-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            Delete
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Delete media"
        message={`Delete ${selectedCount} ${selectedCount === 1 ? "item" : "items"}? This cannot be undone.`}
        onConfirm={() => {
          setConfirmOpen(false);
          onDelete();
        }}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}
