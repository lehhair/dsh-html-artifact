/**
 * Interactive-data collection for artifact surfaces. The artifact html runs in
 * a sandboxed iframe (opaque origin), so the host cannot read its DOM; the
 * bridge script inside the surface collects on a postMessage request and
 * reports back. The scan and tracking logic lives HERE as pure functions and
 * is embedded into the bridge script via `Function.prototype.toString` — one
 * source of truth for the in-iframe and the unit-tested implementations.
 *
 * Collection layers:
 * 1. Explicit protocol: `window.__dshArtifactData` — the artifact's own JSON
 *    value (score, selections, counters). The tool description instructs
 *    models to expose it for artifacts with internal state.
 * 2. Form controls: current values of input/textarea/select (automatic).
 * 3. Button clicks: labels + click counts tracked by the bridge (automatic).
 * @module
 */

/** One collected form field, in document order. */
export interface CollectedField {
  /** Control name, id, or a stable index-based label. */
  name: string
  /** Control kind (input/textarea/select/checkbox/radio). */
  kind: string
  /** The control's current value (string, or string[] for multi-select). */
  value: unknown
}

/** The collected interaction payload. */
export interface CollectedData {
  /** Explicit `window.__dshArtifactData` payload, when the artifact exposes one. */
  artifactData?: unknown
  /** Scanned form-control values, in document order. */
  fields: CollectedField[]
  /** Button click tallies by label, when the bridge recorded any. */
  clicks?: Record<string, number>
}

/** Derive a stable click label from a clicked interactive element. */
export function clickLabel(target: Element): string {
  const action = target.getAttribute('data-artifact-action')
  if (action !== null && action.trim() !== '') return action.trim()
  const text = (target.textContent ?? '').trim().slice(0, 40)
  if (text !== '') return text
  return target.tagName.toLowerCase()
}

/** Record one click into a label→count tally (mutates and returns the tally). */
export function recordClick(tally: Record<string, number>, target: Element): Record<string, number> {
  const label = clickLabel(target)
  tally[label] = (tally[label] ?? 0) + 1
  return tally
}

/**
 * Scan one artifact root for interactive controls and their current values,
 * layered over the explicit protocol and any bridge-tracked click tally.
 * @param root - the artifact body (null-safe).
 * @param clicks - button click tally tracked by the bridge, if any.
 * @returns the collected payload.
 */
export function collectInteractionData(
  root: Element | null,
  clicks?: Record<string, number> | undefined,
): CollectedData {
  const explicit = typeof window !== 'undefined'
    ? (window as unknown as { __dshArtifactData?: unknown }).__dshArtifactData
    : undefined
  const fields: CollectedField[] = []
  if (root !== null) {
    for (const control of root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
      'input, textarea, select',
    )) {
      const label = control.getAttribute('name') ?? control.getAttribute('id') ?? `field-${fields.length}`
      if (control instanceof HTMLInputElement) {
        if (control.type === 'checkbox' || control.type === 'radio') {
          fields.push({ name: label, kind: control.type, value: control.checked })
        } else if (control.type !== 'hidden' && control.type !== 'submit' && control.type !== 'button') {
          fields.push({ name: label, kind: control.type || 'input', value: control.value })
        }
      } else if (control instanceof HTMLTextAreaElement) {
        fields.push({ name: label, kind: 'textarea', value: control.value })
      } else if (control instanceof HTMLSelectElement) {
        fields.push({
          name: label,
          kind: 'select',
          value: control.multiple
            ? Array.from(control.selectedOptions).map(option => option.value)
            : control.value,
        })
      }
    }
  }
  return {
    ...explicit === undefined ? {} : { artifactData: explicit },
    fields,
    ...clicks === undefined ? {} : { clicks },
  }
}

/** Build the bridge-script source for the surface documents: the embedded
 *  pure functions, the capture-phase click tracker, and a `collect` wrapper
 *  that folds the tracked clicks into the collected payload. */
export function collectBridgeBody(): string {
  return [
    `var clickLabel = ${clickLabel.toString()};`,
    `var recordClick = ${recordClick.toString()};`,
    `var clicks = {};`,
    `document.addEventListener("click", function(event){`,
    `  var t = event.target;`,
    `  if (!(t instanceof Element)) return;`,
    `  var el = t.closest ? t.closest('button, [role="button"], a, [data-artifact-action]') : null;`,
    `  if (!el) return;`,
    `  recordClick(clicks, el);`,
    `}, true);`,
    `var collectImpl = ${collectInteractionData.toString()};`,
    `var collect = function(root) { return collectImpl(root, clicks); };`,
  ].join('\n')
}
