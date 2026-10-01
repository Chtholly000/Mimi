/** Owns scrolling only; sentence geometry, lane budgets and motion stay intact. */
export class TimelineScroll {
  private following = true;
  private userScrolling = false;
  private modeAnchor = false;
  private reading: { id: string; offset: number } | null = null;

  userIntent(element: HTMLElement) {
    this.userScrolling = true;
    this.rememberReading(element);
  }

  scrolled(element: HTMLElement) {
    if (!this.userScrolling) return; // Ignore our instant and smooth scroll events.
    this.following = element.scrollHeight - element.clientHeight - element.scrollTop <= 2;
    this.rememberReading(element);
  }

  displayChanged(element: HTMLElement) {
    this.modeAnchor = true;
    this.reflow(element);
  }

  contentChanged(element: HTMLElement, behavior: ScrollBehavior) {
    this.modeAnchor = false;
    if (this.following) this.move(element, element.scrollHeight, behavior);
    else this.restoreReading(element);
  }

  reflow(element: HTMLElement) {
    if (!this.following) {
      this.restoreReading(element);
      return;
    }
    // A compact bilingual lane reserves blank space as well as actual text.
    // Start at the newest sentence after a mode change so its original is
    // visible; bottom-pinning can hide that original behind the reserved space.
    const latest = element.lastElementChild as HTMLElement | null;
    const top = this.modeAnchor && latest ? this.top(element, latest) : element.scrollHeight;
    this.move(element, top, "instant");
  }

  private rememberReading(element: HTMLElement) {
    const top = element.getBoundingClientRect().top;
    const first = Array.from(element.children).find(child => child.getBoundingClientRect().bottom > top);
    const id = (first as HTMLElement | undefined)?.dataset.utteranceId;
    this.reading = first && id ? { id, offset: first.getBoundingClientRect().top - top } : null;
  }

  private restoreReading(element: HTMLElement) {
    if (!this.reading) return;
    const block = Array.from(element.children).find(child => (child as HTMLElement).dataset.utteranceId === this.reading!.id) as HTMLElement | undefined;
    // A bounded history may evict the old sentence; preserve the current
    // reading position rather than jumping to the newest sentence in that case.
    if (block) {
      this.move(element, this.top(element, block) - this.reading.offset, "instant");
      this.userScrolling = true;
    }
  }

  private top(element: HTMLElement, child: HTMLElement) {
    return element.scrollTop + child.getBoundingClientRect().top - element.getBoundingClientRect().top;
  }

  private move(element: HTMLElement, top: number, behavior: ScrollBehavior) {
    this.userScrolling = false;
    element.scrollTo({ top: Math.max(0, Math.min(top, element.scrollHeight - element.clientHeight)), behavior });
  }
}
