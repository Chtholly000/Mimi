const STATUSES = ["idle", "connecting", "stopping", "listening", "paused", "error"] as const;
const FAILURE_CATEGORIES = ["unknown", "authentication", "credential_storage", "device_unavailable", "timeout", "request_rejected", "service_error", "rate_limit", "backlog", "transport", "stopped", "processing", "size_limit"] as const;
const LIFECYCLE_ACTIONS = ["start_requested", "start_busy", "start_already_active", "start_superseded", "stop_requested", "pause_requested", "resume_requested"] as const;
const RECOVERY_ACTIONS = ["retrying", "recovered", "retries_exhausted", "user_stopped"] as const;
export type DiagnosticStatus = (typeof STATUSES)[number];
export type DiagnosticFailureCategory = (typeof FAILURE_CATEGORIES)[number];
export type DiagnosticLifecycleAction = (typeof LIFECYCLE_ACTIONS)[number];
export type DiagnosticRecoveryAction = (typeof RECOVERY_ACTIONS)[number];

type EventFacts =
  | { kind: "status"; status: DiagnosticStatus }
  | { kind: "lifecycle"; action: DiagnosticLifecycleAction }
  | { kind: "failure"; category: DiagnosticFailureCategory }
  | { kind: "recovery"; action: DiagnosticRecoveryAction }
  | { kind: "translation_backoff"; reason: "rateLimited" | "temporarilyUnavailable"; retryScheduled: boolean };
export type DiagnosticSummaryEvent = EventFacts & { sequence: number; elapsedMs: number };
export interface SupportDiagnosticSummary {
  status: DiagnosticStatus;
  apiLatencyMs: number | null;
  translationLatencyMs: number | null;
  translationLatencyKind: "request" | "follow" | null;
  lastError: DiagnosticFailureCategory | null;
  recentEvents: DiagnosticSummaryEvent[];
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function enumeration<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === "string" && allowed.includes(value as T) ? value as T : null;
}
function nonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
function failureCategory(value: unknown): DiagnosticFailureCategory | null {
  return enumeration(object(value)?.category, FAILURE_CATEGORIES);
}
function summaryEvent(value: unknown): DiagnosticSummaryEvent | null {
  const event = object(value);
  if (!event) return null;
  const sequence = nonNegativeInteger(event.sequence), elapsedMs = nonNegativeInteger(event.elapsed_since_app_start_ms);
  if (sequence === null || elapsedMs === null) return null;
  const timing = { sequence, elapsedMs };
  switch (event.kind) {
    case "status": {
      const status = enumeration(event.status, STATUSES);
      return status ? { ...timing, kind: "status", status } : null;
    }
    case "lifecycle": {
      const action = enumeration(event.action, LIFECYCLE_ACTIONS);
      return action ? { ...timing, kind: "lifecycle", action } : null;
    }
    case "failure": {
      const category = failureCategory(event.classification);
      return category ? { ...timing, kind: "failure", category } : null;
    }
    case "recovery": {
      const action = enumeration(event.action, RECOVERY_ACTIONS);
      return action ? { ...timing, kind: "recovery", action } : null;
    }
    case "translation_backoff": {
      const recovery = object(event.recovery);
      const reason = enumeration(recovery?.reason, ["rateLimited", "temporarilyUnavailable"] as const);
      return reason && typeof recovery?.retryScheduled === "boolean"
        ? { ...timing, kind: "translation_backoff", reason, retryScheduled: recovery.retryScheduled } : null;
    }
    default: return null;
  }
}

/** Presentation reads only typed, bounded facts; arbitrary report strings stay out of the summary. */
export function supportDiagnosticSummary(report: string | null): SupportDiagnosticSummary | null {
  if (report === null) return null;
  try {
    const data = object(JSON.parse(report));
    if (data?.schema !== "mimi.support.v2") return null;
    const status = enumeration(data.session_status, STATUSES);
    if (!status) return null;
    const service = object(data.service);
    const translationLatencyKind = enumeration(service?.translation_duration_kind, ["request", "follow"] as const);
    const events = object(data.journal)?.recent_events;
    return {
      status,
      apiLatencyMs: nonNegativeInteger(service?.api_round_trip_ms),
      translationLatencyMs: translationLatencyKind ? nonNegativeInteger(service?.translation_duration_ms) : null,
      translationLatencyKind,
      lastError: failureCategory(object(data.last_error)?.classification),
      recentEvents: Array.isArray(events) ? events.slice(-6).map(summaryEvent).filter((event): event is DiagnosticSummaryEvent => event !== null) : [],
    };
  } catch { return null; }
}
