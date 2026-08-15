/**
 * The `artifact-draft` chat node: a ConversationNodeDefinition (registered on
 * the runtime's `conversationEvents` service — no ui-conversation value
 * imports) that folds the model's STREAMING artifact calls into a live chat
 * node. While the model writes a `create` call's html token by token, the
 * accumulated `tool-call-delta` arguments are parsed tolerantly and published
 * as a draft node the browser half renders into a persistent bridge iframe
 * (no per-chunk iframe reload). The draft hides once the call is announced
 * (`tool/call`) — the settled/announced tool row takes over — and never
 * appears for patch/read/destroy/list calls (their args carry no html).
 *
 * The Definition follows the engine contract like the shipped assistant-step
 * Definition: identity is the `turn:step` of the streaming events, matched
 * events carry `role: 'update'`, and `step/start` is the single `start`.
 * @module
 */
import type {
  ConversationMatch, ConversationNodeContext, ConversationNodeDefinition,
} from '@deepseek-ai/dsh-client-runtime/client'
import { conversationContextKey } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { extractStreamingHtml, extractStreamingTitle, isStreamingCreate } from './extract.ts'

/** The wire shape of one streamed artifact call inside the Definition state. */
interface DraftCall {
  callId: string
  /** Accumulated tool-call arguments text (partial JSON while streaming). */
  argsRaw: string
  /** The html argument extracted so far (empty until the `html` key arrives). */
  html: string
  /** Whether the args have yielded an html value yet (a create call's draft). */
  hasHtml: boolean
  /** The title argument so far, when it has completed. */
  title?: string
  /** Whether `tool/call` arrived (the keyed tool row now owns the display). */
  announced: boolean
  /** Whether `tool/result` arrived (the draft is done either way). */
  settled: boolean
}

interface ArtifactDraftState {
  readonly turn: number
  readonly step: number
  readonly calls: ReadonlyMap<string, DraftCall>
}

/** The data of one rendered `artifact-draft` chat node. */
export interface ArtifactDraftData {
  /** The streamed artifact call's id. */
  callId: string
  /** The html streamed so far. */
  html: string
  /** The completed title argument so far, when it has arrived. */
  title?: string
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ChatNodeDataMap {
    /** Live artifact draft: renders the model's streaming create html. */
    'artifact-draft': ArtifactDraftData
  }
}

function initialState(turn: number, step: number): ArtifactDraftState {
  return { turn, step, calls: new Map() }
}

/** Step identity used by every matched event (mirrors the assistant Definition). */
function stepId(event: { data: { turn: number; step: number } }): string {
  return `${event.data.turn}:${event.data.step}`
}

/** Narrow a block-end tool-call content block (structural: the wire block
 *  shape is not re-imported here). */
function asArtifactToolCall(block: unknown): { id: string; arguments: string } | null {
  if (block === null || typeof block !== 'object') return null
  const candidate = block as Record<string, unknown>
  if (candidate.type !== 'tool-call' || candidate.name !== 'artifact') return null
  if (typeof candidate.id !== 'string' && typeof candidate.id !== 'number') return null
  if (typeof candidate.arguments !== 'string') return null
  return { id: String(candidate.id), arguments: candidate.arguments }
}

function draftCall(callId: string, argsRaw: string, previous: DraftCall | undefined): DraftCall {
  const extracted = extractStreamingHtml(argsRaw)
  const title = extractStreamingTitle(argsRaw)
  return {
    callId,
    argsRaw,
    html: extracted?.html ?? '',
    hasHtml: extracted !== null,
    ...title === undefined ? {} : { title },
    announced: previous?.announced ?? false,
    settled: previous?.settled ?? false,
  }
}

/**
 * Fold one matched event into the draft state.
 * @param state - current Definition state.
 * @param match - the accepted event.
 * @returns the next state.
 */
export function updateDraftState(state: ArtifactDraftState, match: ConversationMatch): ArtifactDraftState {
  const event = match.event
  if (event.type === 'assistant/chunk') {
    const chunk = event.data.chunk
    if (chunk.type === 'tool-call-delta' && chunk.name === 'artifact') {
      const callId = String(chunk.id)
      const calls = new Map(state.calls)
      const previous = calls.get(callId)
      calls.set(callId, draftCall(callId, (previous?.argsRaw ?? '') + chunk.argumentsDelta, previous))
      return { ...state, calls }
    }
    if (chunk.type === 'block-end') {
      const call = asArtifactToolCall(chunk.block)
      if (call === null) return state
      const calls = new Map(state.calls)
      calls.set(call.id, draftCall(call.id, call.arguments, calls.get(call.id)))
      return { ...state, calls }
    }
    return state
  }
  if (event.type === 'tool/call') {
    const calls = new Map(state.calls)
    const existing = calls.get(event.data.callId)
    if (existing === undefined) return state
    calls.set(event.data.callId, { ...existing, announced: true })
    return { ...state, calls }
  }
  if (event.type === 'tool/result') {
    const source = event.data.message.source
    const calls = new Map(state.calls)
    const existing = calls.get(source.callId)
    if (existing === undefined) return state
    calls.set(source.callId, { ...existing, settled: true })
    return { ...state, calls }
  }
  return state
}

/** Find the streamed call worth rendering: the newest create draft still
 *  owned by the tool row lifecycle (not announced, not settled). */
function activeDraft(state: ArtifactDraftState): DraftCall | undefined {
  let active: DraftCall | undefined
  for (const call of state.calls.values()) {
    if (call.announced || call.settled || !call.hasHtml || !isStreamingCreate(call.argsRaw)) continue
    active = call
  }
  return active
}

/**
 * The artifact-draft Definition: streams the model's in-flight `artifact
 * create` html into a live chat node, hiding once the tool call is announced
 * or settled (the keyed tool row owns the settled display).
 */
export const artifactDraftDefinition: ConversationNodeDefinition<ArtifactDraftState> = {
  kind: 'artifact-draft',
  target: 'chat',
  match(event) {
    if (event.type === 'step/start') return { id: stepId(event), role: 'start' }
    if (event.type === 'assistant/chunk') {
      const chunk = event.data.chunk
      if (chunk.type === 'tool-call-delta' && chunk.name === 'artifact') {
        return { id: stepId(event), role: 'update' }
      }
      if (chunk.type === 'block-end') {
        if (asArtifactToolCall(chunk.block) !== null) return { id: stepId(event), role: 'update' }
      }
      return null
    }
    if (event.type === 'tool/call' && event.data.name === 'artifact') {
      return { id: stepId(event), role: 'update' }
    }
    if (event.type === 'tool/result') {
      // The result carries no tool name; the update filters by callId, and an
      // unrelated result for the same step is a no-op.
      return { id: stepId(event), role: 'update' }
    }
    return null
  },
  start: (_context, match) => {
    if (match.event.type !== 'step/start') throw new Error('artifact-draft start requires step/start')
    return initialState(match.event.data.turn, match.event.data.step)
  },
  update: (context, match) => updateDraftState(context.state, match),
  publication: (match) => {
    if (match.event.type === 'assistant/chunk'
      && match.event.data.chunk.type === 'tool-call-delta') {
      return 'animation-frame'
    }
    return 'immediate'
  },
  buildViewNode(context) {
    const state = context.state
    if (state === undefined) return null
    const active = activeDraft(state)
    if (active === undefined) return null
    // Anchor at the first streamed artifact delta so the draft sits where the
    // model started writing the call.
    let anchorSeq = context.start?.event.seq ?? 0
    for (const match of context.matches) {
      if (match.event.type !== 'assistant/chunk') continue
      const chunk = match.event.data.chunk
      if (chunk.type === 'tool-call-delta' && chunk.name === 'artifact') {
        anchorSeq = match.event.seq
        break
      }
    }
    return {
      key: conversationContextKey('artifact-draft', context.id),
      kind: 'artifact-draft',
      id: context.id,
      target: 'chat',
      anchorSeq,
      location: context.start?.location ?? context.matches[0]?.location ?? { kind: 'unresolved' },
      visibility: 'visible',
      data: { callId: active.callId, html: active.html, ...active.title === undefined ? {} : { title: active.title } },
    }
  },
}
