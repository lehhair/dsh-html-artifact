/**
 * Streaming html extraction: tolerant parsing of partial tool-call args.
 */

import { describe, expect, it } from 'vitest'
import { extractStreamingHtml, isStreamingCreate } from '../src/client/stream/extract.ts'

describe('isStreamingCreate', () => {
  it('detects a create op in partial args', () => {
    expect(isStreamingCreate('{"op": "create", "ti')).toBe(true)
    expect(isStreamingCreate('{"op": "patch", "id"')).toBe(false)
  })
})

describe('extractStreamingHtml', () => {
  it('returns null before the html key arrives', () => {
    expect(extractStreamingHtml('{"op": "create", "tit')).toBeNull()
  })

  it('extracts a complete html value', () => {
    const args = JSON.stringify({ op: 'create', html: '<div>hi</div>' })
    expect(extractStreamingHtml(args)).toEqual({ html: '<div>hi</div>', complete: true })
  })

  it('extracts a still-open html value with complete=false', () => {
    expect(extractStreamingHtml('{"op":"create","html":"<div>hi')).toEqual({ html: '<div>hi', complete: false })
  })

  it('handles escaped quotes and backslashes in the value', () => {
    const args = '{"op":"create","html":"<button title=\\"x\\">a\\\\b</button>"}'
    expect(extractStreamingHtml(args)).toEqual({
      html: '<button title="x">a\\b</button>',
      complete: true,
    })
  })

  it('unescapes newlines in the value', () => {
    const args = JSON.stringify({ op: 'create', html: '<div>\n<p>a</p>\n</div>' })
    expect(extractStreamingHtml(args)).toEqual({ html: '<div>\n<p>a</p>\n</div>', complete: true })
  })

  it('does not stop at an escaped quote inside an open value', () => {
    expect(extractStreamingHtml('{"html":"a\\"b')).toEqual({ html: 'a"b', complete: false })
  })

  it('drops a lone trailing backslash of an unterminated escape', () => {
    expect(extractStreamingHtml('{"html":"ab\\')).toEqual({ html: 'ab', complete: false })
  })
})
