import { Icon } from "./Icon";
import { I18N } from "../lib/i18n";
import "./session-error-feedback.css";

interface SessionErrorFeedbackProps {
  /** A safe, localized message from the session error selector. */
  message: string;
  onConfigure: () => void;
  onRetry?: () => void;
  disabled?: boolean;
}

/** Ongoing failures stay readable beside their recovery actions. */
export function SessionErrorFeedback({ message, onConfigure, onRetry, disabled = false }: SessionErrorFeedbackProps) {
  return <div className="session-error-feedback" role="alert">
    <p className="session-error-feedback__message">{message}</p>
    <div className="session-error-feedback__actions">
      <button type="button" className="session-error-feedback__action" disabled={disabled} onClick={onConfigure}>
        <Icon name="gear" />{I18N.settings.openSpeechSettings}
      </button>
      {onRetry && <button type="button" className="session-error-feedback__action" disabled={disabled} onClick={onRetry}>
        <Icon name="play" />{I18N.settings.sessionRetry}
      </button>}
    </div>
  </div>;
}
