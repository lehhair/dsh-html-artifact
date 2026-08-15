/**
 * The streaming bridge document: a PERSISTENT iframe srcdoc for the live
 * artifact draft. Unlike the settled ArtifactSurface (which rebuilds srcdoc
 * per snapshot), this document loads once and receives streamed html through
 * a postMessage bridge — the iframe never reloads while the model writes, so
 * the preview stays stable and cheap. The artifact html is injected into a
 * root div via innerHTML (which never executes embedded <script> tags — draft
 * scripts run only in the settled surface after the call completes).
 * @module
 */

import { ARTIFACT_CSP } from '../sandbox.ts'

/** Size probe: reports the rendered content box to the host for auto-height. */
function bridgeMeasureScript(resizeId: string): string {
  return `<script>(function(){var id=${JSON.stringify(resizeId)};var send=function(){var root=document.getElementById("dsh-artifact-root");if(!root){return}var bottom=0;var nodes=root.querySelectorAll("*");for(var i=0;i<nodes.length;i+=1){var el=nodes[i];var tag=el.tagName;if(tag==="SCRIPT"||tag==="STYLE"||tag==="LINK"||tag==="META"){continue}var style=getComputedStyle(el);if(style.display==="none"||style.visibility==="hidden"||style.position==="fixed"){continue}var rect=el.getBoundingClientRect();bottom=Math.max(bottom,rect.bottom)}var height=Math.max(120,Math.ceil(bottom||root.scrollHeight||120));parent.postMessage({type:"dsh-artifact-resize",id:id,height:height},"*")};addEventListener("message",function(event){var data=event.data;if(data&&data.type==="dsh-artifact-stream"&&typeof data.html==="string"){var root=document.getElementById("dsh-artifact-root");if(root){root.innerHTML=data.html;send()}};if(data&&data.type==="dsh-artifact-theme"&&(data.theme==="light"||data.theme==="dark")){document.documentElement.style.colorScheme=data.theme}});addEventListener("load",send);if(typeof ResizeObserver!=="undefined"){new ResizeObserver(send).observe(document.getElementById("dsh-artifact-root"))}})()</script>`
}

/**
 * Build the persistent srcdoc for one streaming draft surface.
 * @param resizeId - stable per-surface id echoed back by the measure bridge.
 * @param theme - initial host theme for the document.
 * @returns the complete standalone document string.
 */
export function buildStreamingBridgeDocument(resizeId: string, theme: 'light' | 'dark'): string {
  const themeCss = theme === 'dark'
    ? ':root{color-scheme:dark;font-family:system-ui,sans-serif;--surface-0:#161614;--text-primary:#ffffff;--text-secondary:#c3c2b7;--border:#3a3a37}'
    : ':root{color-scheme:light;font-family:system-ui,sans-serif;--surface-0:#ffffff;--text-primary:#1a1a1a;--text-secondary:#52514e;--border:#e3e1da}'
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${ARTIFACT_CSP}"><style>html,body{margin:0;overflow:hidden;background:transparent}${themeCss}</style></head><body><div id="dsh-artifact-root"></div>${bridgeMeasureScript(resizeId)}</body></html>`
}
