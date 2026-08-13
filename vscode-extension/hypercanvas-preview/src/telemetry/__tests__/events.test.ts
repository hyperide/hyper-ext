/**
 * Event-taxonomy helper tests — categorizeErrorMessage + the webview allow-list.
 *
 * Run with: cd vscode-extension/hypercanvas-preview && bun test src/telemetry/
 */

import { describe, expect, it } from 'bun:test';
import { categorizeErrorMessage, TelemetryEvents, valueKindOf, WEBVIEW_ALLOWED_EVENTS } from '../events';

describe('categorizeErrorMessage', () => {
  it('detects the blank-preview process-not-defined case first', () => {
    expect(categorizeErrorMessage('Uncaught ReferenceError: process is not defined')).toBe('process_not_defined');
  });

  it('detects provider context errors', () => {
    expect(categorizeErrorMessage('useTheme must be used within a ThemeProvider context')).toBe('provider_context');
  });

  it('detects missing modules', () => {
    expect(categorizeErrorMessage('Cannot find module "foo"')).toBe('module_missing');
    expect(categorizeErrorMessage('Failed to resolve import "bar"')).toBe('module_missing');
  });

  it('detects syntax errors', () => {
    expect(categorizeErrorMessage('SyntaxError: Unexpected token <')).toBe('syntax');
  });

  it('falls back to other', () => {
    expect(categorizeErrorMessage('something unrelated happened')).toBe('other');
    expect(categorizeErrorMessage(undefined)).toBe('other');
    expect(categorizeErrorMessage(null)).toBe('other');
  });
});

describe('TelemetryEvents taxonomy', () => {
  it('defines the new explorer / canvas / inspector / panel / theme constants', () => {
    // A representative slice across every new surface — the value must equal the
    // namespaced string the dashboards index on.
    expect(TelemetryEvents.explorerItemOpened).toBe('explorer.itemOpened');
    expect(TelemetryEvents.explorerNavigated).toBe('explorer.navigated');
    expect(TelemetryEvents.explorerSearched).toBe('explorer.searched');
    expect(TelemetryEvents.explorerItemSelected).toBe('explorer.itemSelected');
    expect(TelemetryEvents.canvasElementSelected).toBe('canvas.elementSelected');
    expect(TelemetryEvents.canvasSelectionCleared).toBe('canvas.selectionCleared');
    expect(TelemetryEvents.canvasElementHovered).toBe('canvas.elementHovered');
    expect(TelemetryEvents.canvasDragStarted).toBe('canvas.dragStarted');
    expect(TelemetryEvents.canvasDragEnded).toBe('canvas.dragEnded');
    expect(TelemetryEvents.canvasElementResized).toBe('canvas.elementResized');
    expect(TelemetryEvents.canvasElementInserted).toBe('canvas.elementInserted');
    expect(TelemetryEvents.canvasElementWrapped).toBe('canvas.elementWrapped');
    expect(TelemetryEvents.canvasElementMoved).toBe('canvas.elementMoved');
    expect(TelemetryEvents.canvasModeSwitched).toBe('canvas.modeSwitched');
    expect(TelemetryEvents.canvasContextMenuAction).toBe('canvas.contextMenuAction');
    expect(TelemetryEvents.canvasContextMenuOpened).toBe('canvas.contextMenuOpened');
    expect(TelemetryEvents.canvasUndo).toBe('canvas.undo');
    expect(TelemetryEvents.canvasRedo).toBe('canvas.redo');
    expect(TelemetryEvents.inspectorPropEdited).toBe('inspector.propEdited');
    expect(TelemetryEvents.inspectorStyleEdited).toBe('inspector.styleEdited');
    expect(TelemetryEvents.inspectorTextEdited).toBe('inspector.textEdited');
    expect(TelemetryEvents.panelOpened).toBe('panel.opened');
    expect(TelemetryEvents.panelClosed).toBe('panel.closed');
    expect(TelemetryEvents.themeChanged).toBe('theme.changed');
  });
});

describe('valueKindOf', () => {
  it('classifies primitives by typeof', () => {
    expect(valueKindOf(42)).toBe('number');
    expect(valueKindOf(true)).toBe('boolean');
    expect(valueKindOf('hello')).toBe('string');
  });

  it('treats JSX/JS-expression-looking strings as expression', () => {
    expect(valueKindOf('{count + 1}')).toBe('expression');
    expect(valueKindOf('() => doThing()')).toBe('expression');
    expect(valueKindOf('<Icon />')).toBe('expression');
    expect(valueKindOf('`template ${x}`')).toBe('expression');
  });

  it('falls back to other for objects / null / undefined', () => {
    expect(valueKindOf({})).toBe('other');
    expect(valueKindOf(null)).toBe('other');
    expect(valueKindOf(undefined)).toBe('other');
    expect(valueKindOf([1, 2])).toBe('other');
  });
});

describe('WEBVIEW_ALLOWED_EVENTS', () => {
  it('contains the original webview-origin events', () => {
    expect(WEBVIEW_ALLOWED_EVENTS.has(TelemetryEvents.feedbackAiThumb)).toBe(true);
    expect(WEBVIEW_ALLOWED_EVENTS.has(TelemetryEvents.dissatisfactionRageClick)).toBe(true);
    expect(WEBVIEW_ALLOWED_EVENTS.has(TelemetryEvents.dissatisfactionDeadClick)).toBe(true);
    expect(WEBVIEW_ALLOWED_EVENTS.has(TelemetryEvents.dissatisfactionErrorClick)).toBe(true);
  });

  it('contains the new webview-origin canvas events', () => {
    expect(WEBVIEW_ALLOWED_EVENTS.has(TelemetryEvents.canvasElementSelected)).toBe(true);
    expect(WEBVIEW_ALLOWED_EVENTS.has(TelemetryEvents.canvasSelectionCleared)).toBe(true);
    expect(WEBVIEW_ALLOWED_EVENTS.has(TelemetryEvents.canvasElementHovered)).toBe(true);
    expect(WEBVIEW_ALLOWED_EVENTS.has(TelemetryEvents.canvasDragStarted)).toBe(true);
    expect(WEBVIEW_ALLOWED_EVENTS.has(TelemetryEvents.canvasDragEnded)).toBe(true);
    expect(WEBVIEW_ALLOWED_EVENTS.has(TelemetryEvents.canvasElementResized)).toBe(true);
    expect(WEBVIEW_ALLOWED_EVENTS.has(TelemetryEvents.canvasContextMenuOpened)).toBe(true);
  });

  it('rejects host-only events (router/ast/panel/explorer-host origin)', () => {
    expect(WEBVIEW_ALLOWED_EVENTS.has(TelemetryEvents.sessionActivated)).toBe(false);
    expect(WEBVIEW_ALLOWED_EVENTS.has(TelemetryEvents.errorUnhandled)).toBe(false);
    // Host-emitted: an inspector edit or panel/explorer event must NOT be
    // injectable from a webview via trackFromWebview.
    expect(WEBVIEW_ALLOWED_EVENTS.has(TelemetryEvents.inspectorPropEdited)).toBe(false);
    expect(WEBVIEW_ALLOWED_EVENTS.has(TelemetryEvents.inspectorStyleEdited)).toBe(false);
    expect(WEBVIEW_ALLOWED_EVENTS.has(TelemetryEvents.canvasElementInserted)).toBe(false);
    expect(WEBVIEW_ALLOWED_EVENTS.has(TelemetryEvents.canvasContextMenuAction)).toBe(false);
    expect(WEBVIEW_ALLOWED_EVENTS.has(TelemetryEvents.panelOpened)).toBe(false);
    expect(WEBVIEW_ALLOWED_EVENTS.has(TelemetryEvents.explorerItemSelected)).toBe(false);
  });
});
