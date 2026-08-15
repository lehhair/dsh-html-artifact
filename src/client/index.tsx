/**
 * Registers the artifact row into the ui-tool keyed atomic Tool view slot
 * (`tool.call.toolview`) under the `artifact` tool key. The key is unclaimed
 * by any shipped row, so this registration is additive: every `artifact` call
 * in a turn renders through this plugin's ArtifactRow while mounted and
 * returns to the generic row automatically on unload.
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { ArtifactRow } from './ArtifactRow.tsx'

/** Required service: the slot registry. */
export const inject = ['slots']

/**
 * Mount the artifact row into the keyed atomic Tool view slot under the
 * `artifact` tool key.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('tool.call.toolview', function* () {
    yield ctx.slots.register({
      name: 'tool.call.toolview',
      key: 'artifact',
    }, ArtifactRow)
  })
}
