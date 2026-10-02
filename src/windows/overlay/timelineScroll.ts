/** Owns follow/read intent and sentence anchors; never changes subtitle text. */
export class TimelineScroll {
  private following = true;
  private userScrolling: { top: number; direction: "down" | "pointer" } | null = null;
  private modeAnchor = false;
  private reading: { id: string; offset: number } | null = null;

  userIntent(element: HTMLElement, direction: "down" | "pointer" = "pointer") {
    this.userScrolling = { top: element.scrollTop, direction };
    this.rememberReading(element);
  }

  endUserIntent() {
    this.userScrolling = null;
  }

  /** Enter full confirmed-history reading even if the compact rows do not
   * overflow yet, so an upward wheel/key can reveal a single long sentence. */
  beginReading(element: HTMLElement) {
    this.endUserIntent();
    this.following = false;
    this.rememberReading(element);
  }

  isFollowing(): boolean {
    return this.following;
  }

  followTail(element: HTMLElement) {
    this.following = true;
    this.modeAnchor = false;
    this.reading = null;
    this.move(element, element.scrollHeight, "instant");
  }

  /** Called only by a new downward gesture; short text may emit no scroll. */
  followIfAtTail(element: HTMLElement) {
    if (this.atTail(element)) this.followTail(element);
  }

  scrolled(element: HTMLElement) {
    const intent = this.userScrolling;
    this.endUserIntent();
    if (intent) {
      const downward = element.scrollTop > intent.top ||
        (intent.direction === "down" && element.scrollTop === intent.top);
      if (this.atTail(element) && downward) this.following = true;
      else if (!this.atTail(element)) this.following = false;
    }
    // Native layout/anchor corrections may emit scroll without user input.
    // Keep the actual visible anchor, but never use them to leave reading.
    if (!this.following) this.rememberReading(element);
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
    this.endUserIntent();
    if (!this.reading) return;
    const block = Array.from(element.children).find(child => (child as HTMLElement).dataset.utteranceId === this.reading!.id) as HTMLElement | undefined;
    // A bounded history may evict the old sentence; preserve the current
    // reading position rather than jumping to the newest sentence in that case.
    if (block) {
      // Removing an original lane can make a sentence shorter than the
      // former reading offset. Reveal that same sentence's start rather than
      // leaving it entirely above the viewport and showing its successor.
      const rect = block.getBoundingClientRect();
      const offset = -this.reading.offset >= rect.bottom - rect.top ? 0 : this.reading.offset;
      this.reading.offset = offset;
      this.move(element, this.top(element, block) - offset, "instant");
    }
  }

  private top(element: HTMLElement, child: HTMLElement) {
    return element.scrollTop + child.getBoundingClientRect().top - element.getBoundingClientRect().top;
  }

  private move(element: HTMLElement, top: number, behavior: ScrollBehavior) {
    this.endUserIntent();
    element.scrollTo({ top: Math.max(0, Math.min(top, element.scrollHeight - element.clientHeight)), behavior });
  }

  private atTail(element: HTMLElement): boolean {
    return element.scrollHeight - element.clientHeight - element.scrollTop <= 2;
  }
}
