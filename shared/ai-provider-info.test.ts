/**
 * Tests for ai-provider-info purchase hints (HYP-640).
 *
 * Each provider must expose a purchaseHint: a short string
 * telling the user HOW to get access (link to buy/subscribe).
 * The PROVIDER_PURCHASE_HINTS map is the single source of truth
 * consumed by both SaaS (AISettings) and ext (QuickPick detail).
 */

import { describe, expect, it } from 'bun:test';
import { AI_PROVIDER_DEFAULTS, type AIProvider } from './ai-provider-defaults';
import { COMMANDCODE_INFO, FIREPASS_INFO, GLM_RECOMMENDATION, PROVIDER_PURCHASE_HINTS } from './ai-provider-info';

// Every known provider must have a hint
const ALL_PROVIDERS = Object.keys(AI_PROVIDER_DEFAULTS) as AIProvider[];

describe('PROVIDER_PURCHASE_HINTS', () => {
  it('has a non-empty purchaseHint for every provider', () => {
    for (const provider of ALL_PROVIDERS) {
      const hint = PROVIDER_PURCHASE_HINTS[provider];
      expect(hint, `missing purchaseHint for provider "${provider}"`).toBeDefined();
      expect(hint.text.length, `empty purchaseHint.text for provider "${provider}"`).toBeGreaterThan(0);
      expect(hint.url.length, `empty purchaseHint.url for provider "${provider}"`).toBeGreaterThan(0);
    }
  });

  it('commandcode hint points to subscribeUrl from COMMANDCODE_INFO', () => {
    expect(PROVIDER_PURCHASE_HINTS.commandcode.url).toBe(COMMANDCODE_INFO.subscribeUrl);
  });

  it('commandcode hint text mentions starting price ($1/mo)', () => {
    expect(PROVIDER_PURCHASE_HINTS.commandcode.text).toContain('$1/mo');
  });

  it('firepass hint points to subscribeUrl from FIREPASS_INFO', () => {
    expect(PROVIDER_PURCHASE_HINTS.firepass.url).toBe(FIREPASS_INFO.subscribeUrl);
  });

  it('glm hint points to subscribeUrl from GLM_RECOMMENDATION', () => {
    expect(PROVIDER_PURCHASE_HINTS.glm.url).toBe(GLM_RECOMMENDATION.subscribeUrl);
  });

  it('claude hint points to Anthropic console pricing', () => {
    expect(PROVIDER_PURCHASE_HINTS.claude.url).toContain('anthropic.com');
  });

  it('openai hint points to OpenAI pricing', () => {
    expect(PROVIDER_PURCHASE_HINTS.openai.url).toContain('openai.com');
  });

  it('proxy and opencode hints have valid https URLs', () => {
    for (const provider of ['proxy', 'opencode'] as AIProvider[]) {
      expect(PROVIDER_PURCHASE_HINTS[provider].url).toMatch(/^https?:\/\//);
    }
  });
});
