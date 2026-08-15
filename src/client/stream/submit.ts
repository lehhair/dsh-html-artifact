/**
 * Interaction-submission bridge: delivers artifact interaction data collected
 * from a sandboxed surface into the CURRENT session as a user message, so the
 * agent can read and analyze what the user did inside the artifact. The bridge
 * is initialized once by the plugin apply with the sessions service and tracks
 * the current session id through the provide feed.
 * @module
 */
import type { ClientContext, ISessions, SessionId } from '@deepseek-ai/dsh-client-runtime/client'

let sessions: ISessions | undefined
let currentSessionId: SessionId | undefined
let cleanup: (() => void) | undefined

/**
 * Initialize the submission bridge for the plugin lifetime.
 * @param ctx - client root context (injects the sessions service).
 * @returns a disposer that detaches the feed subscription.
 */
export function initInteractionSubmit(ctx: ClientContext): () => void {
  sessions = ctx.sessions
  const info = ctx.sessions.currentProvideInfo
  const update = (): void => {
    currentSessionId = info.getSnapshot()?.sessionId as SessionId | undefined
  }
  update()
  cleanup = info.subscribe(update)
  return () => {
    cleanup?.()
    sessions = undefined
    currentSessionId = undefined
  }
}

/**
 * Format one submission as the user message the agent reads: a short marker
 * plus the collected data as a JSON block.
 * @param artifactId - the artifact id.
 * @param title - optional artifact display title.
 * @param data - the collected interaction payload.
 * @returns the message text.
 */
export function formatSubmission(artifactId: string, title: string | undefined, data: unknown): string {
  const label = title === undefined ? artifactId : `${artifactId}（${title}）`
  return `[artifact 交互提交] 用户操作了 HTML artifact ${label} 并提交了交互数据，请读取并分析：\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``
}

/**
 * Deliver one submission into the current session as a queued user message.
 * @param artifactId - the artifact id.
 * @param title - optional artifact display title.
 * @param data - the collected interaction payload.
 * @returns whether the prompt was accepted.
 */
export async function submitInteraction(
  artifactId: string,
  title: string | undefined,
  data: unknown,
): Promise<boolean> {
  if (sessions === undefined || currentSessionId === undefined) return false
  const binding = sessions.binding(currentSessionId)
  if (binding === undefined) return false
  const result = await binding.session.prompt(
    [{ type: 'text', text: formatSubmission(artifactId, title, data) }],
    'queue',
  )
  return result.ok === true
}
