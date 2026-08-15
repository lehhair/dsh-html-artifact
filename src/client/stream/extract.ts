/**
 * Tolerant extraction of the streamed `html` argument of an artifact create
 * call. While the model streams a tool call, the accumulated `argsRaw` is
 * partial JSON; this walks the raw text (never JSON.parse of the whole
 * fragment) to pull the `"html"` string value as far as it has arrived,
 * unescaping it leniently when the value is still open.
 * @module
 */

/** The html argument extracted from a streamed (possibly partial) args JSON. */
export interface StreamedHtml {
  /** The html text as received so far (may still be growing). */
  html: string
  /** Whether the value's closing quote arrived (the args json for this field is complete). */
  complete: boolean
}

/** Whether `argsRaw` (possibly partial) contains an artifact `create` op. */
export function isStreamingCreate(argsRaw: string): boolean {
  return /"op"\s*:\s*"create"/u.test(argsRaw)
}

/**
 * Extract the streamed `html` argument from accumulated tool-call arguments.
 * @param argsRaw - the accumulated (possibly partial) JSON arguments text.
 * @returns the extracted html and completion state, or null when no `html`
 *   key has arrived yet (the model has not started writing it).
 */
export function extractStreamingHtml(argsRaw: string): StreamedHtml | null {
  const keyIndex = argsRaw.indexOf('"html"')
  if (keyIndex === -1) return null
  let cursor = keyIndex + '"html"'.length
  // Skip whitespace, the colon, whitespace.
  while (cursor < argsRaw.length && /\s/u.test(argsRaw[cursor] ?? '')) cursor++
  if (argsRaw[cursor] !== ':') return null
  cursor++
  while (cursor < argsRaw.length && /\s/u.test(argsRaw[cursor] ?? '')) cursor++
  if (argsRaw[cursor] !== '"') return null
  cursor++
  // Walk the string value honoring backslash escapes; the closing quote is
  // the first unescaped `"`. An unterminated value (mid-stream) is complete
  // only when the closing quote arrived.
  let raw = ''
  for (; cursor < argsRaw.length; cursor++) {
    const char = argsRaw[cursor]
    if (char === '\\') {
      const next = argsRaw[cursor + 1]
      if (next === undefined) break // trailing backslash: half of an escape
      raw += char + next
      cursor++
      continue
    }
    if (char === '"') {
      return { html: unescapeJson(raw), complete: true }
    }
    raw += char
  }
  // Unterminated: drop a lone trailing backslash (half of an escape), then
  // unescape leniently — an incomplete `\n` decodes as `\` + `n` at worst.
  if (raw.endsWith('\\')) raw = raw.slice(0, -1)
  return { html: unescapeJson(raw), complete: false }
}

/** JSON-string unescape for a (possibly incomplete) html value. */
function unescapeJson(raw: string): string {
  return raw
    .replace(/\\"/gu, '"')
    .replace(/\\\\/gu, '\\')
    .replace(/\\n/gu, '\n')
    .replace(/\\r/gu, '\r')
    .replace(/\\t/gu, '\t')
    .replace(/\\\//gu, '/')
}
