/** Keep the latest subtitle visible when existing rows rewrap, even if no
 * subtitle event arrives. Native window dimensions can change independently. */
export function observeTimelineResize(element: HTMLElement): () => void {
  const observer = new ResizeObserver(() => {
    element.scrollTo({ top: element.scrollHeight, behavior: "instant" });
  });
  observer.observe(element);
  return () => observer.disconnect();
}
