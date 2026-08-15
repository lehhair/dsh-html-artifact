/**
 * The streaming bridge surface and the `artifact-draft` chat node adapter.
 *
 * DraftSurface: a PERSISTENT iframe whose srcdoc loads once and receives
 * streamed html by postMessage (the iframe never reloads while the model
 * writes). Draft html is injected into a root div via innerHTML, which never
 * executes embedded <script> tags — artifact scripts run only in the settled
 * snapshot surface after the call completes.
 *
 * ArtifactDraftNodeView: the chat-node adapter for the streaming period. The
 * engine only materializes tool rows at `tool/call`, so the streaming period
 * needs a chat node to carry a row; this adapter renders the SAME
 * {@link ArtifactRow} component (the artifact tool row) with a synthetic
 * running block whose args are the streamed create call. No second row
 * component exists — the artifact tool row is the single surface for both the
 * streamed draft and the settled snapshot.
 * @module
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { RunningToolCall } from '@deepseek-ai/dsh-client-runtime/client'
import { ArtifactRow } from '../ArtifactRow.tsx'
import { hostArtifactTheme, type ArtifactTheme } from '../sandbox.ts'
import { buildStreamingBridgeDocument } from './bridge.ts'
import css from '../artifact.module.css'

/** The persistent bridge iframe: receives streamed html by postMessage. */
export function DraftSurface({ html }: { html: string }) {
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

/** The keyed `artifact-draft` chat node view: renders the artifact TOOL ROW
 *  with the streamed create call as its running block. */
export function ArtifactDraftNodeView({ node, cwd, openFile, inspectCall }: ChatNodeViewProps<'artifact-draft'>) {
  const data = node.data
  const block: RunningToolCall = {
    callId: data.callId,
    name: 'artifact',
    argsRaw: JSON.stringify({
      op: 'create',
      ...data.title === undefined ? {} : { title: data.title },
      html: data.html,
    }),
    turn: 0,
    step: 0,
    time: 0,
    callView: null,
    subCalls: [],
  }
  return (
    <ArtifactRow
      callId={data.callId}
      toolName="artifact"
      block={block}
      cwd={cwd}
      openFile={openFile}
      inspect={inspectCall === undefined ? undefined : () => inspectCall(data.callId)}
    />
  )
}
