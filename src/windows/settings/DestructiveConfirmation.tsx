import { useEffect, useRef } from "react";
import { Icon } from "../../components/Icon";
import { I18N } from "../../lib/i18n";

export function DestructiveConfirmation({
  message,
  disabled,
  onCancel,
  onConfirm,
}: {
  message: string;
  disabled: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const confirmationRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const confirmation = confirmationRef.current;
    if (!confirmation) return;
    confirmation.focus({ preventScroll: true });
    confirmation.scrollIntoView({ block: "nearest" });
  }, []);

  return (
    <div ref={confirmationRef} className="destructive-confirmation" role="alert" tabIndex={-1}>
      <small>{message}</small>
      <span className="destructive-confirmation__actions">
        <button type="button" className="settings-link" disabled={disabled} onClick={onCancel}>
          {I18N.settings.cancel}
        </button>
        <button
          type="button"
          className="settings-button settings-button--danger settings-button--compact"
          disabled={disabled}
          onClick={onConfirm}
        >
          <Icon name="trash" />
          {I18N.settings.confirmDelete}
        </button>
      </span>
    </div>
  );
}
