import { expect, it } from "vitest";
import { capturePresentation, type CaptureStatus } from "./captureStatus";

it("keeps actual device separate from selection strategy and never diagnoses the cause", () => {
  const value: CaptureStatus = { kind: "windows_output", strategy: "follow_system", actualDeviceName: "Headphones", observation: { pcmDataRecent: false, soundRecent: false } };
  const view = capturePresentation(value, true, false, "zh");
  expect(view.source).toBe("跟随系统");
  expect(view.device).toBe("Headphones");
  expect(view.observation).toContain("暂未采到数据");
  expect(view.observation).not.toContain("选错");
});

it("distinguishes silence, signal, unknown and pause across languages", () => {
  for (const language of ["en", "zh", "ja"] as const) {
    const value: CaptureStatus = { kind: "linux_output_monitor", strategy: "platform_capture", actualDeviceName: null, observation: { pcmDataRecent: true, soundRecent: false } };
    const silent = capturePresentation(value, true, false, language);
    expect(silent.source).not.toBe(capturePresentation({ ...value, kind: "windows_output", strategy: "follow_system" }, true, false, language).source);
    expect(silent.observation).not.toBe(capturePresentation({ ...value, observation: { pcmDataRecent: true, soundRecent: true } }, true, false, language).observation);
    expect(silent.observation).not.toBe(capturePresentation(null, true, false, language).observation);
    expect(capturePresentation(value, true, true, language).observation).not.toBe(silent.observation);
  }
});
