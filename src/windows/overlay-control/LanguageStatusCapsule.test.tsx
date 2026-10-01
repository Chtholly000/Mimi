// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useStore } from "../../lib/store";
import { LanguageStatusCapsule } from "./LanguageStatusCapsule";

it.each([
  { label: "explicit off", reduced: false, pulseAnimation: false },
  { label: "inherited reduced motion", reduced: true, pulseAnimation: null },
  { label: "explicit on with reduced motion", reduced: true, pulseAnimation: true },
])("keeps the readable compact indicator in sync with all styles and $label", async ({ reduced, pulseAnimation }) => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({ matches: reduced, addEventListener() {}, removeEventListener() {} }));
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    for (const pulseStyle of ["syllable", "ribbon", "syllable"] as const) {
      for (const expanded of [false, true]) {
        await act(async () => root.render(<LanguageStatusCapsule
          phase="listening"
          status={{ source: "Japanese", separator: "→", target: "Chinese" }}
          settings={{ ...useStore.getState().settings, pulseStyle, pulseAnimation }}
          effectiveMode="lowLatency"
          isPaused={false}
          isWaitingForFinalTranslation={false}
          expanded={expanded}
          onToggle={() => {}}
        />));
        const indicator = host.querySelector<HTMLElement>("[data-pulse-style]")!;
        expect(indicator.dataset.pulseStyle).toBe(pulseStyle);
        expect(indicator.dataset.clock).toBe((pulseAnimation ?? !reduced) ? "running" : "paused");
        expect(indicator.style.width).toBe("24px");
      }
    }
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
