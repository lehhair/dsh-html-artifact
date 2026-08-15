// @vitest-environment jsdom
// ArtifactDraftNodeView: the streaming-period chat node adapter — it renders
// the artifact TOOL ROW itself (ArtifactRow) with a synthetic running block,
// so the streamed draft and the settled snapshot are the same surface.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import type { ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { ArtifactDraftNodeView } from '../src/client/stream/DraftSurface.tsx'

afterEach(cleanup)

function props(html: string, title?: string): ChatNodeViewProps<'artifact-draft'> {
  return {
    node: {
      key: 'artifact-draft:1:2',
      kind: 'artifact-draft',
      id: '1:2',
      target: 'chat',
      anchorSeq: 1,
      location: { kind: 'unresolved' },
      visibility: 'visible',
      data: { callId: 'call_1', html, ...title === undefined ? {} : { title } },
    },
    openFile: () => {},
    inspectCall: () => {},
    forkAt: () => {},
    loadImage: async () => '',
    fileMentions: () => undefined,
    t: ((key: string) => key) as ChatNodeViewProps<'artifact-draft'>['t'],
  } as unknown as ChatNodeViewProps<'artifact-draft'>
}

describe('ArtifactDraftNodeView', () => {
  it('renders the artifact TOOL ROW (not a separate card) with a bridge iframe body, expanded by default', () => {
    const { container } = render(<ArtifactDraftNodeView {...props('<div>hi</div>', 'Demo')} />)
    // The row is the artifact tool row itself.
    const row = container.querySelector('[data-artifact-row]')
    expect(row).not.toBeNull()
    expect(container.textContent).toContain('Create HTML artifact')
    expect(container.textContent).toContain('Demo')
    // Expanded by default: the bridge iframe body is immediately visible.
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
