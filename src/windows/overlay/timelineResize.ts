/** Keep the latest subtitle visible when existing rows rewrap, even if no
 * subtitle event arrives. Native window dimensions can change independently. */
export function observeTimelineResize(element: HTMLElement, onResize = () => {
  element.scrollTo({ top: element.scrollHeight, behavior: "instant" });
}): () => void {
  const observer = new ResizeObserver(() => {
    onResize();
  });
  observer.observe(element);
  return () => observer.disconnect();
}
