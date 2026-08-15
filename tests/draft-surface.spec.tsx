// @vitest-environment jsdom
// ArtifactDraftNodeView: the streaming draft card — a persistent bridge
// iframe whose srcdoc never reloads, receiving streamed html by postMessage.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import type { ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { ArtifactDraftNodeView } from '../src/client/stream/DraftSurface.tsx'

afterEach(cleanup)

function props(html: string): ChatNodeViewProps<'artifact-draft'> {
  return {
    node: {
      key: 'artifact-draft:1:2',
      kind: 'artifact-draft',
      id: '1:2',
      target: 'chat',
      anchorSeq: 1,
      location: { kind: 'unresolved' },
      visibility: 'visible',
      data: { callId: 'call_1', html },
    },
    t: ((key: string) => key) as ChatNodeViewProps<'artifact-draft'>['t'],
  } as unknown as ChatNodeViewProps<'artifact-draft'>
}

describe('ArtifactDraftNodeView', () => {
  it('renders the generating bar and a persistent bridge iframe', () => {
    const { container } = render(<ArtifactDraftNodeView {...props('<div>hi</div>')} />)
    expect(container.querySelector('[data-artifact-draft]')).not.toBeNull()
    expect(container.textContent).toContain('Generating HTML artifact')
    const frame = container.querySelector('iframe') as HTMLIFrameElement | null
    expect(frame).not.toBeNull()
    expect(frame!.getAttribute('sandbox')).toBe('allow-scripts')
    const srcDoc = frame!.getAttribute('srcdoc') ?? ''
    expect(srcDoc).toContain('Content-Security-Policy')
    expect(srcDoc).toContain('dsh-artifact-root')
  })

  it('pushes streamed html into the bridge iframe by postMessage on change', () => {
    const post = vi.fn()
    const { container, rerender } = render(<ArtifactDraftNodeView {...props('<div>v1</div>')} />)
    const frame = container.querySelector('iframe') as HTMLIFrameElement
    // jsdom does not build a usable contentWindow synchronously; stub it so
    // the effect's push is observable.
    Object.defineProperty(frame, 'contentWindow', { value: { postMessage: post }, configurable: true })
    rerender(<ArtifactDraftNodeView {...props('<div>v2</div>')} />)
    expect(post).toHaveBeenCalled()
    const sent = post.mock.calls.map(call => call[0])
    expect(sent.some(message => (message as { type?: string }).type === 'dsh-artifact-stream'
      && (message as { html?: string }).html === '<div>v2</div>')).toBe(true)
  })
})
