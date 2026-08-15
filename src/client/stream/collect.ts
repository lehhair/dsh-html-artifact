/**
 * Interactive-data collection for artifact surfaces. The artifact html runs in
 * a sandboxed iframe (opaque origin), so the host cannot read its DOM; the
 * bridge script inside the surface collects on a postMessage request and
 * reports back. The scan logic lives HERE as a pure function and is embedded
 * into the bridge script via `Function.prototype.toString` — one source of
 * truth for the in-iframe and the unit-tested implementations.
 *
 * Collection prefers an explicit protocol (`window.__dshArtifactData`), then
 * falls back to scanning interactive form controls inside the artifact root.
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
}

/** Scan one artifact root for interactive controls and their current values. */
export function collectInteractionData(root: Element | null): CollectedData {
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
  return { ...explicit === undefined ? {} : { artifactData: explicit }, fields }
}

/** Build the bridge-script source for the surface documents: one embedded
 *  copy of the collect function, kept identical to the unit-tested one. */
export function collectBridgeBody(): string {
  return `var collect = ${collectInteractionData.toString()};`
}
