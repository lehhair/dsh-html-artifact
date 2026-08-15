/**
 * Pure artifact store and patch engine for the `artifact` tool. Kept free of
 * harness imports so the semantics (replace counting, byte caps, truncation,
 * id generation) are directly unit-testable and replay-safe: the tool's
 * presentationMeta carries the FULL html on every create/patch/read, so the
 * GUI and session log never depend on this in-memory state surviving.
 * @module
 */

/** One live HTML artifact owned by a session. */
export interface ArtifactState {
  /** The artifact's current HTML source. */
  html: string
  /** Monotonic revision; every create/patch bumps it. */
  revision: number
  /** Optional display title the model chose at create time. */
  title?: string
}

/** One listable artifact summary, as the `list` op reports it. */
export interface ArtifactSummary {
  id: string
  revision: number
  bytes: number
  title?: string
}

/** Replacement outcome of one `patch` op. */
export interface ReplaceOutcome {
  /** The full source after the replacement(s). */
  html: string
  /** How many occurrences were replaced (0 means none found). */
  count: number
}

/** Result of applying a patch to an artifact. */
export interface PatchResult {
  /** The updated artifact state (revision already bumped). */
  state: ArtifactState
  /** How many occurrences the replacement matched. */
  count: number
}

/**
 * Replace occurrences of `oldString` in `source`. Mirrors the file `edit`
 * tool's semantics: plain first-index match (never regex), replace the first
 * occurrence or all of them, and treat an identical old/new pair as a no-op.
 * @param source - the current artifact source.
 * @param oldString - the exact substring to find (non-empty).
 * @param newString - the replacement text.
 * @param replaceAll - replace every occurrence instead of only the first.
 * @returns the replacement outcome; `count` is 0 when nothing matched.
 */
export function replaceOccurrences(source: string, oldString: string, newString: string, replaceAll: boolean): ReplaceOutcome {
  if (oldString.length === 0) return { html: source, count: 0 }
  if (oldString === newString) return { html: source, count: 0 }
  let count = 0
  let html = source
  if (!replaceAll) {
    const index = html.indexOf(oldString)
    if (index === -1) return { html: source, count: 0 }
    return { html: html.slice(0, index) + newString + html.slice(index + oldString.length), count: 1 }
  }
  let cursor = 0
  let out = ''
  for (;;) {
    const index = html.indexOf(oldString, cursor)
    if (index === -1) break
    out += html.slice(cursor, index) + newString
    cursor = index + oldString.length
    count++
  }
  if (count === 0) return { html: source, count: 0 }
  return { html: out + html.slice(cursor), count }
}

/**
 * Truncate an HTML source to a UTF-8 byte cap without splitting a character.
 * @param html - the source to cap.
 * @param maxBytes - the cap in UTF-8 bytes.
 * @returns the (possibly truncated) source and whether it was cut.
 */
export function truncateHtml(html: string, maxBytes: number): { html: string; truncated: boolean } {
  if (new TextEncoder().encode(html).byteLength <= maxBytes) return { html, truncated: false }
  let low = 0
  let high = html.length
  while (low < high) {
    const mid = (low + high + 1) >> 1
    if (new TextEncoder().encode(html.slice(0, mid)).byteLength <= maxBytes) low = mid
    else high = mid - 1
  }
  return { html: html.slice(0, low), truncated: true }
}

/** Error thrown when a patch's old_string is not present in the artifact. */
export class PatchNotFoundError extends Error {
  constructor(public readonly id: string, public readonly snippet: string) {
    super(`artifact ${id}: old_string not found${snippet === '' ? '' : ` (near ${JSON.stringify(snippet.slice(0, 60))})`}`)
    this.name = 'PatchNotFoundError'
  }
}

/** Error thrown when a patch would leave the artifact unchanged. */
export class NoChangeError extends Error {
  constructor(public readonly id: string) {
    super(`artifact ${id}: old_string equals new_string — nothing to change`)
    this.name = 'NoChangeError'
  }
}

/** Error thrown when a mutation would exceed the configured byte cap. */
export class ArtifactTooLargeError extends Error {
  constructor(public readonly maxBytes: number) {
    super(`artifact source exceeds the ${maxBytes}-byte cap; remove or shrink content first`)
    this.name = 'ArtifactTooLargeError'
  }
}

/** Error thrown when an op names an artifact this session does not own. */
export class ArtifactNotFoundError extends Error {
  constructor(public readonly id: string) {
    super(`artifact ${id} not found (create it first, or list to see the session's artifacts)`)
    this.name = 'ArtifactNotFoundError'
  }
}

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

/** Generate a fresh artifact id not present in `existing`. */
export function makeArtifactId(existing: ReadonlySet<string>): string {
  for (let attempt = 0; attempt < 100; attempt++) {
    let id = 'art-'
    for (let i = 0; i < 6; i++) {
      id += ID_ALPHABET[Math.floor(Math.random() * ID_ALPHABET.length)]
    }
    if (!existing.has(id)) return id
  }
  throw new Error('artifact: could not allocate a unique id')
}

/**
 * The per-session artifact registry. One instance per owning agent; the tool
 * plugin keys a WeakMap by the executing Agent.
 */
export class ArtifactStore {
  private readonly states = new Map<string, ArtifactState>()

  /**
   * Create an artifact with an initial source.
   * @param html - the initial HTML source (may be empty).
   * @param title - optional display title.
   * @param maxBytes - byte cap on the stored source.
   * @returns the new artifact's id.
   */
  create(html: string, title: string | undefined, maxBytes: number): string {
    if (new TextEncoder().encode(html).byteLength > maxBytes) throw new ArtifactTooLargeError(maxBytes)
    const id = makeArtifactId(new Set(this.states.keys()))
    this.states.set(id, { html, revision: 1, ...title === undefined ? {} : { title } })
    return id
  }

  /**
   * Apply one string replacement to an artifact, bumping its revision.
   * @param id - the artifact to patch.
   * @param oldString - exact substring to find (non-empty).
   * @param newString - replacement text.
   * @param replaceAll - replace every occurrence instead of the first.
   * @param maxBytes - byte cap on the stored source.
   * @returns the updated state and match count.
   */
  patch(id: string, oldString: string, newString: string, replaceAll: boolean, maxBytes: number): PatchResult {
    const state = this.get(id)
    if (oldString === newString) throw new NoChangeError(id)
    const outcome = replaceOccurrences(state.html, oldString, newString, replaceAll)
    if (outcome.count === 0) {
      const index = state.html.indexOf(oldString.slice(0, 1))
      const snippet = index === -1 ? '' : state.html.slice(Math.max(0, index - 40), index + 80)
      throw new PatchNotFoundError(id, snippet)
    }
    if (new TextEncoder().encode(outcome.html).byteLength > maxBytes) throw new ArtifactTooLargeError(maxBytes)
    const next: ArtifactState = { html: outcome.html, revision: state.revision + 1, ...state.title === undefined ? {} : { title: state.title } }
    this.states.set(id, next)
    return { state: next, count: outcome.count }
  }

  /**
   * Read an artifact's current state.
   * @param id - the artifact to read.
   * @returns the state.
   */
  get(id: string): ArtifactState {
    const state = this.states.get(id)
    if (state === undefined) throw new ArtifactNotFoundError(id)
    return state
  }

  /**
   * Remove an artifact.
   * @param id - the artifact to destroy.
   */
  destroy(id: string): void {
    if (!this.states.delete(id)) throw new ArtifactNotFoundError(id)
  }

  /** Summaries of every artifact in this store, in creation order. */
  list(): ArtifactSummary[] {
    return [...this.states.entries()].map(([id, state]) => ({
      id,
      revision: state.revision,
      bytes: new TextEncoder().encode(state.html).byteLength,
      ...state.title === undefined ? {} : { title: state.title },
    }))
  }
}
