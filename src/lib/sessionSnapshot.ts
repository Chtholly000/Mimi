import type { SessionStateEvent } from "./types";

/** IPC decodes a new array on every draft. Keep confirmed display history's
 * identity while every bounded item is unchanged, without retaining an older
 * draft, timing sample or lifecycle field. */
export function shareUnchangedSubtitleHistory(
  previous: SessionStateEvent,
  incoming: SessionStateEvent,
): SessionStateEvent {
  const before = previous.subtitles.history;
  const after = incoming.subtitles.history;
  if (before === after || before.length !== after.length) return incoming;
  for (let index = 0; index < after.length; index++) {
    if (before[index].createdAt !== after[index].createdAt ||
        before[index].source !== after[index].source ||
        before[index].translation !== after[index].translation) return incoming;
  }
  return {
    ...incoming,
    subtitles: { ...incoming.subtitles, history: before },
  };
}
