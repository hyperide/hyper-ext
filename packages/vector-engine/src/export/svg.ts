/**
 * @file SVG string exporter — SceneGraph to SVG serialization
 *
 * Accessed via: Export SVG action and JSX injection — serializes scene graph to SVG string
 *
 * Tradeoffs: string concatenation (no DOM, no template engine).
 * Gradient defs are collected and emitted in a single <defs> block.
 */

import { commandsToSvgD } from '../path/commands';
import type { FillStyle, SceneEntry, SceneGraph, SceneItem, TransformMatrix } from '../types';
import { isSceneGroup, isSceneItem } from '../types';

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function isIdentityMatrix(m: TransformMatrix): boolean {
  return m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0;
}

function matrixAttr(m: TransformMatrix): string {
  return `transform="matrix(${m[0]} ${m[1]} ${m[2]} ${m[3]} ${m[4]} ${m[5]})"`;
}

class DefsCollector {
  private readonly defsList: string[] = [];
  private readonly ids = new Set<string>();

  add(id: string, content: string): void {
    if (this.ids.has(id)) return;
    this.ids.add(id);
    this.defsList.push(content);
  }

  get defs(): string[] {
    return this.defsList;
  }
}

function renderGradientStops(stops: Array<{ offset: number; color: string }>): string {
  return stops.map((s) => `<stop offset="${s.offset}" stop-color="${escapeAttr(s.color)}"/>`).join('');
}

function resolveFill(fill: FillStyle, itemId: string, collector: DefsCollector): string {
  switch (fill.type) {
    case 'solid':
      return escapeAttr(fill.color);

    case 'linearGradient': {
      const gradId = escapeAttr(`grad-${itemId}`);
      collector.add(
        gradId,
        `<linearGradient id="${gradId}" x1="${fill.from.x}" y1="${fill.from.y}" x2="${fill.to.x}" y2="${fill.to.y}" gradientUnits="userSpaceOnUse">${renderGradientStops(fill.stops)}</linearGradient>`,
      );
      return `url(#${gradId})`;
    }

    case 'radialGradient': {
      const gradId = escapeAttr(`grad-${itemId}`);
      collector.add(
        gradId,
        `<radialGradient id="${gradId}" cx="${fill.center.x}" cy="${fill.center.y}" r="${fill.radius}" gradientUnits="userSpaceOnUse">${renderGradientStops(fill.stops)}</radialGradient>`,
      );
      return `url(#${gradId})`;
    }

    case 'conicGradient': {
      // No direct SVG equivalent — fall back to first stop color
      return escapeAttr(fill.stops[0]?.color ?? 'none');
    }
  }
}

function buildPathAttrs(item: SceneItem, collector: DefsCollector): string {
  const parts: string[] = [];

  const d = commandsToSvgD(item.path.commands);
  parts.push(`d="${d}"`);

  // Fill
  const { style } = item;
  if (style.fill) {
    const fillValue = resolveFill(style.fill, item.id, collector);
    parts.push(`fill="${fillValue}"`);
  } else {
    parts.push('fill="none"');
  }

  // Stroke
  if (style.stroke) {
    const { stroke } = style;
    parts.push(`stroke="${escapeAttr(stroke.color)}"`);
    parts.push(`stroke-width="${stroke.width}"`);
    parts.push(`stroke-linecap="${stroke.cap}"`);
    parts.push(`stroke-linejoin="${stroke.join}"`);
    if (stroke.dashArray && stroke.dashArray.length > 0) {
      parts.push(`stroke-dasharray="${stroke.dashArray.join(' ')}"`);
    }
    if (stroke.dashOffset !== undefined) {
      parts.push(`stroke-dashoffset="${stroke.dashOffset}"`);
    }
  }

  // Opacity
  if (style.opacity !== undefined) {
    parts.push(`opacity="${style.opacity}"`);
  }

  // Blend mode — emitted as CSS style attribute.
  // BlendMode enum uses camelCase; CSS requires hyphenated keywords.
  const BLEND_MODE_CSS: Partial<Record<string, string>> = {
    colorDodge: 'color-dodge',
    colorBurn: 'color-burn',
    hardLight: 'hard-light',
    softLight: 'soft-light',
  };
  const styleProps: string[] = [];
  if (style.blendMode && style.blendMode !== 'normal') {
    const cssBm = BLEND_MODE_CSS[style.blendMode] ?? style.blendMode;
    styleProps.push(`mix-blend-mode:${cssBm}`);
  }
  if (styleProps.length > 0) {
    parts.push(`style="${styleProps.join(';')}"`);
  }

  // Filter (shadow or blur) — one filter per item, shadow takes precedence
  let filterId: string | undefined;
  if (style.shadow) {
    const { shadow } = style;
    filterId = escapeAttr(`shadow-${item.id}`);
    collector.add(
      filterId,
      `<filter id="${filterId}"><feDropShadow dx="${shadow.offsetX}" dy="${shadow.offsetY}" stdDeviation="${shadow.blur}" flood-color="${escapeAttr(shadow.color)}"/></filter>`,
    );
  } else if (style.blur !== undefined) {
    filterId = escapeAttr(`blur-${item.id}`);
    collector.add(filterId, `<filter id="${filterId}"><feGaussianBlur stdDeviation="${style.blur}"/></filter>`);
  }
  if (filterId) {
    parts.push(`filter="url(#${filterId})"`);
  }

  // ClipPath
  if (item.clipPath) {
    const clipId = escapeAttr(`clip-${item.id}`);
    const clipD = commandsToSvgD(item.clipPath.commands);
    collector.add(clipId, `<clipPath id="${clipId}"><path d="${clipD}"/></clipPath>`);
    parts.push(`clip-path="url(#${clipId})"`);
  }

  // Transform
  if (!isIdentityMatrix(item.transform)) {
    parts.push(matrixAttr(item.transform));
  }

  return parts.join(' ');
}

function renderEntry(entry: SceneEntry, collector: DefsCollector): string {
  if (!entry.visible) return '';

  if (isSceneItem(entry)) {
    const attrs = buildPathAttrs(entry, collector);
    return `<path ${attrs}/>`;
  }

  if (isSceneGroup(entry)) {
    const children = entry.children.map((child) => renderEntry(child, collector)).join('');
    const transformPart = isIdentityMatrix(entry.transform) ? '' : ` ${matrixAttr(entry.transform)}`;
    const opacityPart = entry.opacity !== undefined ? ` opacity="${entry.opacity}"` : '';

    let clipPart = '';
    if (entry.clipPath) {
      const clipId = escapeAttr(`clip-${entry.id}`);
      const clipD = commandsToSvgD(entry.clipPath.commands);
      collector.add(clipId, `<clipPath id="${clipId}"><path d="${clipD}"/></clipPath>`);
      clipPart = ` clip-path="url(#${clipId})"`;
    }

    return `<g${transformPart}${opacityPart}${clipPart}>${children}</g>`;
  }

  return '';
}

export function sceneToSvg(scene: SceneGraph): string {
  const { canvas, items, background } = scene;
  const collector = new DefsCollector();

  const bodyParts: string[] = [];

  if (background) {
    bodyParts.push(`<rect width="100%" height="100%" fill="${escapeAttr(background)}"/>`);
  }

  for (const entry of items) {
    bodyParts.push(renderEntry(entry, collector));
  }

  const defsBlock = collector.defs.length > 0 ? `<defs>${collector.defs.join('')}</defs>` : '';

  const body = bodyParts.join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${canvas.width} ${canvas.height}" width="${canvas.width}" height="${canvas.height}">${defsBlock}${body}</svg>`;
}
