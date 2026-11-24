/** One observer per large diff pane. Entries are delivered only when a section
 * crosses the preload margin, without reading 600 bounding rects at mount. */
export class SectionViewport {
  private readonly listeners = new Map<Element, (near: boolean) => void>();
  private observer: IntersectionObserver | null = null;

  observe(section: HTMLElement, root: HTMLElement, notify: (near: boolean) => void) {
    this.observer ??= new IntersectionObserver(
      (entries) => {
        for (const entry of entries) this.listeners.get(entry.target)?.(entry.isIntersecting);
      },
      { root, rootMargin: "800px 0px" },
    );
    this.listeners.set(section, notify);
    this.observer.observe(section);
    return () => {
      this.observer?.unobserve(section);
      this.listeners.delete(section);
      if (!this.listeners.size) {
        this.observer?.disconnect();
        this.observer = null;
      }
    };
  }
}
