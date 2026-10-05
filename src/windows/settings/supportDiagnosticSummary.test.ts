import { expect, it } from "vitest";
import { supportDiagnosticSummary } from "./supportDiagnosticSummary";

const report = (changes: Record<string, unknown> = {}) => JSON.stringify({
  schema: "mimi.support.v2", session_status: "listening",
  service: { api_round_trip_ms: 0, translation_duration_ms: 125, translation_duration_kind: "follow" },
  last_error: { classification: { category: "rate_limit", phase: "text_translation", code: "TRANSLATION_RATE_LIMITED" } },
  journal: { recent_events: [] }, ...changes,
});

it("keeps zero measurements distinct from missing data and preserves the translation measurement kind", () => {
  expect(supportDiagnosticSummary(report())).toEqual({ status: "listening", apiLatencyMs: 0, translationLatencyMs: 125, translationLatencyKind: "follow", lastError: "rate_limit", recentEvents: [] });
  expect(supportDiagnosticSummary(report({ service: { api_round_trip_ms: null, translation_duration_ms: 125, translation_duration_kind: "unrecognized" } }))?.translationLatencyMs).toBeNull();
});

it("ignores unsafe numbers and unknown report/status formats while leaving raw reports available to the caller", () => {
  expect(supportDiagnosticSummary("not-json")).toBeNull();
  expect(supportDiagnosticSummary(report({ schema: "mimi.support.future" }))).toBeNull();
  expect(supportDiagnosticSummary(report({ session_status: "raw provider failure" }))).toBeNull();
  for (const value of [-1, 0.5, "400", Number.MAX_SAFE_INTEGER + 1]) {
    expect(supportDiagnosticSummary(report({ service: { api_round_trip_ms: value, translation_duration_ms: value, translation_duration_kind: "request" } }))?.apiLatencyMs).toBeNull();
    expect(supportDiagnosticSummary(report({ service: { api_round_trip_ms: value, translation_duration_ms: value, translation_duration_kind: "request" } }))?.translationLatencyMs).toBeNull();
  }
});

it("shows only six recent typed events and never carries arbitrary strings into human-readable diagnostics", () => {
  const events = Array.from({ length: 12 }, (_, index) => ({ sequence: index, elapsed_since_app_start_ms: index * 100, kind: "status", status: "listening", ignored_raw_field: "private-path-or-text" }));
  const result = supportDiagnosticSummary(report({ journal: { recent_events: events }, last_error: { classification: { category: "private-error-text", code: "private-key" } } }))!;
  expect(result.recentEvents).toHaveLength(6);
  expect(result.recentEvents.map((event) => event.sequence)).toEqual([6, 7, 8, 9, 10, 11]);
  expect(result.lastError).toBeNull();
  expect(JSON.stringify(result)).not.toContain("private");
});

it("accepts lifecycle, recovery and failure facts but does not claim a retry without a typed scheduled retry", () => {
  const timing = { sequence: 1, elapsed_since_app_start_ms: 0 };
  const events = [
    { ...timing, kind: "lifecycle", action: "resume_requested" },
    { ...timing, kind: "recovery", action: "recovered" },
    { ...timing, kind: "failure", classification: { category: "authentication" } },
    { ...timing, kind: "translation_backoff", recovery: { reason: "rateLimited", retryScheduled: false } },
    { ...timing, kind: "translation_backoff", recovery: { reason: "temporarilyUnavailable", retryScheduled: true } },
    { ...timing, kind: "translation_backoff", recovery: { reason: "rateLimited" } },
  ];
  expect(supportDiagnosticSummary(report({ journal: { recent_events: events } }))?.recentEvents).toEqual([
    { sequence: 1, elapsedMs: 0, kind: "lifecycle", action: "resume_requested" },
    { sequence: 1, elapsedMs: 0, kind: "recovery", action: "recovered" },
    { sequence: 1, elapsedMs: 0, kind: "failure", category: "authentication" },
    { sequence: 1, elapsedMs: 0, kind: "translation_backoff", reason: "rateLimited", retryScheduled: false },
    { sequence: 1, elapsedMs: 0, kind: "translation_backoff", reason: "temporarilyUnavailable", retryScheduled: true },
  ]);
});

it("keeps unsupported language as a safe configuration failure", () => {
  expect(supportDiagnosticSummary(report({ last_error: { classification: { category: "configuration", code: "UNSUPPORTED_LANGUAGE" } } }))?.lastError).toBe("configuration");
});
