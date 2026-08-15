/**
 * Module-level live artifact registry for the browser half. One entry per
 * artifact id holds the LATEST html/revision any settled `artifact` tool call
 * delivered, so the create row's sandboxed preview updates in place when later
 * patch calls settle — the cross-call "realtime" link between rows. Entries
 * are plain module state (the plugin instance lives for the web session);
 * `useSyncExternalStore` subscriptions make rows re-render on update. The
 * store never gates rendering: a settled row always has its own html in its
 * result view, so replay renders without this store; the store only lifts
 * later revisions into the live surface.
 * @module
 */

/** The live state of one artifact, as surfaces read it. */
export interface ArtifactEntry {
  id: string
  /** Optional display title from the create call. */
  title?: string
  /** Monotonic revision; a later revision replaces the entry object. */
  revision: number
  /** The artifact's current HTML source. */
  html: string
}

interface EntryInternal extends ArtifactEntry {
  subscribers: Set<() => void>
}

const entries = new Map<string, EntryInternal>()

/**
 * Record the newest state of an artifact and notify subscribers. A same-
 * revision, same-html write (a replay re-delivering the same result) is a
 * no-op so re-renders do not churn.
 * @param entry - the newest state.
 */
export function setArtifact(entry: ArtifactEntry): void {
  const existing = entries.get(entry.id)
  if (existing !== undefined && existing.revision === entry.revision && existing.html === entry.html) return
  const next: EntryInternal = { ...entry, subscribers: existing?.subscribers ?? new Set() }
  entries.set(entry.id, next)
  for (const subscriber of next.subscribers) subscriber()
}

/**
 * Drop an artifact (its destroy call settled) and notify subscribers; a
 * subscribed surface then renders its closed state.
 * @param id - the artifact to remove.
 */
export function removeArtifact(id: string): void {
  const entry = entries.get(id)
  if (entry === undefined) return
  entries.delete(id)
  for (const subscriber of entry.subscribers) subscriber()
}

/**
 * Subscribe to an artifact's live state. Registers a placeholder (revision 0)
 * for an id not yet seen so a surface mounted before its create call settles
 * receives the first real write.
 * @param id - the artifact id.
 * @param callback - invoked whenever the entry changes or disappears.
 * @returns an unsubscribe function.
 */
export function subscribeArtifact(id: string, callback: () => void): () => void {
  let entry = entries.get(id)
  if (entry === undefined) {
    entry = { id, revision: 0, html: '', subscribers: new Set() }
    entries.set(id, entry)
  }
  entry.subscribers.add(callback)
  return () => {
    const current = entries.get(id)
    current?.subscribers.delete(callback)
  }
}

/**
 * Read an artifact's live state as a STABLE snapshot: the same object
 * reference until a write replaces it (useSyncExternalStore requires this).
 * @param id - the artifact id.
 * @returns the entry, or undefined before its first write or after destroy.
 */
export function getArtifact(id: string): ArtifactEntry | undefined {
  const entry = entries.get(id)
  return entry === undefined || entry.revision === 0 ? undefined : entry
}
