// @vitest-environment jsdom
// ArtifactRow: the `artifact` tool's atomic view — the create row's sandboxed
// live preview (srcdoc carries the CSP head + the artifact html), the patch
// row rendering BOTH the live surface and the applied old/new replacement, the
// cross-call live update through the module store, the destroy/list/read
// bodies, and the generic fallbacks for running/unknown calls. Rows are
// expanded by default (the preview is the point), so bodies are visible
// without a click. The block fixtures mirror the runtime's frozen nodes.

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import type { RunningToolCall, ToolCallBlock, ToolResultNode } from '@deepseek-ai/dsh-client-runtime/client'
import { ArtifactRow, type ArtifactRowProps } from '../src/client/ArtifactRow.tsx'

afterEach(cleanup)

/** A running (call-only) artifact block. */
function running(args: unknown): RunningToolCall {
  return {
    callId: 'c1',
    name: 'artifact',
    argsRaw: JSON.stringify(args),
    turn: 1,
    step: 1,
    time: 0,
    callView: { card: 'generic', title: 'Create HTML artifact' },
    subCalls: [],
  }
}

/** A settled artifact block with the given args and wire result view. */
function settled(args: unknown, resultView: unknown): ToolResultNode {
  return {
    kind: 'tool-result',
    seq: 1,
    time: 0,
    callId: 'c1',
    call: { name: 'artifact', argsRaw: JSON.stringify(args) },
    callTime: 0,
    content: [{ type: 'text', text: 'ok' }],
    isError: false,
    callView: null,
    resultView: resultView as ToolResultNode['resultView'],
    subCalls: [],
  }
}

function rowProps(block: ToolCallBlock): ArtifactRowProps {
  return { callId: 'c1', toolName: 'artifact', block, openFile: () => {}, inspect: undefined, cwd: undefined }
}

describe('artifactCardModel', () => {
  it('renders no body for a running call (result-only card)', () => {
    const { container } = render(<ArtifactRow {...rowProps(running({ op: 'create' }))} />)
    expect(container.querySelector('[data-artifact-surface]')).toBeNull()
  })

  it('renders no body for a non-artifact view', () => {
    const { container } = render(<ArtifactRow {...rowProps(settled({ op: 'create' }, { card: 'generic', title: 'x' }))} />)
    expect(container.querySelector('[data-artifact-surface]')).toBeNull()
    expect(container.querySelector('[data-artifact-patch]')).toBeNull()
  })
})

describe('create row', () => {
  it('is expanded by default and renders the sandboxed preview iframe with the CSP head and the artifact html', () => {
    const { container } = render(<ArtifactRow {...rowProps(settled(
      { op: 'create', title: 'Demo', html: '<div>hi</div>' },
      { card: 'artifact', op: 'create', id: 'art-demo1', revision: 1, title: 'Demo', html: '<div>hi</div>' },
    ))} />)
    // No click: the row opens itself.
    const frame = container.querySelector('iframe') as HTMLIFrameElement | null
    expect(frame).not.toBeNull()
    expect(frame!.getAttribute('sandbox')).toBe('allow-scripts')
    const srcDoc = frame!.getAttribute('srcdoc') ?? ''
    expect(srcDoc).toContain('Content-Security-Policy')
    expect(srcDoc).toContain('<div>hi</div>')
    expect(container.textContent).toContain('rev 1')
    expect(container.textContent).toContain('Demo')
  })

  it('toggle button switches between preview and source', () => {
    const { container } = render(<ArtifactRow {...rowProps(settled(
      { op: 'create', html: '<p>x</p>' },
      { card: 'artifact', op: 'create', id: 'art-demo2', revision: 1, html: '<p>x</p>' },
    ))} />)
    const frame = container.querySelector('iframe')
    expect(frame).not.toBeNull()
    const buttons = Array.from(container.querySelectorAll('button'))
    const sourceButton = buttons.find(button => button.textContent?.includes('Source'))
    expect(sourceButton).not.toBeUndefined()
    fireEvent.click(sourceButton!)
    expect(container.querySelector('iframe')).toBeNull()
    expect(container.querySelector('pre')).not.toBeNull()
  })
})

describe('patch row and the live cross-call update', () => {
  it('renders BOTH the live surface and the applied old/new replacement', () => {
    const { container } = render(<ArtifactRow {...rowProps(settled(
      { op: 'patch', id: 'art-p1', old_string: 'hello', new_string: 'world' },
      { card: 'artifact', op: 'patch', id: 'art-p1', revision: 2, html: '<div>world</div>', applied: 1 },
    ))} />)
    const patch = container.querySelector('[data-artifact-patch]')
    expect(patch).not.toBeNull()
    expect(patch!.textContent).toContain('revision 2')
    expect(patch!.textContent).toContain('1 occurrence replaced')
    expect(patch!.textContent).toContain('hello')
    expect(patch!.textContent).toContain('world')
    // The same row also renders the live preview, showing the patched html.
    const frame = container.querySelector('iframe') as HTMLIFrameElement | null
    expect(frame).not.toBeNull()
    expect(frame!.getAttribute('srcdoc') ?? '').toContain('<div>world</div>')
  })

  it('updates the create row\'s live preview when a later patch call settles', () => {
    const createBlock = settled(
      { op: 'create', html: '<div>v1</div>' },
      { card: 'artifact', op: 'create', id: 'art-live1', revision: 1, html: '<div>v1</div>' },
    )
    const { container } = render(<ArtifactRow {...rowProps(createBlock)} />)
    const before = (container.querySelector('iframe') as HTMLIFrameElement).getAttribute('srcdoc') ?? ''
    expect(before).toContain('<div>v1</div>')

    // A second, independent row for the same artifact id patches it; its mount
    // effect feeds the module store, which re-renders every surface for the id.
    render(<ArtifactRow {...rowProps(settled(
      { op: 'patch', id: 'art-live1', old_string: 'v1', new_string: 'v2' },
      { card: 'artifact', op: 'patch', id: 'art-live1', revision: 2, html: '<div>v2</div>', applied: 1 },
    ))} />)

    const after = (container.querySelector('iframe') as HTMLIFrameElement).getAttribute('srcdoc') ?? ''
    expect(after).toContain('<div>v2</div>')
    expect(after).not.toContain('<div>v1</div>')
  })

  it('shows the closed state after a destroy call for the same id', () => {
    const { container } = render(<ArtifactRow {...rowProps(settled(
      { op: 'create', html: '<div>x</div>' },
      { card: 'artifact', op: 'create', id: 'art-gone1', revision: 1, html: '<div>x</div>' },
    ))} />)
    render(<ArtifactRow {...rowProps(settled(
      { op: 'destroy', id: 'art-gone1' },
      { card: 'artifact', op: 'destroy', id: 'art-gone1' },
    ))} />)
    expect(container.querySelector('[data-artifact-row]')!.textContent).toContain('Artifact closed.')
  })
})

describe('read, destroy and list rows', () => {
  it('renders the read source in a capped view', () => {
    const { container } = render(<ArtifactRow {...rowProps(settled(
      { op: 'read', id: 'art-r1' },
      { card: 'artifact', op: 'read', id: 'art-r1', revision: 3, html: '<i>raw &amp; source</i>' },
    ))} />)
    const pre = container.querySelector('[data-artifact-source]')
    expect(pre).not.toBeNull()
    // The source renders escaped as text (never as markup): the <i> tags show
    // literally and the & in the source is double-escaped by escapeHtml.
    expect(pre!.textContent).toContain('&lt;i&gt;')
    expect(pre!.textContent).toContain('&amp;amp;')
    expect(pre!.textContent).toContain('raw')
  })

  it('renders a destroy note', () => {
    const { container } = render(<ArtifactRow {...rowProps(settled(
      { op: 'destroy', id: 'art-d1' },
      { card: 'artifact', op: 'destroy', id: 'art-d1' },
    ))} />)
    expect(container.querySelector('[data-artifact-row]')!.textContent).toContain('closed')
  })

  it('renders the list summaries', () => {
    const { container } = render(<ArtifactRow {...rowProps(settled(
      { op: 'list' },
      {
        card: 'artifact', op: 'list',
        artifacts: [
          { id: 'art-a1', revision: 2, bytes: 12, title: 'Demo' },
          { id: 'art-b2', revision: 1, bytes: 0 },
        ],
      },
    ))} />)
    const list = container.querySelector('[data-artifact-list]')
    expect(list).not.toBeNull()
    expect(list!.textContent).toContain('art-a1')
    expect(list!.textContent).toContain('Demo')
    expect(list!.textContent).toContain('art-b2')
  })

  it('renders an empty-list note', () => {
    const { container } = render(<ArtifactRow {...rowProps(settled(
      { op: 'list' },
      { card: 'artifact', op: 'list', artifacts: [] },
    ))} />)
    expect(container.querySelector('[data-artifact-list]')!.textContent).toContain('no HTML artifacts')
  })
})
