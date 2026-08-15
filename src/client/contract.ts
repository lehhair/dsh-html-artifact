/**
 * Local toolview contract for the dsh-html-artifact plugin: the owner currency
 * the stock ui-tool rows supply at `tool.call.toolview` and the pure
 * artifact-card derivation, declared locally so this plugin never imports the
 * stock ui-tool contract (one-way dependency). The `declare module` merge
 * restores the slot key this plugin registers into — the stock ui-tool bundle
 * declares the same row with the same shape, and interface merging accepts the
 * duplicate identical declaration.
 * @module
 */
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-runtime/client'

/** What the stock ui-tool rows pass to the `tool.call.toolview` keyed slots. */
export interface ToolCallOwnerProps {
  /** Tool call identity, stable across running and settled forms. */
  callId: string
  /** Wire Tool name and keyed dispatch value. */
  toolName: string
  /** Frozen running call or settled result node. */
  block: ToolCallBlock
  /** Session workspace root for relative summaries. */
  cwd?: string | undefined
  /** Open a Tool argument path through the Host. */
  openFile: (path: string) => void
  /** Inspect this call in the trajectory view when available. */
  inspect?: (() => void) | undefined
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Keyed atomic Tool call view (declared by the stock ui-tool chat tree). */
    'tool.call.toolview': { kind: 'keyed'; scope: 'session'; owner: ToolCallOwnerProps }
  }
}

/** One listable artifact summary on the wire. */
export interface ArtifactSummaryView {
  id: string
  revision: number
  bytes: number
  title?: string
}

/**
 * The plugin-owned `card: 'artifact'` render intent the host computes from the
 * tool's `presentResult` and ships on the `tool/result` event. The core union
 * does not know this card; the wire value is parsed with these local types and
 * every malformed field falls back to the generic card.
 */
export type ArtifactCardView =
  | { card: 'artifact'; op: 'create' | 'patch' | 'read'; id: string; revision: number; html: string; title?: string; applied?: number; truncated?: boolean }
  | { card: 'artifact'; op: 'destroy'; id: string }
  | { card: 'artifact'; op: 'list'; artifacts: ArtifactSummaryView[] }

/** The derived artifact-card material the row draws. */
export interface ArtifactCardModel {
  view: ArtifactCardView
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : null
}

/**
 * Narrow a wire `card:'artifact'` view to a well-formed model, or null when
 * this call is not an artifact card (running calls have no result view; a
 * `card` or `op` value this UI version does not know arrives over the wire
 * from a newer host and takes the generic path).
 * @param block - running or settled tool node.
 * @returns the artifact-card model, or null for the generic path.
 */
export function artifactCardModel(block: ToolCallBlock): ArtifactCardModel | null {
  // Running calls have no result view; the artifact card is result-only.
  if (!('kind' in block)) return null
  const view = asRecord(block.resultView)
  if (view === null || view.card !== 'artifact') return null
  const op = view.op
  if (op !== 'create' && op !== 'patch' && op !== 'read' && op !== 'destroy' && op !== 'list') return null
  if (op === 'create' || op === 'patch' || op === 'read') {
    const { id, revision, html, title, applied, truncated } = view
    if (typeof id !== 'string' || typeof revision !== 'number' || typeof html !== 'string') return null
    return {
      view: {
        card: 'artifact', op, id, revision, html,
        ...typeof title === 'string' ? { title } : {},
        ...typeof applied === 'number' ? { applied } : {},
        ...typeof truncated === 'boolean' ? { truncated } : {},
      },
    }
  }
  if (op === 'destroy') {
    if (typeof view.id !== 'string') return null
    return { view: { card: 'artifact', op: 'destroy', id: view.id } }
  }
  if (!Array.isArray(view.artifacts)) return null
  const artifacts: ArtifactSummaryView[] = []
  for (const entry of view.artifacts) {
    const record = asRecord(entry)
    if (record === null) return null
    const { id, revision, bytes, title } = record
    if (typeof id !== 'string' || typeof revision !== 'number' || typeof bytes !== 'number') return null
    artifacts.push({ id, revision, bytes, ...typeof title === 'string' ? { title } : {} })
  }
  return { view: { card: 'artifact', op: 'list', artifacts } }
}

/** The parsed model-facing arguments of one artifact call. */
export interface ArtifactArgs {
  op: string
  id?: string
  title?: string
  html?: string
  oldString?: string
  newString?: string
  replaceAll?: boolean
}

/**
 * Parse the model-facing arguments off a running or settled node. The wire
 * args are a JSON string; malformed JSON yields undefined (the generic path).
 * @param block - running or settled tool node.
 * @returns the parsed args, or undefined when unparseable.
 */
export function artifactArgs(block: ToolCallBlock): ArtifactArgs | undefined {
  const argsRaw = 'kind' in block ? (block.call?.argsRaw ?? '') : block.argsRaw
  if (typeof argsRaw !== 'string' || argsRaw === '') return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(argsRaw)
  } catch {
    return undefined
  }
  const record = asRecord(parsed)
  if (record === null || typeof record.op !== 'string') return undefined
  return {
    op: record.op,
    ...typeof record.id === 'string' ? { id: record.id } : {},
    ...typeof record.title === 'string' ? { title: record.title } : {},
    ...typeof record.html === 'string' ? { html: record.html } : {},
    ...typeof record.old_string === 'string' ? { oldString: record.old_string } : {},
    ...typeof record.new_string === 'string' ? { newString: record.new_string } : {},
    ...typeof record.replace_all === 'boolean' ? { replaceAll: record.replace_all } : {},
  }
}
