/**
 * The artifact tool's atomic view, registered under the `artifact` key of the
 * `tool.call.toolview` slot. Renders the stock ToolRow chrome (title, state
 * dot, disclosure, inspect) with an op-specific body.
 *
 * Timeline-snapshot semantics: every row renders the artifact as it was at
 * THAT call's settlement — a create row keeps the html it was created with, a
 * patch row shows the patched html directly (no diff, no cross-row sync), a
 * read row shows the returned source, destroy/list render their notes. The
 * settled rows are expanded by default: the preview is the point.
 *
 * The card is result-only: running calls show the generic pending row; a
 * settled call whose view is not a well-formed artifact card falls back to
 * the generic path (rendering nothing extra here).
 * @module
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  DisclosureRow, IconCodeOutline16, IconCopyOutline16, IconEditOutline16, IconInspectOutline12, IconSendOutline16, StateDot, writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'
// The stock row's stylesheet, imported through the package's exported src
// subpath and inlined — the row renders with the exact stock chrome.
import rowCss from '@deepseek-ai/dsh-client-ui-tool/src/client/tool/components/ToolRow.module.css'
import { artifactArgs, artifactCardModel, type ArtifactSummaryView, type ToolCallOwnerProps } from './contract.ts'
import { buildSandboxedHtmlDocument, hostArtifactTheme, type ArtifactTheme } from './sandbox.ts'
import { DraftSurface } from './stream/DraftSurface.tsx'
import { submitInteraction } from './stream/submit.ts'
import css from './artifact.module.css'

/** Row state semantic; colors self-supplied via StateDot. */
type ToolRowState = 'running' | 'ok' | 'error' | 'stopped'

/** Full props of the artifact row (the stock ToolCallOwnerProps currency). */
export type ArtifactRowProps = ToolCallOwnerProps

/** Render a one-line escape for the source view. */
function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Request the sandbox surface to collect its interaction data (bridge
 *  postMessage round-trip, bounded by a timeout). */
function collectFromFrame(frame: HTMLIFrameElement, resizeId: string): Promise<unknown | null> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (value: unknown | null) => {
      if (settled) return
      settled = true
      window.removeEventListener('message', onMessage)
      window.clearTimeout(timer)
      resolve(value)
    }
    const onMessage = (event: MessageEvent) => {
      const data = event.data
      if (event.source !== frame.contentWindow) return
      if (data === null || typeof data !== 'object') return
      if ((data as { type?: unknown }).type !== 'dsh-artifact-collect-result') return
      if ((data as { id?: unknown }).id !== resizeId) return
      finish((data as { data?: unknown }).data ?? null)
    }
    const timer = window.setTimeout(() => finish(null), 2500)
    window.addEventListener('message', onMessage)
    frame.contentWindow?.postMessage({ type: 'dsh-artifact-collect', id: resizeId }, '*')
  })
}

/** The sandboxed preview of ONE snapshot: an iframe built from the given html. */
function ArtifactSurface({ id, title, revision, html }: {
  id: string
  title?: string | undefined
  revision: number
  html: string
}) {
  const [view, setView] = useState<'preview' | 'source'>('preview')
  const [height, setHeight] = useState(240)
  const [copied, setCopied] = useState(false)
  const [submitState, setSubmitState] = useState<'idle' | 'collecting' | 'submitted' | 'error'>('idle')
  const [theme] = useState<ArtifactTheme>(hostArtifactTheme)
  const frameRef = useRef<HTMLIFrameElement>(null)
  const resizeId = useId()
  const srcDoc = useMemo(() => buildSandboxedHtmlDocument(html, resizeId, theme), [html, resizeId, theme])

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data
      if (data === null || typeof data !== 'object') return
      if ((data as { type?: unknown }).type !== 'dsh-artifact-resize') return
      if ((data as { id?: unknown }).id !== resizeId) return
      if (event.source !== frameRef.current?.contentWindow) return
      const measured = Number((data as { height?: unknown }).height)
      if (Number.isFinite(measured)) {
        setHeight(Math.min(4000, Math.max(120, Math.round(measured))))
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [resizeId])

  const onCopy = async () => {
    if (await writeClipboard(html)) {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    }
  }

  const onSubmit = async () => {
    const frame = frameRef.current
    if (frame === null) return
    setSubmitState('collecting')
    const data = await collectFromFrame(frame, resizeId)
    if (data === null) {
      setSubmitState('error')
      return
    }
    const ok = await submitInteraction(id, title, data)
    setSubmitState(ok ? 'submitted' : 'error')
    if (ok) {
      window.setTimeout(() => setSubmitState('idle'), 2500)
    }
  }

  return (
    <div className={css.surface} data-artifact-surface="">
      <div className={css.toolbar}>
        <span className={css.toolbarTitle}>{title ?? `Artifact ${id}`}</span>
        <span className={css.badge}>rev {revision}</span>
      </div>
      {view === 'preview'
        ? <iframe
            ref={frameRef}
            className={css.frame}
            sandbox="allow-scripts"
            srcDoc={srcDoc}
            style={{ height }}
            title={`HTML artifact ${id}`}
          />
        : <pre className={css.source}>{html}</pre>}
      {/* The action row sits BELOW the rendered content: Source/Copy for the
          artifact, and the interaction submit — the user interacts with the
          artifact first, then acts on it. */}
      {view === 'preview' && (
        <div className={css.submitBar} data-artifact-actions="">
          <button type="button" className={css.toolButton} onClick={() => setView(v => v === 'preview' ? 'source' : 'preview')}>
            <IconCodeOutline16 size={14} />
            {view === 'preview' ? 'Source' : 'Preview'}
          </button>
          <button type="button" className={css.toolButton} onClick={onCopy}>
            <IconCopyOutline16 size={14} />
            {copied ? 'Copied' : 'Copy HTML'}
          </button>
          <button type="button" className={css.toolButton} onClick={onSubmit} disabled={submitState === 'collecting'}>
            <IconSendOutline16 size={14} />
            {submitState === 'collecting' ? 'Collecting…'
              : submitState === 'submitted' ? 'Submitted ✓'
                : submitState === 'error' ? 'Failed'
                  : 'Submit interaction'}
          </button>
        </div>
      )}
    </div>
  )
}

/** The returned source of a read call, capped to a sane preview length. */
function SourceView({ html, truncated }: { html: string; truncated?: boolean }) {
  const capped = html.split('\n').slice(0, 200).join('\n')
  return (
    <pre className={css.source} data-artifact-source="">
      {escapeHtml(capped)}
      {truncated !== undefined && truncated && '\n… (source truncated in the read result)'}
    </pre>
  )
}

/** The session's artifact summaries from a list call. */
function ArtifactList({ artifacts }: { artifacts: ArtifactSummaryView[] }) {
  if (artifacts.length === 0) {
    return <div className={css.closed} data-artifact-list="">(no HTML artifacts in this session)</div>
  }
  return (
    <div className={css.list} data-artifact-list="">
      {artifacts.map((summary) => (
        <div key={summary.id} className={css.listRow}>
          <span className={css.listId}>{summary.id}</span>
          {summary.title !== undefined && <span className={css.listTitle}>{summary.title}</span>}
          <span className={css.badge}>rev {summary.revision}</span>
          <span className={css.badge}>{summary.bytes} bytes</span>
        </div>
      ))}
    </div>
  )
}

/** Derive the row's pending/completed title for the artifact op. */
function rowTitle(op: string, id: string | undefined): string {
  switch (op) {
    case 'create': return id === undefined ? 'Create HTML artifact' : `HTML artifact ${id}`
    case 'patch': return `Patch artifact ${id ?? ''}`
    case 'read': return `Read artifact ${id ?? ''}`
    case 'destroy': return `Destroy artifact ${id ?? ''}`
    case 'list': return 'List HTML artifacts'
    default: return 'HTML artifact'
  }
}

/** The artifact row: stock ToolRow chrome with the op-specific body. Only the
 *  rendering ops (create/patch — and the streaming create draft) expand by
 *  default; read/destroy/list stay collapsed until clicked. */
export function ArtifactRow({ toolName, block, cwd, openFile, inspect }: ArtifactRowProps) {
  const model = artifactCardModel(block)
  const args = artifactArgs(block)
  const done = 'kind' in block
  const op = (model === null ? args?.op : model.view.op) ?? (args?.op ?? 'unknown')
  const [expanded, setExpanded] = useState(op === 'create' || op === 'patch')
  const id = model !== null && 'id' in model.view ? model.view.id : args?.id
  const title = rowTitle(op, id)
  const summary = model !== null && 'id' in model.view && model.view.op === 'create'
    ? (model.view.title ?? model.view.id)
    : model !== null && model.view.op === 'list'
      ? `${model.view.artifacts.length} artifact${model.view.artifacts.length === 1 ? '' : 's'}`
      : id !== undefined ? id : (args?.title ?? '')
  const state: ToolRowState = !done ? 'running'
    : block.error?.code === 'interrupted' ? 'stopped'
      : block.isError ? 'error' : 'ok'

  // Running create: the streaming bridge iframe (the tool row IS the draft).
  // Settled: the op-specific timeline-snapshot body.
  const body = !done
    ? (op === 'create' && args?.html !== undefined ? <DraftSurface html={args.html} /> : null)
    : model === null ? null : (() => {
      const view = model.view
      switch (view.op) {
        case 'create': return (
          <ArtifactSurface id={view.id} revision={view.revision} html={view.html}
            {...view.title !== undefined ? { title: view.title } : {}} />
        )
        case 'patch': return (
          // The patch row renders the NEW html directly — the timeline shows the
          // artifact as it was at each call, no diff and no cross-row sync.
          <ArtifactSurface id={view.id} revision={view.revision} html={view.html} />
        )
        case 'read': return <SourceView html={view.html} truncated={view.truncated === true} />
        case 'destroy': return <div className={css.closed}>Artifact {view.id} closed.</div>
        case 'list': return <ArtifactList artifacts={view.artifacts} />
      }
    })()
  const expandable = body !== null
  const open = expanded && expandable
  const toggleExpand = () => { setExpanded(v => !v) }
  const failureLine = state === 'error' ? summary : null

  return (
    <div className={rowCss.root} data-variant="edit" data-tool={toolName} data-state={state} data-artifact-row="">
      {state === 'running' && <span className={rowCss.visuallyHidden}>Running</span>}
      <DisclosureRow
        rowClassName={rowCss.row}
        leadingClassName={rowCss.leading}
        titleClassName={rowCss.title}
        chevronClassName={rowCss.chevron}
        icon={state === 'error' ? <StateDot state="error" />
          : state === 'stopped' ? <StateDot state="warning" />
            : state === 'running' ? <StateDot state="ongoing" />
              : <IconEditOutline16 size={14} />}
        title={title}
        open={open}
        expandable={expandable}
        expandOnRowClick
        keepContentWhenOpen
        onToggle={toggleExpand}
        collapsedContent={summary !== '' && (
          <>
            <span className={rowCss.sep} aria-hidden />
            {failureLine !== null ? (
              <span className={`${rowCss.summary} ${rowCss.errorSummary}`}>{failureLine}</span>
            ) : (
              <span className={rowCss.summary}>{summary}</span>
            )}
          </>
        )}
      >
        <div className={rowCss.bodyWrap}>
          {body}
          {inspect !== undefined && (
            <button type="button" className={rowCss.inspectButton} onClick={inspect}>
              <IconInspectOutline12 />
              Inspect
            </button>
          )}
        </div>
      </DisclosureRow>
    </div>
  )
}
