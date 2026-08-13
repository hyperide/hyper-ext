/**
 * @file HYP-991 — tests for the post-edit diagnostic notification text builders.
 */

import { describe, expect, it } from 'bun:test';
import type { PostEditDiagnosticWarning } from '../../../../../shared/types/post-edit-diagnostic-warning';
import {
  AUTO_FIX_ACTION,
  buildPostEditAiFixPrompt,
  buildPostEditNotificationMessage,
} from '../post-edit-diagnostic-notify';

function warning(overrides: Partial<PostEditDiagnosticWarning> = {}): PostEditDiagnosticWarning {
  const base: PostEditDiagnosticWarning = {
    elementId: 'src/Card.tsx:15:8',
    componentPath: 'src/Card.tsx',
    mutationType: 'ast:updateStyles',
    diagnostics: [{ filePath: '/ws/src/Card.tsx', message: "Property 'style' does not exist", line: 17, column: 4 }],
    totalErrorCount: 1,
    ...overrides,
  };
  // Default totalErrorCount to the diagnostics length unless the caller overrode it explicitly.
  if (overrides.diagnostics && overrides.totalErrorCount === undefined)
    base.totalErrorCount = overrides.diagnostics.length;
  return base;
}

describe('post-edit-diagnostic-notify', () => {
  it('builds a single-line message with the headline error and basename:line', () => {
    const msg = buildPostEditNotificationMessage(warning());
    expect(msg).toContain('this edit left a code error');
    expect(msg).toContain("Property 'style' does not exist");
    expect(msg).toContain('Card.tsx:17');
    expect(msg).not.toContain('\n'); // native toast is one line
  });

  it('adds a "+N more" tail when several errors were introduced', () => {
    const msg = buildPostEditNotificationMessage(
      warning({
        diagnostics: [
          { filePath: '/ws/a.tsx', message: 'e1', line: 1, column: 0 },
          { filePath: '/ws/b.tsx', message: 'e2', line: 2, column: 0 },
          { filePath: '/ws/c.tsx', message: 'e3', line: 3, column: 0 },
        ],
      }),
    );
    expect(msg).toContain('(+2 more)');
  });

  it('reports the TRUE total, not the capped payload length, in message and prompt', () => {
    const w = warning({
      diagnostics: [
        { filePath: '/ws/a.tsx', message: 'e1', line: 1, column: 0 },
        { filePath: '/ws/b.tsx', message: 'e2', line: 2, column: 0 },
      ],
      totalErrorCount: 8, // 8 introduced, only 2 carried in the payload
    });
    expect(buildPostEditNotificationMessage(w)).toContain('(+7 more)');
    const prompt = buildPostEditAiFixPrompt(w);
    expect(prompt).toContain('8 new');
    expect(prompt).toContain('showing the first 2');
  });

  it('collapses a multi-line diagnostic message into one line for the native toast', () => {
    const w = warning({
      diagnostics: [{ filePath: '/ws/x.tsx', message: 'Type A\n  is not assignable to\n  Type B', line: 3, column: 0 }],
    });
    expect(buildPostEditNotificationMessage(w)).not.toContain('\n');
  });

  it('builds an AI-fix prompt naming the mutation, element, and every error', () => {
    const prompt = buildPostEditAiFixPrompt(warning());
    expect(prompt).toContain('ast:updateStyles');
    expect(prompt).toContain('src/Card.tsx:15:8');
    expect(prompt).toContain("Property 'style' does not exist");
  });

  it('omits the element clause when elementId is null', () => {
    const prompt = buildPostEditAiFixPrompt(warning({ elementId: null }));
    expect(prompt).not.toContain('on element');
  });

  it('exposes the action label constant', () => {
    expect(AUTO_FIX_ACTION).toBe('Auto fix via AI');
  });
});
