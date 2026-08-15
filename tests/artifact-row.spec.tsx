// @vitest-environment jsdom
// ArtifactRow: the `artifact` tool's atomic view with timeline-snapshot
// semantics — every settled row renders the artifact as it was at THAT call:
// a create row keeps its create-time html (later patch rows never touch it),
// a patch row shows the patched html DIRECTLY (no diff, no cross-row sync).
// Only the rendering ops (create/patch) expand by default. The block fixtures
// mirror the runtime's frozen nodes.

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

/** Expand the disclosure row (read/destroy/list rows start collapsed). */
function openRow(container: HTMLElement): void {
  const row = container.querySelector('[data-disclosure-row]')
  if (row === null) throw new Error('no disclosure row')
  fireEvent.click(row)
}

describe('artifactCardModel', () => {
  it('renders the streaming bridge iframe while a create call is running (the tool row IS the draft)', () => {
    const { container } = render(<ArtifactRow {...rowProps(running({ op: 'create', html: '<div>streaming</div>' }))} />)
    const frame = container.querySelector('iframe') as HTMLIFrameElement | null
    expect(frame).not.toBeNull()
    expect(frame!.getAttribute('srcdoc')).toContain('dsh-artifact-root')
    expect(container.textContent).toContain('Create HTML artifact')
  })

  it('renders no body for a running non-create call', () => {
    const { container } = render(<ArtifactRow {...rowProps(running({ op: 'list' }))} />)
    expect(container.querySelector('iframe')).toBeNull()
  })

  it('renders no body for a non-artifact view', () => {
    const { container } = render(<ArtifactRow {...rowProps(settled({ op: 'create' }, { card: 'generic', title: 'x' }))} />)
    expect(container.querySelector('[data-artifact-surface]')).toBeNull()
  })
})

describe('timeline snapshots', () => {
  it('create row is expanded by default and renders its create-time html', () => {
    const { container } = render(<ArtifactRow {...rowProps(settled(
      { op: 'create', title: 'Demo', html: '<div>v1</div>' },
      { card: 'artifact', op: 'create', id: 'art-s1', revision: 1, title: 'Demo', html: '<div>v1</div>' },
    ))} />)
    // No click: the row opens itself.
    const frame = container.querySelector('iframe') as HTMLIFrameElement | null
    expect(frame).not.toBeNull()
    expect(frame!.getAttribute('sandbox')).toBe('allow-scripts')
    const srcDoc = frame!.getAttribute('srcdoc') ?? ''
    expect(srcDoc).toContain('Content-Security-Policy')
    expect(srcDoc).toContain('<div>v1</div>')
    expect(container.textContent).toContain('rev 1')
    expect(container.textContent).toContain('Demo')
  })

  it('patch row renders the patched html DIRECTLY, with no diff', () => {
    const { container } = render(<ArtifactRow {...rowProps(settled(
      { op: 'patch', id: 'art-s2', old_string: 'v1', new_string: 'v2' },
      { card: 'artifact', op: 'patch', id: 'art-s2', revision: 2, html: '<div>v2</div>', applied: 1 },
    ))} />)
    const frame = container.querySelector('iframe') as HTMLIFrameElement | null
    expect(frame).not.toBeNull()
    expect(frame!.getAttribute('srcdoc') ?? '').toContain('<div>v2</div>')
    // No old/new diff anywhere in the row.
    expect(container.textContent).not.toContain('occurrence replaced')
    expect(container.querySelector('[data-artifact-patch]')).toBeNull()
    expect(container.textContent).toContain('rev 2')
  })

  it('a later patch row never rewrites an earlier create row (each row keeps its snapshot)', () => {
    const { container } = render(<ArtifactRow {...rowProps(settled(
      { op: 'create', html: '<div>v1</div>' },
      { card: 'artifact', op: 'create', id: 'art-s3', revision: 1, html: '<div>v1</div>' },
    ))} />)
    const createFrame = container.querySelector('iframe') as HTMLIFrameElement
    expect(createFrame.getAttribute('srcdoc')).toContain('<div>v1</div>')

    // A second, independent row for the same artifact id patches it.
    render(<ArtifactRow {...rowProps(settled(
      { op: 'patch', id: 'art-s3', old_string: 'v1', new_string: 'v2' },
      { card: 'artifact', op: 'patch', id: 'art-s3', revision: 2, html: '<div>v2</div>', applied: 1 },
    ))} />)

    // The create row's iframe still shows v1; the patch row shows v2.
    expect(createFrame.getAttribute('srcdoc')).toContain('<div>v1</div>')
    expect(createFrame.getAttribute('srcdoc')).not.toContain('<div>v2</div>')
  })

  it('toggle button switches between preview and source; the action row persists with Preview', () => {
    const { container } = render(<ArtifactRow {...rowProps(settled(
      { op: 'create', html: '<p>x</p>' },
      { card: 'artifact', op: 'create', id: 'art-s4', revision: 1, html: '<p>x</p>' },
    ))} />)
    const frame = container.querySelector('iframe')
    expect(frame).not.toBeNull()
    const actions = container.querySelector('[data-artifact-actions]') as HTMLElement
    expect(actions).not.toBeNull()
    const sourceButton = Array.from(actions.querySelectorAll('button')).find(button => button.textContent?.includes('Source'))
    expect(sourceButton).not.toBeUndefined()
    fireEvent.click(sourceButton!)
    expect(container.querySelector('iframe')).toBeNull()
    expect(container.querySelector('pre')).not.toBeNull()
    // The action row persists in source view with the Preview button to return.
    const actionsAfter = container.querySelector('[data-artifact-actions]') as HTMLElement
    expect(actionsAfter).not.toBeNull()
    const previewButton = Array.from(actionsAfter.querySelectorAll('button')).find(button => button.textContent?.includes('Preview'))
    expect(previewButton).not.toBeUndefined()
    fireEvent.click(previewButton!)
    expect(container.querySelector('iframe')).not.toBeNull()
  })

  it('renders title, revision, Source, Copy, and Submit BELOW the preview in one action row', () => {
    const { container } = render(<ArtifactRow {...rowProps(settled(
      { op: 'create', title: 'Demo', html: '<input name="x">' },
      { card: 'artifact', op: 'create', id: 'art-s5', revision: 1, title: 'Demo', html: '<input name="x">' },
    ))} />)
    const actions = container.querySelector('[data-artifact-actions]')
    expect(actions).not.toBeNull()
    expect(actions!.textContent).toContain('Demo')
    expect(actions!.textContent).toContain('rev 1')
    const labels = Array.from(actions!.querySelectorAll('button')).map(button => button.textContent ?? '')
    expect(labels.some(text => text.includes('Source'))).toBe(true)
    expect(labels.some(text => text.includes('Copy HTML'))).toBe(true)
    expect(labels.some(text => text.includes('Submit interaction'))).toBe(true)
    // The action row sits after the iframe in the surface's flow.
    const frame = container.querySelector('iframe') as HTMLIFrameElement
    const surface = container.querySelector('[data-artifact-surface]') as HTMLElement
    const frameIndex = Array.from(surface.children).indexOf(frame)
    const actionsIndex = Array.from(surface.children).indexOf(actions as HTMLElement)
    expect(frameIndex).toBeGreaterThanOrEqual(0)
    expect(actionsIndex).toBeGreaterThan(frameIndex)
  })
})

describe('read, destroy and list rows', () => {
  it('renders the read source in a capped view (collapsed by default)', () => {
    const { container } = render(<ArtifactRow {...rowProps(settled(
      { op: 'read', id: 'art-r1' },
      { card: 'artifact', op: 'read', id: 'art-r1', revision: 3, html: '<i>raw &amp; source</i>' },
    ))} />)
    // read is not a rendering op: collapsed until clicked.
    expect(container.querySelector('[data-artifact-source]')).toBeNull()
    openRow(container)
    const pre = container.querySelector('[data-artifact-source]')
    expect(pre).not.toBeNull()
    // The source renders escaped as text (never as markup): the <i> tags show
    // literally and the & in the source is double-escaped by escapeHtml.
    expect(pre!.textContent).toContain('&lt;i&gt;')
    expect(pre!.textContent).toContain('&amp;amp;')
    expect(pre!.textContent).toContain('raw')
  })

  it('renders a destroy note (collapsed by default)', () => {
    const { container } = render(<ArtifactRow {...rowProps(settled(
      { op: 'destroy', id: 'art-d1' },
      { card: 'artifact', op: 'destroy', id: 'art-d1' },
    ))} />)
    expect(container.querySelector('[data-artifact-row]')!.textContent).not.toContain('closed')
    openRow(container)
    expect(container.querySelector('[data-artifact-row]')!.textContent).toContain('closed')
  })

  it('renders the list summaries (collapsed by default)', () => {
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
    expect(container.querySelector('[data-artifact-list]')).toBeNull()
    openRow(container)
    const list = container.querySelector('[data-artifact-list]')
    expect(list).not.toBeNull()
    expect(list!.textContent).toContain('art-a1')
    expect(list!.textContent).toContain('Demo')
    expect(list!.textContent).toContain('art-b2')
  })

  it('renders an empty-list note (collapsed by default)', () => {
    const { container } = render(<ArtifactRow {...rowProps(settled(
      { op: 'list' },
      { card: 'artifact', op: 'list', artifacts: [] },
    ))} />)
    expect(container.querySelector('[data-artifact-list]')).toBeNull()
    openRow(container)
    expect(container.querySelector('[data-artifact-list]')!.textContent).toContain('no HTML artifacts')
  })
})
