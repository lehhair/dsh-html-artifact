/**
 * Sandboxed HTML document builder for the artifact preview, porting the
 * standard artifact-sandbox recipe (CSP meta, theme variables, storage shim,
 * size probe, theme bridge) as a self-contained string: every artifact renders
 * inside an iframe whose srcdoc carries a `default-src 'none'` policy, an
 * opaque origin (`sandbox="allow-scripts"` without allow-same-origin), and a
 * postMessage bridge for size and theme — the artifact can script itself but
 * cannot touch the host document.
 * @module
 */

export type ArtifactTheme = 'light' | 'dark'

/** Content-Security-Policy for artifact documents: no network to the host, no
 *  frames/objects/forms; scripts/styles may be inline; https/http resources
 *  (images, fonts, styles, fetches) are allowed. Shared by the settled
 *  surface (sandbox.ts) and the streaming bridge (stream/bridge.ts). */
export const ARTIFACT_CSP = `default-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'; frame-src 'none'; img-src https: http: data: blob:; media-src https: http: data: blob:; font-src https: http: data:; style-src 'unsafe-inline' https: http:; script-src 'unsafe-inline' 'unsafe-eval' https: http: blob:; connect-src https: http:`

/** CSS custom properties the artifact document exposes for the host theme. */
const ARTIFACT_THEME_VARS: Record<ArtifactTheme, Record<string, string>> = {
  light: {
    '--surface-0': '#ffffff',
    '--surface-1': '#f5f4f1',
    '--text-primary': '#1a1a1a',
    '--text-secondary': '#52514e',
    '--text-muted': '#898781',
    '--border': '#e3e1da',
    '--accent': '#185fa5',
  },
  dark: {
    '--surface-0': '#161614',
    '--surface-1': '#2a2a28',
    '--text-primary': '#ffffff',
    '--text-secondary': '#c3c2b7',
    '--text-muted': '#898781',
    '--border': '#3a3a37',
    '--accent': '#85b7eb',
  },
}

function themeRootCss(theme: ArtifactTheme): string {
  const vars = Object.entries(ARTIFACT_THEME_VARS[theme])
    .map(([name, value]) => `${name}:${value}`)
    .join(';')
  return `:root{color-scheme:${theme};font-family:system-ui,sans-serif;${vars}}`
}

/** Read the host theme the boot script set on <html> (color-scheme). */
export function hostArtifactTheme(): ArtifactTheme {
  if (typeof document === 'undefined') return 'light'
  return document.documentElement.style.colorScheme === 'dark' ? 'dark' : 'light'
}

/** In-memory localStorage/sessionStorage for the opaque-origin sandbox. */
function storageShimScript(): string {
  return `<script>${'(function(){const create=function(){const values=new Map();return{get length(){return values.size},key:index=>Array.from(values.keys())[index]??null,getItem:key=>values.get(String(key))??null,setItem:(key,value)=>{values.set(String(key),String(value))},removeItem:key=>{values.delete(String(key))},clear:()=>values.clear()}};for(const name of["localStorage","sessionStorage"]){try{window[name].getItem("__dsh_probe__");continue}catch(e){}try{Object.defineProperty(window,name,{configurable:true,enumerable:true,value:create()})}catch(e){}}}())'}</script>`
}

/** Theme bridge: applies a `dsh-artifact-theme` postMessage to the document. */
function themeApplyScript(theme: ArtifactTheme): string {
  const themes = JSON.stringify(ARTIFACT_THEME_VARS)
  return `<script>(function(){var themes=${themes};var build=function(theme){var vars=Object.entries(themes[theme]).map(function(e){return e[0]+":"+e[1]}).join(";");return ":root{color-scheme:"+theme+";font-family:system-ui,sans-serif;"+vars+"}"};var apply=function(theme){var root=document.documentElement;root.style.colorScheme=theme;var style=document.getElementById("dsh-artifact-theme");if(style){style.textContent=build(theme)}dispatchEvent(new Event("resize"))};addEventListener("message",function(event){var data=event.data;if(data&&data.type==="dsh-artifact-theme"&&(data.theme==="light"||data.theme==="dark")){apply(data.theme)}})})()</script>`
}

/** Size probe: reports the rendered content box to the host for auto-height. */
function measureScript(resizeId: string): string {
  return `<script>(function(){var id=${JSON.stringify(resizeId)};var send=function(){var body=document.body;if(!body){return}var root=body.getBoundingClientRect();var bottom=0;var nodes=body.querySelectorAll("*");for(var i=0;i<nodes.length;i+=1){var el=nodes[i];var tag=el.tagName;if(tag==="SCRIPT"||tag==="STYLE"||tag==="LINK"||tag==="META"){continue}var style=getComputedStyle(el);if(style.display==="none"||style.visibility==="hidden"||style.position==="fixed"){continue}var rect=el.getBoundingClientRect();bottom=Math.max(bottom,rect.bottom-root.top)}var height=Math.max(120,Math.ceil(bottom||body.scrollHeight));parent.postMessage({type:"dsh-artifact-resize",id:id,height:height},"*")};addEventListener("load",send);if(typeof ResizeObserver!=="undefined"){new ResizeObserver(send).observe(document.body)}requestAnimationFrame(send)})()</script>`
}

/**
 * Build the srcdoc for one artifact preview: the artifact source merged into a
 * host-owned document (CSP head, theme variables, storage shim, theme and
 * measure bridges). The source is parsed with DOMParser so a `</body>` or
 * `<head>` inside it cannot break out of the wrapper structure.
 * @param source - the artifact's HTML source.
 * @param resizeId - stable per-surface id echoed back by the measure bridge.
 * @param theme - initial host theme for the document.
 * @returns the complete standalone document string.
 */
export function buildSandboxedHtmlDocument(source: string, resizeId: string, theme: ArtifactTheme): string {
  const doc = new DOMParser().parseFromString(source, 'text/html')
  const securityHead = `<meta http-equiv="Content-Security-Policy" content="${ARTIFACT_CSP}"><meta name="viewport" content="width=device-width, initial-scale=1">`
  const themeHead = `<style id="dsh-artifact-theme">html,body{margin:0;overflow:hidden;background:transparent}${themeRootCss(theme)}</style>`
  doc.head.insertAdjacentHTML('afterbegin', `${securityHead}${themeHead}${storageShimScript()}`)
  doc.body.insertAdjacentHTML('afterbegin', `${themeApplyScript(theme)}${measureScript(resizeId)}`)
  return `<!doctype html>${doc.documentElement.outerHTML}`
}
