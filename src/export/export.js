/** Export helpers: SVG / PNG of the current map, JSON of the tree, Markdown tree. */
import { downloadBlob, copyText } from '../utils/dom.js';
import { toAsciiTree, toPlainTree } from '../model/tree.js';
import { cssVar } from '../ui/theme.js';

const STYLE_PROPS = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray', 'stroke-linejoin', 'opacity', 'font-family', 'font-size', 'font-weight', 'text-anchor', 'paint-order', 'display', 'visibility', 'dominant-baseline'];
const SVG_NS = 'http://www.w3.org/2000/svg';

/** Serialise an SVG element with computed styles inlined so it renders standalone. */
export function svgToString(svg, { background = true } = {}) {
  const rect = svg.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width)), height = Math.max(1, Math.round(rect.height));
  const clone = svg.cloneNode(true);
  const srcEls = [svg, ...svg.querySelectorAll('*')];
  const dstEls = [clone, ...clone.querySelectorAll('*')];
  for (let i = 0; i < srcEls.length; i++) {
    const cs = getComputedStyle(srcEls[i]);
    const parts = [];
    for (const p of STYLE_PROPS) {
      const v = cs.getPropertyValue(p);
      if (v) parts.push(`${p}:${v}`);
    }
    if (parts.length) dstEls[i].setAttribute('style', parts.join(';'));
    dstEls[i].removeAttribute('class');
  }
  clone.setAttribute('xmlns', SVG_NS);
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  clone.setAttribute('width', width);
  clone.setAttribute('height', height);
  if (!clone.getAttribute('viewBox')) clone.setAttribute('viewBox', `0 0 ${width} ${height}`);
  if (background) {
    const bg = document.createElementNS(SVG_NS, 'rect');
    bg.setAttribute('width', '100%'); bg.setAttribute('height', '100%');
    bg.setAttribute('fill', cssVar('--sheet') || '#0e1427');
    clone.insertBefore(bg, clone.firstChild);
  }
  const credit = document.createElementNS(SVG_NS, 'text');
  credit.textContent = 'Made with GitMap';
  credit.setAttribute('x', width - 10); credit.setAttribute('y', height - 8);
  credit.setAttribute('style', `font-family:ui-monospace,monospace;font-size:10px;fill:${cssVar('--ink-3') || '#6f7a9c'};text-anchor:end;opacity:.8`);
  clone.appendChild(credit);
  return { text: new XMLSerializer().serializeToString(clone), width, height };
}

export function downloadSvg(svg, filename) {
  const { text } = svgToString(svg);
  downloadBlob(new Blob([text], { type: 'image/svg+xml;charset=utf-8' }), filename.endsWith('.svg') ? filename : `${filename}.svg`);
}

export function downloadPng(svg, filename, scale = 2) {
  return new Promise((resolve, reject) => {
    const { text, width, height } = svgToString(svg);
    const img = new Image();
    const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml;charset=utf-8' }));
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = width * scale; canvas.height = height * scale;
      const ctx = canvas.getContext('2d');
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => {
        if (!blob) return reject(new Error('Could not encode PNG'));
        downloadBlob(blob, filename.endsWith('.png') ? filename : `${filename}.png`);
        resolve();
      }, 'image/png');
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not rasterise SVG')); };
    img.src = url;
  });
}

export function downloadJson(data, filename) {
  const text = JSON.stringify(data, null, 2);
  downloadBlob(new Blob([text], { type: 'application/json' }), filename.endsWith('.json') ? filename : `${filename}.json`);
}

export function exportTreeJson(ctx) {
  const { repo, root, stats, health } = ctx;
  return {
    generator: 'GitMap',
    generatedAt: new Date().toISOString(),
    repository: { owner: repo.owner, name: repo.repo, ref: repo.ref, url: `https://github.com/${repo.owner}/${repo.repo}` },
    summary: {
      files: stats.totalFiles, folders: stats.totalDirs, bytes: stats.totalBytes, maxDepth: stats.maxDepth,
      languages: stats.languages.slice(0, 20), extensions: stats.extensions.slice(0, 30),
      health: health ? { score: health.score, grade: health.grade, checks: health.results } : null,
    },
    tree: toPlainTree(root),
  };
}

export async function copyMarkdownTree(root, opts) {
  const text = '```text\n' + toAsciiTree(root, opts) + '\n```';
  return copyText(text);
}
