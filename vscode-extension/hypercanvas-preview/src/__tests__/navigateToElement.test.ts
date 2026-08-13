/**
 * @file MCP `hyper_navigate_to_element` column conversion: getElementLocation returns a Babel
 * 0-based column, but goToCode expects a 1-based column (it subtracts 1 for the VS Code Position).
 * navigateToElement MUST add 1 — otherwise navigation lands one char left and column 0 underflows
 * to -1. Guards the off-by-one that the other callers (SyncPositionService, goToCodeSelected)
 * already get right.
 */
import { describe, expect, it, mock } from 'bun:test';
import type { AstService } from '../services/AstService';
import { navigateToElement } from '../extension-mcp-setup';

function fakeAstService(location: { line: number; column: number } | null): Pick<AstService, 'getElementLocation'> {
  return { getElementLocation: mock(() => Promise.resolve(location)) } as unknown as Pick<
    AstService,
    'getElementLocation'
  >;
}

describe('navigateToElement (MCP onNavigate)', () => {
  it('passes a 1-based column to goToCode (0-based loc.column + 1)', async () => {
    const navigate = mock(() => Promise.resolve());
    const astService = fakeAstService({ line: 12, column: 6 }); // Babel 0-based column

    await navigateToElement(astService, 'src/App.tsx', 'src/App.tsx:12:6', navigate);

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('src/App.tsx', 12, 7); // column 6 → 7, NOT 6
  });

  it('lifts column 0 to 1 (the underflow case: goToCode would otherwise build Position col -1)', async () => {
    const navigate = mock(() => Promise.resolve());
    const astService = fakeAstService({ line: 3, column: 0 });

    await navigateToElement(astService, 'src/App.tsx', 'src/App.tsx:3:0', navigate);

    expect(navigate).toHaveBeenCalledWith('src/App.tsx', 3, 1); // 0 → 1, not -1
  });

  it('does not move the editor when the element cannot be resolved', async () => {
    const navigate = mock(() => Promise.resolve());
    const astService = fakeAstService(null);

    await navigateToElement(astService, 'src/App.tsx', 'nope', navigate);

    expect(navigate).not.toHaveBeenCalled();
  });
});
