/**
 * The artifact-draft Definition state machine: streamed create html folds into
 * a live chat node and hides once the call is announced or settled; patch and
 * unrelated calls never produce a draft.
 */

import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type {
  ChatConversationViewNode, ConversationMatch, ConversationNodeContext, ConversationNodeDefinition,
} from '@deepseek-ai/dsh-client-runtime/client'
import { artifactDraftDefinition, type ArtifactDraftData } from '../src/client/stream/draft.ts'

type Definition = ConversationNodeDefinition<unknown>
type DraftNode = ChatConversationViewNode & { data: ArtifactDraftData }

function match(seq: number, event: SessionEvent, role: 'start' | 'update' = 'update'): ConversationMatch {
  return { event, view: undefined, role, location: { kind: 'unresolved' } }
}

function stepStart(seq: number, turn: number, step: number): SessionEvent {
  return { type: 'step/start', seq, time: 0, data: { turn, step } }
}

function delta(seq: number, turn: number, step: number, index: number, id: string, name: string, argumentsDelta: string): SessionEvent {
  return {
    type: 'assistant/chunk', seq, time: 0,
    data: { turn, step, chunk: { type: 'tool-call-delta', index, id, name, argumentsDelta } },
  } as unknown as SessionEvent
}

function blockEnd(seq: number, turn: number, step: number, index: number, block: { type: 'tool-call'; id: string; name: string; arguments: string }): SessionEvent {
  return {
    type: 'assistant/chunk', seq, time: 0,
    data: { turn, step, chunk: { type: 'block-end', index, block } },
  } as unknown as SessionEvent
}

function toolCall(seq: number, turn: number, step: number, callId: string, name: string, argumentsRaw: string): SessionEvent {
  return { type: 'tool/call', seq, time: 0, data: { turn, step, callId, name, arguments: argumentsRaw } } as unknown as SessionEvent
}

function toolResult(seq: number, turn: number, step: number, callId: string): SessionEvent {
  return {
    type: 'tool/result', seq, time: 0,
    data: { turn, step, message: { source: { kind: 'tool', callId } } },
  } as unknown as SessionEvent
}

const KEY = 'artifact-draft:1:2'

/** Drive the Definition like the engine: step/start start, then per-event
 *  update, tracking the materialized 'chat' target so the withdrawal rule
 *  (return the same key hidden instead of null) is observable. */
function drive(events: SessionEvent[]): { node: DraftNode | null; visible: DraftNode | null } {
  const definition = artifactDraftDefinition as Definition
  const startEvent = events[0]
  if (startEvent === undefined || startEvent.type !== 'step/start') throw new Error('drive needs step/start first')
  const startMatch = match(startEvent.seq, startEvent, 'start')
  const matches: ConversationMatch[] = [startMatch]
  const current = new Map<string, DraftNode>()
  let state: unknown = definition.start(
    { key: KEY, kind: 'artifact-draft', id: '1:2', matches, start: startMatch, state: undefined, current: new Map() } as unknown as ConversationNodeContext<unknown>,
    startMatch,
    { previous: () => undefined },
  )
  const build = (): DraftNode | null => {
    const context = { key: KEY, kind: 'artifact-draft', id: '1:2', matches, start: startMatch, state, current } as unknown as ConversationNodeContext<unknown>
    const node = definition.buildViewNode?.(context) as unknown as DraftNode | null
    current.set('chat', node as unknown as DraftNode)
    return node
  }
  const first = build()
  for (const event of events.slice(1)) {
    const result = definition.match(event)
    if (result === null) continue
    const update = match(event.seq, event, result.role)
    matches.push(update)
    state = definition.update(
      { key: KEY, kind: 'artifact-draft', id: '1:2', matches, start: startMatch, state, current } as unknown as ConversationNodeContext<unknown> & { state: unknown },
      update,
    )
    build()
  }
  const last = build()
  return { node: last, visible: first }
}

describe('artifactDraftDefinition.match', () => {
  it('starts on step/start and updates on artifact deltas', () => {
    const definition = artifactDraftDefinition as Definition
    expect(definition.match(stepStart(1, 1, 2))).toEqual({ id: '1:2', role: 'start' })
    expect(definition.match(delta(2, 1, 2, 0, 'call_1', 'artifact', '"op"'))).toEqual({ id: '1:2', role: 'update' })
    expect(definition.match(delta(3, 1, 2, 0, 'call_1', 'write', 'x'))).toBeNull()
    expect(definition.match({ type: 'user/message', seq: 9, time: 0, data: { message: { id: 'm' } } } as unknown as SessionEvent)).toBeNull()
  })
})

describe('artifactDraftDefinition streaming fold', () => {
  it('publishes a live node with the accumulated html while streaming', () => {
    const events = [
      stepStart(1, 1, 2),
      delta(2, 1, 2, 0, 'call_1', 'artifact', '{"op":"create","html":"<div>he'),
      delta(3, 1, 2, 0, 'call_1', 'artifact', 'llo</div>"}'),
    ]
    const { node } = drive(events)
    expect(node).not.toBeNull()
    expect(node!.kind).toBe('artifact-draft')
    expect(node!.data.callId).toBe('call_1')
    expect(node!.data.html).toBe('<div>hello</div>')
  })

  it('extracts a still-open value as it streams', () => {
    const events = [
      stepStart(1, 1, 2),
      delta(2, 1, 2, 0, 'call_1', 'artifact', '{"op":"create","html":"<div>hi'),
    ]
    const { node } = drive(events)
    expect(node).not.toBeNull()
    expect(node!.data.html).toBe('<div>hi')
  })

  it('carries the completed title into the draft data', () => {
    const events = [
      stepStart(1, 1, 2),
      delta(2, 1, 2, 0, 'call_1', 'artifact', '{"op":"create","title":"Demo","html":"<p>x</p>"}'),
    ]
    const { node } = drive(events)
    expect(node).not.toBeNull()
    expect(node!.data.title).toBe('Demo')
  })

  it('hides the draft once the call is announced (tool row takes over)', () => {
    const events = [
      stepStart(1, 1, 2),
      delta(2, 1, 2, 0, 'call_1', 'artifact', '{"op":"create","html":"<p>x</p>"}'),
      toolCall(4, 1, 2, 'call_1', 'artifact', '{"op":"create","html":"<p>x</p>"}'),
    ]
    const { node } = drive(events)
    // Withdrawn is forbidden: the materialized target stays, hidden, same key.
    expect(node).not.toBeNull()
    expect(node!.kind).toBe('artifact-draft')
    expect(node!.visibility).toBe('hidden')
    expect(node!.data.callId).toBe('call_1')
  })

  it('hides the draft once the call settles', () => {
    const events = [
      stepStart(1, 1, 2),
      delta(2, 1, 2, 0, 'call_1', 'artifact', '{"op":"create","html":"<p>x</p>"}'),
      toolResult(5, 1, 2, 'call_1'),
    ]
    const { node } = drive(events)
    expect(node).not.toBeNull()
    expect(node!.visibility).toBe('hidden')
  })

  it('produces no draft for a patch call (no html argument)', () => {
    const events = [
      stepStart(1, 1, 2),
      delta(2, 1, 2, 0, 'call_2', 'artifact', '{"op":"patch","id":"art-a","old_st'),
      delta(3, 1, 2, 0, 'call_2', 'artifact', 'ring":"x","new_string":"y"}'),
      toolResult(5, 1, 2, 'call_2'),
    ]
    const { node } = drive(events)
    expect(node).toBeNull()
  })

  it('renders only the create draft when a step mixes create and patch calls', () => {
    const events = [
      stepStart(1, 1, 2),
      delta(2, 1, 2, 0, 'call_1', 'artifact', '{"op":"create","html":"<div>hi</div>"}'),
      delta(3, 1, 2, 1, 'call_2', 'artifact', '{"op":"patch","id":"art-a","old_string":"hi","new_string":"yo"}'),
      delta(4, 1, 2, 1, 'call_2', 'artifact', '"}'),
    ]
    const { node } = drive(events)
    expect(node).not.toBeNull()
    expect(node!.data.callId).toBe('call_1')
  })
})
