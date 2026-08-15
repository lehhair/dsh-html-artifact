/**
 * Server-side semantics of the artifact tool: the pure replace engine and the
 * per-session store (create/patch/read/destroy/list, revisioning, byte caps,
 * truncation, id generation, error taxonomy).
 */

import { describe, expect, it } from 'vitest'
import {
  ArtifactNotFoundError, ArtifactStore, ArtifactTooLargeError, NoChangeError, PatchNotFoundError,
  makeArtifactId, replaceOccurrences, truncateHtml,
} from '../src/registry.ts'

describe('replaceOccurrences', () => {
  it('replaces the first occurrence only by default', () => {
    expect(replaceOccurrences('a-b-a', 'a', 'x', false)).toEqual({ html: 'x-b-a', count: 1 })
  })

  it('replaces every occurrence with replace_all', () => {
    expect(replaceOccurrences('a-b-a', 'a', 'x', true)).toEqual({ html: 'x-b-x', count: 2 })
  })

  it('reports count 0 and the untouched source when nothing matches', () => {
    expect(replaceOccurrences('hello', 'zzz', 'x', false)).toEqual({ html: 'hello', count: 0 })
    expect(replaceOccurrences('hello', 'zzz', 'x', true)).toEqual({ html: 'hello', count: 0 })
  })

  it('treats an empty old_string and an identical pair as no-ops', () => {
    expect(replaceOccurrences('abc', '', 'x', false)).toEqual({ html: 'abc', count: 0 })
    expect(replaceOccurrences('abc', 'b', 'b', true)).toEqual({ html: 'abc', count: 0 })
  })

  it('handles empty source and empty replacement (deletion)', () => {
    expect(replaceOccurrences('', 'x', 'y', false)).toEqual({ html: '', count: 0 })
    expect(replaceOccurrences('hello world', 'o', '', true)).toEqual({ html: 'hell wrld', count: 2 })
  })

  it('is plain-text matching, never regex', () => {
    expect(replaceOccurrences('a.b.c', '.', '!', true)).toEqual({ html: 'a!b!c', count: 2 })
  })
})

describe('truncateHtml', () => {
  it('leaves a source within the cap untouched', () => {
    expect(truncateHtml('abc', 10)).toEqual({ html: 'abc', truncated: false })
  })

  it('cuts an over-cap source to the cap', () => {
    const { html, truncated } = truncateHtml('abcdef', 4)
    expect(truncated).toBe(true)
    expect(html).toBe('abcd')
  })

  it('never splits a multi-byte character', () => {
    // '你' is 3 UTF-8 bytes; cap 4 must keep only the first code point.
    const { html, truncated } = truncateHtml('你好', 4)
    expect(truncated).toBe(true)
    expect(html).toBe('你')
    expect(new TextEncoder().encode(html).byteLength).toBe(3)
  })
})

describe('makeArtifactId', () => {
  it('produces an art- prefixed id absent from the existing set', () => {
    const existing = new Set(['art-aaaaaa'])
    const id = makeArtifactId(existing)
    expect(id).toMatch(/^art-[a-z0-9]{6}$/)
    expect(existing.has(id)).toBe(false)
  })
})

describe('ArtifactStore', () => {
  it('creates with revision 1, optional title, and the given source', () => {
    const store = new ArtifactStore()
    const id = store.create('<div>hi</div>', 'Greeting', 1024)
    expect(id).toMatch(/^art-/)
    expect(store.get(id)).toEqual({ html: '<div>hi</div>', revision: 1, title: 'Greeting' })
  })

  it('creates with an empty source and no title', () => {
    const store = new ArtifactStore()
    const id = store.create('', undefined, 1024)
    expect(store.get(id)).toEqual({ html: '', revision: 1 })
  })

  it('patches in place, bumping revision and reporting the match count', () => {
    const store = new ArtifactStore()
    const id = store.create('<div>hello</div>', undefined, 1024)
    const { state, count } = store.patch(id, 'hello', 'world', false, 1024)
    expect(count).toBe(1)
    expect(state.revision).toBe(2)
    expect(state.html).toBe('<div>world</div>')
    expect(store.get(id).revision).toBe(2)
  })

  it('replaces all occurrences with replace_all', () => {
    const store = new ArtifactStore()
    const id = store.create('<p>a</p><p>a</p>', undefined, 1024)
    const { state, count } = store.patch(id, 'a', 'b', true, 1024)
    expect(count).toBe(2)
    expect(state.html).toBe('<p>b</p><p>b</p>')
  })

  it('throws PatchNotFoundError with a context snippet when old_string is absent', () => {
    const store = new ArtifactStore()
    const id = store.create('<div>hello world</div>', undefined, 1024)
    expect(() => store.patch(id, 'nope', 'x', false, 1024)).toThrow(PatchNotFoundError)
    expect(() => store.patch(id, 'nope', 'x', false, 1024)).toThrow(/old_string not found/)
  })

  it('throws NoChangeError for an identical pair', () => {
    const store = new ArtifactStore()
    const id = store.create('<div>x</div>', undefined, 1024)
    expect(() => store.patch(id, 'x', 'x', false, 1024)).toThrow(NoChangeError)
  })

  it('rejects a create or patch whose source exceeds the byte cap, leaving state untouched', () => {
    const store = new ArtifactStore()
    expect(() => store.create('12345', undefined, 4)).toThrow(ArtifactTooLargeError)
    const id = store.create('<div>abc</div>', undefined, 1024)
    expect(() => store.patch(id, 'abc', 'abcdefghijklmnopqrstuvwxyz', false, 16)).toThrow(ArtifactTooLargeError)
    expect(store.get(id).html).toBe('<div>abc</div>')
    expect(store.get(id).revision).toBe(1)
  })

  it('throws ArtifactNotFoundError for unknown ids on every op', () => {
    const store = new ArtifactStore()
    expect(() => store.get('art-zzzzzz')).toThrow(ArtifactNotFoundError)
    expect(() => store.patch('art-zzzzzz', 'a', 'b', false, 1024)).toThrow(ArtifactNotFoundError)
    expect(() => store.destroy('art-zzzzzz')).toThrow(ArtifactNotFoundError)
  })

  it('destroys an artifact and drops it from list', () => {
    const store = new ArtifactStore()
    const id = store.create('<div>x</div>', undefined, 1024)
    store.destroy(id)
    expect(store.list()).toEqual([])
    expect(() => store.get(id)).toThrow(ArtifactNotFoundError)
  })

  it('lists summaries in creation order with revision and byte counts', () => {
    const store = new ArtifactStore()
    const first = store.create('hello', 'First', 1024)
    const second = store.create('', undefined, 1024)
    expect(store.list()).toEqual([
      { id: first, revision: 1, bytes: 5, title: 'First' },
      { id: second, revision: 1, bytes: 0 },
    ])
  })
})
