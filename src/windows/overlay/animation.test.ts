import { describe, expect, it } from "vitest";
import { resolveMotion, textUnits, unitSpans } from "./animation";
import { OVERLAY_ACTIVITY_PHASES } from "../../lib/types";

describe("resolveMotion", () => {
  it("lets an explicit choice override the system preference", () => {
    expect(resolveMotion(true, true)).toBe(true);
    expect(resolveMotion(false, false)).toBe(false);
  });

  it("follows the system preference until the user chooses", () => {
    expect(resolveMotion(null, true)).toBe(false);
    expect(resolveMotion(null, false)).toBe(true);
  });
});

describe("activity phases that animate", () => {
  it("only the working phases are active, so a paused session is still", () => {
    const active = Object.entries(OVERLAY_ACTIVITY_PHASES)
      .filter(([, info]) => info.animationSpeed > 0)
      .map(([phase]) => phase)
      .sort();
    expect(active).toEqual(["connecting", "listening", "recognizing", "translating"]);
  });
});

describe("textUnits", () => {
  it("always rejoins into the original text", () => {
    for (const text of ["It is not attached.", "我们先用剃刀清理", "a  b\u00a0c"]) {
      expect(textUnits(text).join("")).toBe(text);
    }
  });

  it("keeps a unit's offset stable as the text grows", () => {
    const before = unitSpans("It is not attached");
    const after = unitSpans("It is not attached to the bone");
    const kept = after.filter((unit) => unit.start < "It is not attached".length);
    expect(kept.map((unit) => unit.text).join("")).toBe("It is not attached");
    expect(kept.map((unit) => unit.start)).toEqual(
      before.map((unit) => unit.start).slice(0, kept.length),
    );
  });
});
