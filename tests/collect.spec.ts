// @vitest-environment jsdom
// Interaction collection: form-control scanning, the explicit
// __dshArtifactData protocol, and bridge-tracked button clicks.

import { afterEach, describe, expect, it } from 'vitest'
import { clickLabel, collectBridgeBody, collectInteractionData, recordClick } from '../src/client/stream/collect.ts'

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

  it('folds a bridge-tracked click tally into the payload', () => {
    document.body.innerHTML = '<button>New Game</button><button data-artifact-action="move">→</button>'
    const clicks = { 'New Game': 2, move: 5 }
    expect(collectInteractionData(document.body, clicks)).toEqual({
      fields: [],
      clicks: { 'New Game': 2, move: 5 },
    })
  })
})

describe('clickLabel and recordClick', () => {
  it('labels a click by data-artifact-action first, then text, then tag', () => {
    const withAction = document.createElement('button')
    withAction.setAttribute('data-artifact-action', 'move')
    expect(clickLabel(withAction)).toBe('move')

    const withText = document.createElement('button')
    withText.textContent = 'New Game'
    expect(clickLabel(withText)).toBe('New Game')

    const bare = document.createElement('a')
    expect(clickLabel(bare)).toBe('a')
  })

  it('tallies repeated clicks on the same label', () => {
    const tally: Record<string, number> = {}
    const button = document.createElement('button')
    button.textContent = 'Retry'
    recordClick(tally, button)
    recordClick(tally, button)
    expect(tally).toEqual({ Retry: 2 })
  })
})

describe('collectBridgeBody', () => {
  it('embeds the click tracker and the collect wrapper', () => {
    const body = collectBridgeBody()
    expect(body).toContain('recordClick')
    expect(body).toContain('document.addEventListener("click"')
    expect(body).toContain('var collect = function(root)')
  })
})
