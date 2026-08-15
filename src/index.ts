/**
 * dsh-html-artifact host plugin: registers the `artifact` tool — create,
 * patch, read, destroy, list — over a per-session in-memory store. The model
 * PATCHES an artifact by id with edit-style string replacement instead of
 * resending the whole document; every create/patch/read projects the full
 * current HTML through `output.presentationMeta`, so the GUI renders a live
 * sandboxed preview and the session log replays it without this process state.
 * The `card: 'artifact'` render intent is plugin-owned: `presentResult`
 * narrows the meta back into a wire view the browser half (the keyed
 * `tool.call.toolview` atomic view) renders. The core `ToolResultView` union
 * does not know the card, so the return is a deliberate cast — runtime
 * validation is the client's documented generic-card fallback.
 * @module @dsh-external/dsh-html-artifact
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { JsonValue, ToolResultView } from '@deepseek-ai/dsh-tools'
import { ArtifactStore, truncateHtml, type ArtifactState } from './registry.ts'

/** Cordis plugin name. */
export const name = 'dsh-html-artifact'
/** Required capability: the tool registry. */
export const inject = ['tools']

/** Default cap on one stored artifact's HTML source. */
export const DEFAULT_MAX_ARTIFACT_BYTES = 512 * 1024
/** Default cap on the HTML a `read` op returns to the model. */
export const DEFAULT_MAX_READ_BYTES = 64 * 1024

/** Model-facing artifact tool configuration. */
export interface Config {
  /** Maximum UTF-8 bytes of one artifact's stored HTML source. */
  maxArtifactBytes?: number
  /** Maximum UTF-8 bytes of HTML a `read` op returns (capped with a notice). */
  maxReadBytes?: number
}

/** Schemastery configuration for the artifact tool consumer. */
export const Config = z.object({
  maxArtifactBytes: z.number().min(1).default(DEFAULT_MAX_ARTIFACT_BYTES),
  maxReadBytes: z.number().min(1).default(DEFAULT_MAX_READ_BYTES),
})

/** The tool's op vocabulary, one per lifecycle stage. */
type ArtifactOp = 'create' | 'patch' | 'read' | 'destroy' | 'list'

/** Validated per-op arguments (schema keeps the fields loose; execute narrows). */
interface CreateArgs { op: 'create'; title?: string; html?: string }
interface PatchArgs { op: 'patch'; id: string; old_string: string; new_string: string; replace_all?: boolean }
interface ReadArgs { op: 'read'; id: string }
interface DestroyArgs { op: 'destroy'; id: string }
interface ListArgs { op: 'list' }

/** Canonical per-op output values (the loose output schema's valid subsets). */
interface CreateValue { op: 'create'; id: string; revision: number; title?: string; html: string }
interface PatchValue { op: 'patch'; id: string; revision: number; html: string; applied: number }
interface ReadValue { op: 'read'; id: string; revision: number; html: string; truncated: boolean }
interface DestroyValue { op: 'destroy'; id: string; removed: true }
interface ListValue { op: 'list'; artifacts: { id: string; revision: number; bytes: number; title?: string }[] }

type ArtifactValue = CreateValue | PatchValue | ReadValue | DestroyValue | ListValue

/** One listable artifact summary as the model-facing result carries it. */
interface ArtifactSummaryWire { id: string; revision: number; bytes: number; title?: string }

function isArtifactValue(value: unknown): value is ArtifactValue {
  if (value === null || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return typeof candidate.op === 'string'
    && ['create', 'patch', 'read', 'destroy', 'list'].includes(candidate.op)
}

function bytesOf(html: string): number {
  return new TextEncoder().encode(html).byteLength
}

function requireString(args: Record<string, unknown>, key: string, label: string): string {
  const value = args[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`artifact ${label}: \`${key}\` must be a non-empty string`)
  }
  return value
}

/** The artifact store of one owning agent (created lazily, held weakly). */
const stores = new WeakMap<Agent, ArtifactStore>()

function storeFor(agent: Agent | undefined): ArtifactStore {
  if (agent === undefined) throw new Error('artifact requires an owning agent session')
  let store = stores.get(agent)
  if (store === undefined) {
    store = new ArtifactStore()
    stores.set(agent, store)
  }
  return store
}

/** Register the `artifact` tool. */
export function apply(ctx: Context, config: Config = {}): void {
  const maxArtifactBytes = config.maxArtifactBytes ?? DEFAULT_MAX_ARTIFACT_BYTES
  const maxReadBytes = config.maxReadBytes ?? DEFAULT_MAX_READ_BYTES

  ctx.tools.register(defineTool({
    name: 'artifact',
    description:
      'Create and iteratively refine an interactive HTML artifact that renders LIVE in the GUI inside a sandboxed iframe. '
      + '`create` starts an artifact, optionally with initial `html`; `patch` applies an edit-style string replacement '
      + '(`old_string`/`new_string`, same semantics as the file `edit` tool) to the artifact\'s HTML source by id — prefer '
      + '`patch` over `create` for updates: the model sends only the change and the live preview updates in place. '
      + '`read` returns the current source; `destroy` closes an artifact; `list` enumerates the session\'s artifacts. '
      + 'Track every artifact id and destroy artifacts that no longer matter. Keep artifacts self-contained and reasonably '
      + 'small (inline styles/scripts; external https: images/fonts/styles allowed; network fetches allowed).',
    parameters: {
      op: {
        type: 'string', required: true,
        enum: ['create', 'patch', 'read', 'destroy', 'list'],
        description: 'The operation: create | patch | read | destroy | list.',
      },
      title: { type: 'string', description: 'create: optional display title for the artifact.' },
      html: { type: 'string', description: 'create: the initial HTML source (may be empty).' },
      id: { type: 'string', description: 'patch/read/destroy: the artifact id returned by create or list.' },
      old_string: { type: 'string', description: 'patch: the exact substring to find in the artifact\'s HTML source.' },
      new_string: { type: 'string', description: 'patch: the replacement text.' },
      replace_all: { type: 'boolean', description: 'patch: replace every occurrence instead of only the first (default false).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          op: { type: 'string', required: true, enum: ['create', 'patch', 'read', 'destroy', 'list'] },
          id: { type: 'string' },
          revision: { type: 'integer' },
          title: { type: 'string' },
          html: { type: 'string' },
          applied: { type: 'integer' },
          removed: { type: 'boolean' },
          truncated: { type: 'boolean' },
          artifacts: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                revision: { type: 'integer', required: true },
                bytes: { type: 'integer', required: true },
                title: { type: 'string' },
              },
            },
          },
        },
      },
      render: (_args, value) => {
        if (!isArtifactValue(value)) return [{ type: 'text', text: 'artifact: unexpected result' }]
        switch (value.op) {
          case 'create': {
            const bytes = bytesOf(value.html)
            return [{
              type: 'text',
              text: `Created HTML artifact ${value.id} (${bytes} bytes).`
                + ' A live preview renders in the GUI; update it with `artifact patch` on this id instead of rewriting.',
            }]
          }
          case 'patch':
            return [{
              type: 'text',
              text: `Patched artifact ${value.id} → revision ${value.revision}: replaced ${value.applied} occurrence(s).`,
            }]
          case 'read':
            return [{
              type: 'text',
              text: `Artifact ${value.id} (revision ${value.revision}):`
                + `${value.truncated ? `\n[truncated to ${maxReadBytes} bytes; the stored artifact is larger]` : ''}\n${value.html}`,
            }]
          case 'destroy':
            return [{ type: 'text', text: `Destroyed artifact ${value.id}.` }]
          case 'list': {
            if (value.artifacts.length === 0) return [{ type: 'text', text: '(no HTML artifacts in this session)' }]
            const lines = value.artifacts.map((summary) => {
              const label = summary.title === undefined ? '' : ` (${summary.title})`
              return `- ${summary.id}${label} rev ${summary.revision}, ${summary.bytes} bytes`
            })
            return [{ type: 'text', text: `HTML artifacts (${value.artifacts.length}):\n${lines.join('\n')}` }]
          }
        }
      },
      presentationMeta: (_args, value): JsonValue => {
        if (!isArtifactValue(value)) return null
        switch (value.op) {
          case 'create':
            return { op: 'create', id: value.id, revision: value.revision, html: value.html, ...value.title === undefined ? {} : { title: value.title } }
          case 'patch':
            return { op: 'patch', id: value.id, revision: value.revision, html: value.html, applied: value.applied }
          case 'read':
            return { op: 'read', id: value.id, revision: value.revision, html: value.html, truncated: value.truncated }
          case 'destroy':
            return { op: 'destroy', id: value.id }
          case 'list':
            return { op: 'list', artifacts: value.artifacts }
        }
      },
    },
    execute(args, exec) {
      const store = storeFor(exec.agent)
      const op = (args as Record<string, unknown>).op
      switch (op) {
        case 'create': {
          const raw = args as Record<string, unknown>
          const html = typeof raw.html === 'string' ? raw.html : ''
          const title = typeof raw.title === 'string' && raw.title.trim() !== '' ? raw.title.trim() : undefined
          const id = store.create(html, title, maxArtifactBytes)
          const state = store.get(id)
          return Promise.resolve({
            op: 'create', id, revision: state.revision, html: state.html,
            ...title === undefined ? {} : { title },
          })
        }
        case 'patch': {
          const raw = args as Record<string, unknown>
          const id = requireString(raw, 'id', 'patch')
          const oldString = requireString(raw, 'old_string', 'patch')
          const newString = requireString(raw, 'new_string', 'patch')
          const replaceAll = raw.replace_all === true
          const { state, count } = store.patch(id, oldString, newString, replaceAll, maxArtifactBytes)
          return Promise.resolve({ op: 'patch', id, revision: state.revision, html: state.html, applied: count })
        }
        case 'read': {
          const id = requireString(args as Record<string, unknown>, 'id', 'read')
          const state = store.get(id)
          const capped = truncateHtml(state.html, maxReadBytes)
          return Promise.resolve({
            op: 'read', id, revision: state.revision, html: capped.html, truncated: capped.truncated,
          })
        }
        case 'destroy': {
          const id = requireString(args as Record<string, unknown>, 'id', 'destroy')
          store.destroy(id)
          return Promise.resolve({ op: 'destroy', id, removed: true as const })
        }
        case 'list': {
          return Promise.resolve({ op: 'list', artifacts: store.list() })
        }
        default:
          throw new Error(`artifact: unknown op ${String(op)}`)
      }
    },
    presentCall(args) {
      // The artifact card is result-only: a running call has no id/html to
      // draw, so every pending state is a plain generic card by op.
      const op = (args as Record<string, unknown>).op
      const id = (args as Record<string, unknown>).id
      switch (op) {
        case 'create': return { card: 'generic', title: 'Create HTML artifact', kind: 'other' }
        case 'patch': return { card: 'generic', title: `Patch artifact ${String(id)}`, kind: 'edit', rawInput: (args as Record<string, unknown>).old_string }
        case 'read': return { card: 'generic', title: `Read artifact ${String(id)}`, kind: 'read' }
        case 'destroy': return { card: 'generic', title: `Destroy artifact ${String(id)}`, kind: 'delete' }
        case 'list': return { card: 'generic', title: 'List HTML artifacts', kind: 'read' }
        default: return undefined
      }
    },
    presentResult(_args, result): ToolResultView | undefined {
      if (result.isError) return undefined
      const meta = result.meta
      if (meta === null || typeof meta !== 'object') return undefined
      const candidate = meta as Record<string, unknown>
      if (typeof candidate.op !== 'string') return undefined
      switch (candidate.op) {
        case 'create':
        case 'patch':
        case 'read': {
          const { id, revision, html, title, applied, truncated } = candidate
          if (typeof id !== 'string' || typeof revision !== 'number' || typeof html !== 'string') return undefined
          return {
            card: 'artifact', op: candidate.op, id, revision, html,
            ...typeof title === 'string' ? { title } : {},
            ...typeof applied === 'number' ? { applied } : {},
            ...typeof truncated === 'boolean' ? { truncated } : {},
          } as unknown as ToolResultView
        }
        case 'destroy': {
          if (typeof candidate.id !== 'string') return undefined
          return { card: 'artifact', op: 'destroy', id: candidate.id } as unknown as ToolResultView
        }
        case 'list': {
          if (!Array.isArray(candidate.artifacts)) return undefined
          const artifacts: ArtifactSummaryWire[] = []
          for (const entry of candidate.artifacts) {
            if (entry === null || typeof entry !== 'object') return undefined
            const { id, revision, bytes, title } = entry as Record<string, unknown>
            if (typeof id !== 'string' || typeof revision !== 'number' || typeof bytes !== 'number') return undefined
            artifacts.push({ id, revision, bytes, ...typeof title === 'string' ? { title } : {} })
          }
          return { card: 'artifact', op: 'list', artifacts } as unknown as ToolResultView
        }
        default:
          return undefined
      }
    },
  }))
}

export type { ArtifactState }
