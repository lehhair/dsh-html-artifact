/**
 * The artifact tool's atomic view, registered under the `artifact` key of the
 * `tool.call.toolview` slot. Renders the stock ToolRow chrome (title, state
 * dot, disclosure, inspect) with an op-specific body:
 *
 * - create: the LIVE sandboxed preview (iframes are keyed by artifact id
 *   through the module store, so later patch calls update this surface in
 *   place), plus a toolbar with revision badge, view-source toggle and copy.
 * - patch: the applied old/new replacement and a note that the live preview
 *   updated in place.
 * - read: the returned source in a capped plain view.
 * - destroy: a closed note.
 * - list: the session's artifact summaries.
 *
 * The card is result-only: running calls show the generic pending row; a
 * settled call whose view is not a well-formed artifact card falls back to
 * the generic path (rendering nothing extra here).
 * @module
 */
import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import {
  DisclosureRow, IconCodeOutline16, IconCopyOutline16, IconEditOutline16, IconInspectOutline12, StateDot, writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'
// The stock row's stylesheet, imported through the package's exported src
// subpath and inlined — the row renders with the exact stock chrome.
import rowCss from '@deepseek-ai/dsh-client-ui-tool/src/client/tool/components/ToolRow.module.css'
import { artifactArgs, artifactCardModel, type ArtifactSummaryView, type ToolCallOwnerProps } from './contract.ts'
import { buildSandboxedHtmlDocument, hostArtifactTheme, type ArtifactTheme } from './sandbox.ts'
import { getArtifact, removeArtifact, setArtifact, subscribeArtifact } from './store.ts'
import css from './artifact.module.css'

/** Row state semantic; colors self-supplied via StateDot. */
type ToolRowState = 'running' | 'ok' | 'error' | 'stopped'

/** Full props of the artifact row (the stock ToolCallOwnerProps currency). */
export type ArtifactRowProps = ToolCallOwnerProps

/** Render a one-line escape for the source view. */
function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** The live preview: a sandboxed iframe that follows the artifact's newest state. */
function ArtifactSurface({ id }: { id: string }) {
  const entry = useSyncExternalStore(
    (callback) => subscribeArtifact(id, callback),
    () => getArtifact(id),
    () => getArtifact(id),
  )
  const [view, setView] = useState<'preview' | 'source'>('preview')
  const [height, setHeight] = useState(240)
  const [copied, setCopied] = useState(false)
  const [theme] = useState<ArtifactTheme>(hostArtifactTheme)
  const frameRef = useRef<HTMLIFrameElement>(null)
  const resizeId = useId()
  const srcDoc = useMemo(
    () => entry === undefined ? undefined : buildSandboxedHtmlDocument(entry.html, resizeId, theme),
    [entry, resizeId, theme],
  )

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
    if (entry === undefined) return
    if (await writeClipboard(entry.html)) {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    }
  }

  if (entry === undefined) {
    return <div className={css.closed}>Artifact closed.</div>
  }
  return (
    <div className={css.surface} data-artifact-surface="">
      <div className={css.toolbar}>
        <span className={css.toolbarTitle}>{entry.title ?? `Artifact ${entry.id}`}</span>
        <span className={css.badge}>rev {entry.revision}</span>
        <button type="button" className={css.toolButton} onClick={() => setView(v => v === 'preview' ? 'source' : 'preview')}>
          <IconCodeOutline16 size={14} />
          {view === 'preview' ? 'Source' : 'Preview'}
        </button>
        <button type="button" className={css.toolButton} onClick={onCopy}>
          <IconCopyOutline16 size={14} />
          {copied ? 'Copied' : 'Copy HTML'}
        </button>
      </div>
      {view === 'preview'
        ? <iframe
            ref={frameRef}
            className={css.frame}
            sandbox="allow-scripts"
            srcDoc={srcDoc}
            style={{ height }}
            title={`HTML artifact ${entry.id}`}
          />
        : <pre className={css.source}>{entry.html}</pre>}
    </div>
  )
}

/** The applied replacement of one patch call, drawn as a compact old/new pair. */
function PatchDiff({ revision, applied, oldString, newString }: {
  revision: number
  applied: number
  oldString: string
  newString: string
}) {
  const oldLines = oldString.split('\n').slice(0, 10)
  const newLines = newString.split('\n').slice(0, 10)
  return (
    <div className={css.patch} data-artifact-patch="">
      <div className={css.patchNote}>
        Patched to revision {revision} — {applied} occurrence{applied === 1 ? '' : 's'} replaced; the live preview updated in place.
      </div>
      <div className={css.patchGrid}>
        <div className={css.patchSide} aria-label="Before">
          {oldLines.map((line, index) => (
            <div key={index} className={css.patchLineOld}><span className={css.patchSign}>−</span>{line || ' '}</div>
          ))}
        </div>
        <div className={css.patchSide} aria-label="After">
          {newLines.map((line, index) => (
            <div key={index} className={css.patchLineNew}><span className={css.patchSign}>+</span>{line || ' '}</div>
          ))}
        </div>
      </div>
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

/** The artifact row: stock ToolRow chrome with the op-specific body. */
export function ArtifactRow({ toolName, block, inspect }: ArtifactRowProps) {
  const [expanded, setExpanded] = useState(false)
  const model = artifactCardModel(block)
  const args = artifactArgs(block)
  const done = 'kind' in block
  const op = (model === null ? args?.op : model.view.op) ?? (args?.op ?? 'unknown')
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

  // Keep the module store in sync with every settled artifact card so the live
  // surface (and any later replay) sees the newest revision.
  useEffect(() => {
    const view = model?.view
    if (view === undefined) return
    if (view.op === 'create' || view.op === 'patch' || view.op === 'read') {
      setArtifact({
        id: view.id, revision: view.revision, html: view.html,
        ...view.title !== undefined ? { title: view.title } : {},
      })
    } else if (view.op === 'destroy') {
      removeArtifact(view.id)
    }
  }, [model])

  const body = model === null ? null : (() => {
    const view = model.view
    switch (view.op) {
      case 'create': return <ArtifactSurface id={view.id} />
      case 'patch': return (
        <PatchDiff
          revision={view.revision}
          applied={view.applied ?? 1}
          oldString={args?.oldString ?? ''}
          newString={args?.newString ?? ''}
        />
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
