// @vitest-environment jsdom
// Interaction collection: scanning form controls inside an artifact root and
// honoring the explicit __dshArtifactData protocol.

import { afterEach, describe, expect, it } from 'vitest'
import { collectBridgeBody, collectInteractionData } from '../src/client/stream/collect.ts'

afterEach(() => {
  document.body.innerHTML = ''
  delete (window as unknown as { __dshArtifactData?: unknown }).__dshArtifactData
})

describe('collectInteractionData', () => {
  it('scans text inputs, checkboxes, selects, and textareas in document order', () => {
    document.body.innerHTML = `
      <input name="name" value="ada">
      <input name="agree" type="checkbox" checked>
      <select name="lang"><option value="ts" selected>ts</option><option value="py">py</option></select>
      <textarea name="notes">hi</textarea>
    `
    expect(collectInteractionData(document.body)).toEqual({
      fields: [
        { name: 'name', kind: 'text', value: 'ada' },
        { name: 'agree', kind: 'checkbox', value: true },
        { name: 'lang', kind: 'select', value: 'ts' },
        { name: 'notes', kind: 'textarea', value: 'hi' },
      ],
    })
  })

  it('skips hidden, submit, and button inputs', () => {
    document.body.innerHTML = `
      <input type="hidden" name="h" value="x">
      <input type="submit" value="go">
      <input type="button" value="b">
      <input name="t" value="v">
    `
    expect(collectInteractionData(document.body).fields).toEqual([{ name: 't', kind: 'text', value: 'v' }])
  })

  it('collects multi-select values as an array', () => {
    document.body.innerHTML = `
      <select name="tags" multiple><option value="a" selected>a</option><option value="b" selected>b</option></select>
    `
    expect(collectInteractionData(document.body).fields).toEqual([{ name: 'tags', kind: 'select', value: ['a', 'b'] }])
  })

  it('labels unnamed controls with their id, then an index', () => {
    document.body.innerHTML = '<input id="byId" value="1"><input value="2"><input value="3">'
    expect(collectInteractionData(document.body).fields.map(field => field.name))
      .toEqual(['byId', 'field-1', 'field-2'])
  })

  it('prefers the explicit __dshArtifactData protocol over scanning', () => {
    document.body.innerHTML = '<input name="x" value="1">'
    ;(window as unknown as { __dshArtifactData?: unknown }).__dshArtifactData = { custom: true, count: 3 }
    expect(collectInteractionData(document.body)).toEqual({
      artifactData: { custom: true, count: 3 },
      fields: [{ name: 'x', kind: 'text', value: '1' }],
    })
  })

  it('returns empty fields for a null root', () => {
    expect(collectInteractionData(null)).toEqual({ fields: [] })
  })
})

describe('collectBridgeBody', () => {
  it('embeds the collect function into the bridge script source', () => {
    expect(collectBridgeBody()).toContain('var collect =')
  })
})
