/**
 * Registers the artifact tool's browser half:
 * - the `artifact` tool row into the keyed `tool.call.toolview` slot (the
 *   settled timeline-snapshot renderer), and
 * - the `artifact-draft` chat node (Definition on the runtime's
 *   `conversationEvents` service + a keyed `conversation.chat.node` renderer)
 *   that streams the model's in-flight create html into a live preview.
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { ArtifactRow } from './ArtifactRow.tsx'
import { artifactDraftDefinition } from './stream/draft.ts'
import { ArtifactDraftNodeView } from './stream/DraftSurface.tsx'
import { initInteractionSubmit } from './stream/submit.ts'

/** Required services: the slot registry, the conversation-node registry, and
 *  the sessions service (interaction submission tracks the current session). */
export const inject = ['slots', 'conversationEvents', 'sessions']

/**
 * Mount the artifact rows and the streaming draft node.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('tool.call.toolview', function* () {
    yield ctx.slots.register({
      name: 'tool.call.toolview',
      key: 'artifact',
    }, ArtifactRow)
  })
  // The interaction-submission bridge (tracks the current session so artifact
  // interaction submits land in the right conversation); lives for the plugin
  // lifetime.
  ctx.effect(() => initInteractionSubmit(ctx), 'dsh-html-artifact: interaction submit bridge')
  // The streaming draft Definition: lives for this plugin's lifetime and is
  // removed automatically on unload (the registry wraps it in a ctx effect).
  ctx.conversationEvents.register(artifactDraftDefinition)
  ctx.slots.inject('conversation.chat.node', function* () {
    yield ctx.slots.register({
      name: 'conversation.chat.node',
      key: 'artifact-draft',
      // The 'conversation' dictionary namespace, matching the shipped chat
      // node renderers (ui-conversation registers it; the draft row needs no
      // copy of its own).
      locale: 'conversation',
    }, ArtifactDraftNodeView)
  })
}
