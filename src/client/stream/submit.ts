/**
 * Interaction-submission bridge: delivers artifact interaction data collected
 * from a sandboxed surface into the agent's NEXT request context through the
 * host-side `/artifact-submit` slash command (never sent to the model as a
 * chat message). The bridge is initialized once by the plugin apply with the
 * sessions service and tracks the current session id through the provide feed.
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
 * Format one submission as the `/artifact-submit` command line the host
 * parses and records for the agent's next request.
 * @param artifactId - the artifact id.
 * @param title - optional artifact display title.
 * @param data - the collected interaction payload.
 * @returns the command line.
 */
export function formatSubmissionCommand(artifactId: string, title: string | undefined, data: unknown): string {
  return `/artifact-submit ${JSON.stringify({
    id: artifactId,
    ...title === undefined ? {} : { title },
    data,
  })}`
}

/**
 * Deliver one submission to the current session through the slash command.
 * @param artifactId - the artifact id.
 * @param title - optional artifact display title.
 * @param data - the collected interaction payload.
 * @returns whether the command matched and executed.
 */
export async function submitInteraction(
  artifactId: string,
  title: string | undefined,
  data: unknown,
): Promise<boolean> {
  if (sessions === undefined || currentSessionId === undefined) return false
  const binding = sessions.binding(currentSessionId)
  if (binding === undefined) return false
  const result = await binding.session.command(formatSubmissionCommand(artifactId, title, data))
  return result.ok === true && result.value.matched === true
}
