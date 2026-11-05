import type { ManagedSocialUpload, SocialClient } from "./socialClient";

/** A claim belongs to this editor instance, never to the latest rendered selection. */
export class SocialMediaEditor {
  readonly editorId = crypto.randomUUID();
  private readonly claims = new Map<string, number>();
  private closed = false;
  private epoch = 0;
  private sourceVersion = 0;
  private readonly pending = new Map<string, Promise<void>>();
  private readonly releases = new Map<string, Promise<void>>();
  private discarding?: Promise<void>;
  constructor(private readonly client: Pick<SocialClient, "mediaClaim" | "mediaInspect">) {}

  async adoptUpload(upload: ManagedSocialUpload): Promise<ManagedSocialUpload> {
    const managed = upload.managed;
    if (!managed || this.closed) return upload;
    await this.discarding;
    if (this.closed) return upload;
    const pending = (async () => {
      const receipt = await this.client.mediaClaim("transfer", {
        mediaId: managed.mediaId,
        editorId: this.editorId,
        expectedRevision: managed.revision,
        requestId: crypto.randomUUID(),
      });
      this.claims.set(managed.mediaId, receipt.revision);
    })();
    this.pending.set(managed.mediaId, pending);
    try {
      await pending;
    } finally {
      if (this.pending.get(managed.mediaId) === pending) this.pending.delete(managed.mediaId);
    }
    return upload;
  }

  async claim(mediaId: string, expectedRevision: number): Promise<void> {
    if (this.closed) throw new Error("Social media editor is closed.");
    const receipt = await this.client.mediaClaim("claim", {
      mediaId,
      editorId: this.editorId,
      expectedRevision,
      requestId: crypto.randomUUID(),
    });
    this.claims.set(mediaId, receipt.revision);
  }

  async claimExisting(mediaId: string): Promise<void> {
    if (this.discarding) await this.discarding;
    const releasing = this.releases.get(mediaId);
    if (releasing) await releasing;
    if (this.claims.has(mediaId)) return;
    const existing = this.pending.get(mediaId);
    if (existing) return existing;
    const pending = (async () => {
      const identity = await this.client.mediaInspect(mediaId);
      if (this.closed) throw new Error("Social media editor is closed.");
      if (identity.managed) await this.claim(mediaId, identity.revision);
    })();
    this.pending.set(mediaId, pending);
    try {
      await pending;
    } finally {
      if (this.pending.get(mediaId) === pending) this.pending.delete(mediaId);
    }
  }

  async release(mediaId: string): Promise<void> {
    const revision = this.claims.get(mediaId);
    if (revision === undefined) return;
    await this.client.mediaClaim("releaseLogical", {
      mediaId,
      editorId: this.editorId,
      expectedRevision: revision,
      requestId: crypto.randomUUID(),
    });
    if (this.claims.get(mediaId) === revision) this.claims.delete(mediaId);
  }

  async releaseCurrent(mediaId: string): Promise<void> {
    const current = this.releases.get(mediaId);
    if (current) return current;
    if (!this.claims.has(mediaId)) return;
    const operation = (async () => {
      const identity = await this.client.mediaInspect(mediaId);
      if (identity.managed && this.claims.has(mediaId)) {
        this.claims.set(mediaId, identity.revision);
        await this.release(mediaId);
      }
    })();
    this.releases.set(mediaId, operation);
    try {
      await operation;
    } finally {
      if (this.releases.get(mediaId) === operation) this.releases.delete(mediaId);
    }
  }

  async discard(): Promise<void> {
    if (this.discarding) return this.discarding;
    this.invalidate();
    const operation = (async () => {
      await Promise.allSettled([...this.pending.values(), ...this.releases.values()]);
      for (const mediaId of Array.from(this.claims.keys())) {
        try {
          const identity = await this.client.mediaInspect(mediaId);
          if (identity.managed) {
            this.claims.set(mediaId, identity.revision);
            await this.release(mediaId);
          }
        } catch {
          /* Preserve uncertain claims. */
        }
      }
    })();
    this.discarding = operation;
    try {
      await operation;
    } finally {
      if (this.discarding === operation) this.discarding = undefined;
    }
  }

  open(): void {
    this.closed = false;
    this.epoch++;
  }
  close(release = true): void {
    this.closed = true;
    const epoch = ++this.epoch;
    if (!release) return;
    void (async () => {
      await Promise.allSettled([...this.pending.values(), ...this.releases.values()]);
      for (const mediaId of this.claims.keys()) {
        if (!this.closed || this.epoch !== epoch) return;
        try {
          const identity = await this.client.mediaInspect(mediaId);
          if (!this.closed || this.epoch !== epoch) return;
          if (identity.managed) {
            this.claims.set(mediaId, identity.revision);
            await this.release(mediaId);
          }
        } catch {
          /* Retain unresolved claims for recovery. */
        }
      }
    })();
  }
  isClosed(): boolean {
    return this.closed;
  }
  invalidate(): void {
    this.sourceVersion++;
  }
  version(): number {
    return this.sourceVersion;
  }
}

export async function uploadForSocialEditor(
  editor: SocialMediaEditor,
  client: SocialClient,
  file: File,
  progress?: (percent: number) => void,
): Promise<ManagedSocialUpload> {
  editor.invalidate();
  const version = editor.version();
  const upload = file.type.startsWith("video/")
    ? await client.uploadVideo(file, progress)
    : await client.upload(file);
  if (editor.isClosed() || editor.version() !== version)
    throw new Error("Social media editor changed.");
  await editor.adoptUpload(upload);
  if (editor.isClosed() || editor.version() !== version)
    throw new Error("Social media editor changed.");
  return upload;
}

/** Collect only persisted upload references; external URLs remain untouched. */
export function socialMediaIds(value: unknown): string[] {
  const found = new Set<string>();
  const visit = (item: unknown): void => {
    if (!item || typeof item !== "object") return;
    if (Array.isArray(item)) {
      item.forEach(visit);
      return;
    }
    for (const [key, child] of Object.entries(item)) {
      if (key === "uploadId" && typeof child === "string" && /^[a-f0-9-]{36}$/.test(child))
        found.add(child);
      else visit(child);
    }
  };
  visit(value);
  return [...found];
}
