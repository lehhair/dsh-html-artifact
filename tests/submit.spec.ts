/**
 * Interaction submission formatting.
 */

import { describe, expect, it } from 'vitest'
import { formatSubmission } from '../src/client/stream/submit.ts'

describe('formatSubmission', () => {
  it('builds a user message the agent reads, with the data as a JSON block', () => {
    const text = formatSubmission('art-1', 'Demo', { fields: [{ name: 'x', kind: 'text', value: '1' }] })
    expect(text).toContain('[artifact 交互提交]')
    expect(text).toContain('art-1（Demo）')
    expect(text).toContain('```json')
    expect(text).toContain('"fields"')
  })

  it('omits the title parens when the artifact has no title', () => {
    const text = formatSubmission('art-2', undefined, { fields: [] })
    expect(text).toContain('art-2 ')
    expect(text).not.toContain('（')
  })
})
