# Continuous phase-light candidate

Refs #87 and the #88 integration acceptance work. This candidate is for visual review before production integration.

## Fixed baseline and scope

The baseline is #88 commit `42f758378e0d2b47bc65922ac105f0907f5a62f1`. Only `PulseRing.tsx` and a new component-scoped `PulseRing.css` change. Timeline, #67 sentence/text motion, settings, types, capture logic and compact-label/source geometry remain unchanged. The component retains the 18px compact and 40px expanded boxes and the existing independently resolved `motionEnabled` prop.

## Candidate behavior

Seven persistent CSS animation instances keep their identities through working phase changes. Connection uses a quiet arc, listening a small halo, recognition the existing ripple idea, and translation opposing arcs. The layers crossfade over 480ms rather than remounting or switching animation names.

On pause, error or idle, outer layers fade and contract; after 520ms their clocks pause. Resume continues those same clocks. Reduced motion and the explicit off preference are immediate, without the settling delay. Paused bars, an error diamond and a subdued idle dot stay distinguishable without movement. All inputs are existing session phases; none of these effects measures audio or progress.

## Actual component evidence

Both comparison rows use the exact baseline Timeline, fonts and styles, with identical synthetic bilingual sentences. The reference indicator is copied from that baseline; the second row uses this candidate. This is a browser component comparison, not an installed/native window or real audio response.

- HD still: `phase-continuity-hd.png`, Library `libfile_c77515e1aa008191934452d9d25b5418`.
- Actual recorded video: `phase-continuity.mp4`, Library `libfile_1346bfb70d4481919b7721e273b47c20`.
- 1440 x 1032, 20.445 seconds. 1016 original browser screencast frames, with source timestamps and variable frame timing. First-to-last changing-frame span is 17.556 seconds (57.814 fps average); static gaps and the final 2.887-second hold are preserved. Two late-delivered frame events are ordered by their original timestamps. No interpolation, generated motion or playback-speed change.
- Sequence: connecting, listening, recognizing, translating, paused, recognition resume, error, idle. Expanded and 18px compact indicators run together.
- The encoded video was actually played and inspected at recognition, pause and resume. Seven CSSAnimation instances remained identical through active phase changes. After waiting for animation readiness, all seven paused clocks stayed unchanged over 450ms, then resumed using the same instances.
- Explicit motion off and emulated system reduced-motion each yielded zero running animations. Typecheck and component lint passed; diff whitespace check passed.

The full Rust/native build, signed WebKit overlay and real provider/audio acceptance were not run. No final visual approval is implied. The integration coordinator owns publication of inline #88 materials and conditional inclusion after the parent reviews this video.

## Local preview lifecycle

The isolated preview URL was `http://127.0.0.1:5195/phase-preview.html`. Its single Vite process and its own Ego task space were closed after capture. The untracked fixture remains available in this worktree; restart only in a coordinated serial window with `node_modules/.bin/vite --config phase-vite.config.mjs --configLoader runner`, then stop that server after review. Do not add the fixture, dependency symlink, captured media or generated cache to the application commit.
