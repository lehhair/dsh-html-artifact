/**
 * The `artifact-draft` chat node renderer: the artifact TOOL ROW itself, shown
 * from the moment the model starts writing the create call — the fastest
 * possible tool surface. The row uses the exact stock ToolRow chrome
 * (DisclosureRow, running state dot, expanded by default) and its body is a
 * PERSISTENT bridge iframe whose content streams in by postMessage as the
 * model writes the html (the iframe never reloads). When the call is
 * announced or settles, the draft row disappears and the keyed toolview row —
 * the same chrome, the settled snapshot — takes over seamlessly.
 * @module
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { DisclosureRow, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import rowCss from '@deepseek-ai/dsh-client-ui-tool/src/client/tool/components/ToolRow.module.css'
import { hostArtifactTheme, type ArtifactTheme } from '../sandbox.ts'
import { buildStreamingBridgeDocument } from './bridge.ts'
import css from '../artifact.module.css'

/** The persistent bridge iframe: receives streamed html by postMessage. */
function DraftSurface({ html }: { html: string }) {
  const [height, setHeight] = useState(200)
  const [theme] = useState<ArtifactTheme>(hostArtifactTheme)
  const frameRef = useRef<HTMLIFrameElement>(null)
  const resizeId = useId()
  const srcDoc = useMemo(() => buildStreamingBridgeDocument(resizeId, theme), [resizeId, theme])

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

  // Push the newest streamed html into the persistent bridge document. The
  // html ref is read at send time so a fast chunk burst coalesces into the
  // latest postMessage without re-rendering the iframe.
  useEffect(() => {
    frameRef.current?.contentWindow?.postMessage({ type: 'dsh-artifact-stream', html }, '*')
  }, [html])

  return (
    <iframe
      ref={frameRef}
      className={css.frame}
      sandbox="allow-scripts"
      srcDoc={srcDoc}
      style={{ height }}
      title="Generating HTML artifact"
    />
  )
}

/** The keyed `artifact-draft` chat node view: the streaming tool row. */
export function ArtifactDraftNodeView({ node }: ChatNodeViewProps<'artifact-draft'>) {
  const [expanded, setExpanded] = useState(true)
  const { callId, html, title } = node.data
  const summary = title ?? callId
  return (
    <div className={rowCss.root} data-variant="edit" data-tool="artifact" data-state="running" data-artifact-draft-row="">
      <span className={rowCss.visuallyHidden}>Running</span>
      <DisclosureRow
        rowClassName={rowCss.row}
        leadingClassName={rowCss.leading}
        titleClassName={rowCss.title}
        chevronClassName={rowCss.chevron}
        icon={<StateDot state="ongoing" />}
        title="Create HTML artifact"
        open={expanded}
        expandable
        expandOnRowClick
        keepContentWhenOpen
        onToggle={() => setExpanded(v => !v)}
        collapsedContent={summary !== '' && (
          <>
            <span className={rowCss.sep} aria-hidden />
            <span className={rowCss.summary}>{summary}</span>
          </>
        )}
      >
        <div className={rowCss.bodyWrap}>
          <DraftSurface html={html} />
        </div>
      </DisclosureRow>
    </div>
  )
}
