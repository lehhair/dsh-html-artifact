/**
 * Interaction submission formatting (the slash-command line the host parses).
 */

import { describe, expect, it } from 'vitest'
import { formatSubmissionCommand } from '../src/client/stream/submit.ts'

describe('formatSubmissionCommand', () => {
  it('builds the /artifact-submit command line with the payload', () => {
    const line = formatSubmissionCommand('art-1', 'Demo', { fields: [{ name: 'x', kind: 'text', value: '1' }] })
    expect(line).toMatch(/^\/artifact-submit /)
    const payload = JSON.parse(line.slice('/artifact-submit '.length)) as { id: string; title: string; data: unknown }
    expect(payload.id).toBe('art-1')
    expect(payload.title).toBe('Demo')
    expect(payload.data).toEqual({ fields: [{ name: 'x', kind: 'text', value: '1' }] })
  })

  it('omits the title key when the artifact has no title', () => {
    const line = formatSubmissionCommand('art-2', undefined, { fields: [] })
    expect(line).not.toContain('title')
  })
})
