/**
 * The `artifact-draft` chat node renderer: a compact live card showing the
 * model's streaming create html inside a PERSISTENT bridge iframe. Streamed
 * html updates arrive by postMessage (the iframe never reloads); the card
 * carries a "generating" bar and sits in the chat flow at the step where the
 * model started writing the call. It disappears automatically when the call
 * is announced or settled — the keyed tool row owns the settled display.
 * @module
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
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

/** The keyed `artifact-draft` chat node view. */
export function ArtifactDraftNodeView({ node }: ChatNodeViewProps<'artifact-draft'>) {
  const { callId, html } = node.data
  return (
    <div className={css.draft} data-artifact-draft="">
      <div className={css.draftBar}>
        <span className={css.draftPulse} aria-hidden />
        <span className={css.draftLabel}>Generating HTML artifact {callId}…</span>
      </div>
      <DraftSurface html={html} />
    </div>
  )
}
