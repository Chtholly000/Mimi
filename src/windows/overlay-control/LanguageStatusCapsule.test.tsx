// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useStore } from "../../lib/store";
import { LanguageStatusCapsule } from "./LanguageStatusCapsule";

it("keeps the compact control indicator in sync with the selected subtitle pulse style", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    for (const pulseStyle of ["classic", "syllable", "ribbon", "classic"] as const) {
      for (const expanded of [false, true]) {
        await act(async () => root.render(<LanguageStatusCapsule
          phase="listening"
          status={{ source: "Japanese", separator: "→", target: "Chinese" }}
          settings={{ ...useStore.getState().settings, pulseStyle, pulseAnimation: false }}
          effectiveMode="lowLatency"
          isPaused={false}
          isWaitingForFinalTranslation={false}
          expanded={expanded}
          onToggle={() => {}}
        />));
        const indicator = host.querySelector<HTMLElement>("[data-pulse-style]")!;
        expect(indicator.dataset.pulseStyle).toBe(pulseStyle);
        expect(indicator.dataset.clock).toBe("paused");
        expect(indicator.style.width).toBe("18px");
      }
    }
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
