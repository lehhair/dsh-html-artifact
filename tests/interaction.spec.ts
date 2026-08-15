/**
 * Server-side interaction submission: payload parsing and the rendered text
 * the pre-step injector puts in front of the model.
 */

import { describe, expect, it } from 'vitest'
import { parseSubmissionPayload, renderInteractionSubmission, renderSubmissionSummary } from '../src/interaction.ts'

describe('parseSubmissionPayload', () => {
  it('parses a valid payload with id, title, and data', () => {
    const parsed = parseSubmissionPayload('{"id":"art-1","title":"Demo","data":{"fields":[{"name":"x","kind":"text","value":"1"}]}}')
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.value.id).toBe('art-1')
      expect(parsed.value.title).toBe('Demo')
      expect(parsed.value.data).toEqual({ fields: [{ name: 'x', kind: 'text', value: '1' }] })
      expect(Number.isFinite(parsed.value.time)).toBe(true)
    }
  })

  it('omits the title when absent or empty', () => {
    const noTitle = parseSubmissionPayload('{"id":"art-2","data":{}}')
    expect(noTitle.ok && 'title' in noTitle.value).toBe(false)
    const emptyTitle = parseSubmissionPayload('{"id":"art-2","title":"","data":{}}')
    expect(emptyTitle.ok && 'title' in emptyTitle.value).toBe(false)
  })

  it('rejects malformed JSON, non-objects, missing ids, and missing data', () => {
    expect(parseSubmissionPayload('nope').ok).toBe(false)
    expect(parseSubmissionPayload('[1,2]').ok).toBe(false)
    expect(parseSubmissionPayload('{"data":{}}').ok).toBe(false)
    expect(parseSubmissionPayload('{"id":"","data":{}}').ok).toBe(false)
    expect(parseSubmissionPayload('{"id":"art-3"}').ok).toBe(false)
  })
})

describe('renderInteractionSubmission', () => {
  it('renders a model-visible context block with the data as JSON', () => {
    const text = renderInteractionSubmission({ id: 'art-1', title: 'Demo', data: { fields: [] }, time: 1 })
    expect(text).toContain('[artifact 交互提交]')
    expect(text).toContain('art-1（Demo）')
    expect(text).toContain('```json')
    expect(text).toContain('"fields"')
  })

  it('omits the title parens when the artifact has no title', () => {
    const text = renderInteractionSubmission({ id: 'art-2', data: { fields: [] }, time: 1 })
    expect(text).toContain('art-2 ')
    expect(text).not.toContain('（')
  })
})

describe('renderSubmissionSummary', () => {
  it('renders the collapsed row summary with the field count', () => {
    const summary = renderSubmissionSummary({
      id: 'art-1',
      title: 'Demo',
      data: { fields: [{ name: 'x', kind: 'text', value: '1' }] },
      time: 1,
    })
    expect(summary).toContain('art-1（Demo）')
    expect(summary).toContain('1 个字段')
  })

  it('counts non-field payloads as zero fields', () => {
    const summary = renderSubmissionSummary({ id: 'art-2', data: { artifactData: { x: 1 } }, time: 1 })
    expect(summary).toContain('0 个字段')
  })
})
