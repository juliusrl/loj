import React from 'react';

export interface ConfirmDialogProps {
  open: boolean;
  message: string;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

export function ConfirmDialog({ open, message, onConfirm, onCancel }: ConfirmDialogProps) {
  if (!open) return null;

  return (
    <div className="rdsl-dialog-backdrop" role="presentation">
      <div className="rdsl-dialog" role="dialog" aria-modal="true" aria-label="Confirmation dialog">
        <p>{message}</p>
        <div className="rdsl-dialog-actions">
          <button type="button" className="rdsl-btn rdsl-btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="rdsl-btn rdsl-btn-danger" onClick={() => void onConfirm()}>
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}
