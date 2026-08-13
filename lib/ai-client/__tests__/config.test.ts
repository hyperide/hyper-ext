import { describe, expect, it, spyOn } from 'bun:test';
import { resolveAIConfig } from '../config';

describe('resolveAIConfig', () => {
  it('should resolve claude provider', () => {
    const result = resolveAIConfig({
      provider: 'claude',
      apiKey: 'sk-ant-test',
      model: 'claude-sonnet-4-20250514',
    });
    expect(result).toEqual({
      apiKey: 'sk-ant-test',
      model: 'claude-sonnet-4-20250514',
      baseURL: undefined,
      provider: 'anthropic',
    });
  });

  it('should resolve claude with custom baseURL', () => {
    const result = resolveAIConfig({
      provider: 'claude',
      apiKey: 'sk-ant-test',
      model: 'claude-sonnet-4-20250514',
      baseURL: 'https://custom.proxy.com',
    });
    expect(result).toEqual({
      apiKey: 'sk-ant-test',
      model: 'claude-sonnet-4-20250514',
      baseURL: 'https://custom.proxy.com',
      provider: 'anthropic',
    });
  });

  it('should resolve glm provider onto the OpenAI coding endpoint', () => {
    // Anthropic SDK is reserved for the real Anthropic API; GLM speaks OpenAI
    // chat completions at the coding-plan endpoint (no /v1 suffix — /v4!).
    const result = resolveAIConfig({
      provider: 'glm',
      apiKey: 'glm-key',
      model: 'glm-4.7',
    });
    expect(result).toEqual({
      apiKey: 'glm-key',
      model: 'glm-4.7',
      baseURL: 'https://api.z.ai/api/coding/paas/v4',
      provider: 'openai',
    });
  });

  it('should migrate stored legacy anthropic-default baseURLs for glm/firepass', () => {
    // Users have the old Anthropic-protocol defaults persisted in settings/DB;
    // those must be treated as "default" and re-pointed at the OpenAI endpoints,
    // not passed through as custom URLs.
    const glm = resolveAIConfig({
      provider: 'glm',
      apiKey: 'k',
      model: 'glm-4.7',
      baseURL: 'https://api.z.ai/api/anthropic',
    });
    expect(glm?.baseURL).toBe('https://api.z.ai/api/coding/paas/v4');
    expect(glm?.provider).toBe('openai');

    const fw = resolveAIConfig({
      provider: 'firepass',
      apiKey: 'k',
      model: 'accounts/fireworks/routers/kimi-k2p6-turbo',
      baseURL: 'https://api.fireworks.ai/inference',
    });
    expect(fw?.baseURL).toBe('https://api.fireworks.ai/inference/v1');
    expect(fw?.provider).toBe('openai');
  });

  it('should resolve firepass provider onto the OpenAI endpoint', () => {
    const result = resolveAIConfig({
      provider: 'firepass',
      apiKey: 'fw-key',
      model: 'accounts/fireworks/routers/kimi-k2p6-turbo',
    });
    expect(result).toEqual({
      apiKey: 'fw-key',
      model: 'accounts/fireworks/routers/kimi-k2p6-turbo',
      baseURL: 'https://api.fireworks.ai/inference/v1',
      provider: 'openai',
    });
  });

  it('should prefer explicit baseURL over default for firepass', () => {
    const result = resolveAIConfig({
      provider: 'firepass',
      apiKey: 'fw-key',
      model: 'accounts/fireworks/models/glm-5p1',
      baseURL: 'https://custom.fireworks.proxy',
    });
    expect(result).toEqual({
      apiKey: 'fw-key',
      model: 'accounts/fireworks/models/glm-5p1',
      baseURL: 'https://custom.fireworks.proxy',
      provider: 'openai',
    });
  });

  it('should route commandcode OSS models to OpenAI chat completions', () => {
    // Command Code docs: /messages serves Anthropic models ONLY; OSS models
    // (deepseek, qwen, kimi, …) must use /chat/completions or they get a 400.
    const result = resolveAIConfig({
      provider: 'commandcode',
      apiKey: 'cc-key',
      model: 'deepseek/deepseek-v4-pro',
    });
    expect(result).toEqual({
      apiKey: 'cc-key',
      model: 'deepseek/deepseek-v4-pro',
      baseURL: 'https://api.commandcode.ai/provider/v1',
      provider: 'openai',
    });
  });

  it('should route commandcode claude models to Anthropic Messages', () => {
    const result = resolveAIConfig({
      provider: 'commandcode',
      apiKey: 'cc-key',
      model: 'claude-sonnet-4-6',
    });
    expect(result).toEqual({
      apiKey: 'cc-key',
      model: 'claude-sonnet-4-6',
      baseURL: 'https://api.commandcode.ai/provider',
      provider: 'anthropic',
    });
  });

  it('should normalize a saved default commandcode baseURL per model family', () => {
    // The settings UI persists the provider default into config.baseURL — that
    // saved default must still be re-routed per model, not treated as custom.
    const oss = resolveAIConfig({
      provider: 'commandcode',
      apiKey: 'cc-key',
      model: 'deepseek/deepseek-v4-pro',
      baseURL: 'https://api.commandcode.ai/provider',
    });
    expect(oss?.baseURL).toBe('https://api.commandcode.ai/provider/v1');
    expect(oss?.provider).toBe('openai');

    const claude = resolveAIConfig({
      provider: 'commandcode',
      apiKey: 'cc-key',
      model: 'claude-sonnet-4-6',
      baseURL: 'https://api.commandcode.ai/provider/v1',
    });
    expect(claude?.baseURL).toBe('https://api.commandcode.ai/provider');
    expect(claude?.provider).toBe('anthropic');
  });

  it('should prefer explicit baseURL over default for commandcode', () => {
    const result = resolveAIConfig({
      provider: 'commandcode',
      apiKey: 'cc-key',
      model: 'Qwen/Qwen3.7-Max',
      baseURL: 'https://custom.commandcode.proxy',
    });
    expect(result).toEqual({
      apiKey: 'cc-key',
      model: 'Qwen/Qwen3.7-Max',
      baseURL: 'https://custom.commandcode.proxy',
      provider: 'openai',
    });
  });

  it('should resolve openai provider', () => {
    const result = resolveAIConfig({
      provider: 'openai',
      apiKey: 'sk-openai-test',
      model: 'gpt-4o',
    });
    expect(result).toEqual({
      apiKey: 'sk-openai-test',
      model: 'gpt-4o',
      baseURL: 'https://api.openai.com/v1',
      provider: 'openai',
    });
  });

  it('should resolve proxy with anthropic backend', () => {
    const result = resolveAIConfig({
      provider: 'proxy',
      apiKey: 'proxy-key',
      model: 'claude-sonnet-4-20250514',
      backend: 'anthropic',
      baseURL: 'http://localhost:4000',
    });
    expect(result).toEqual({
      apiKey: 'proxy-key',
      model: 'claude-sonnet-4-20250514',
      baseURL: 'http://localhost:4000',
      provider: 'anthropic',
    });
  });

  it('should resolve proxy with gemini backend', () => {
    const result = resolveAIConfig({
      provider: 'proxy',
      apiKey: 'proxy-key',
      model: 'gemini-2.0-flash',
      backend: 'gemini',
    });
    expect(result).not.toBeNull();
    expect(result?.provider).toBe('openai');
    expect(result?.baseURL).toContain('googleapis');
  });

  it('should resolve proxy with deepseek backend', () => {
    const result = resolveAIConfig({
      provider: 'proxy',
      apiKey: 'key',
      model: 'deepseek-chat',
      backend: 'deepseek',
    });
    expect(result).not.toBeNull();
    expect(result?.baseURL).toBe('https://api.deepseek.com/v1');
    expect(result?.provider).toBe('openai');
  });

  it('should return null for proxy without backend', () => {
    const result = resolveAIConfig({
      provider: 'proxy',
      apiKey: 'key',
      model: 'model',
    });
    expect(result).toBeNull();
  });

  it('should return null for proxy with unknown backend', () => {
    const result = resolveAIConfig({
      provider: 'proxy',
      apiKey: 'key',
      model: 'model',
      backend: 'unknown-backend-xyz',
    });
    expect(result).toBeNull();
  });

  it('should return null and warn for unknown provider', () => {
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    const result = resolveAIConfig({
      provider: 'totally-unknown',
      apiKey: 'key',
      model: 'model',
    });
    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('totally-unknown'));
    warnSpy.mockRestore();
  });

  it('should prefer explicit baseURL over default for proxy', () => {
    const result = resolveAIConfig({
      provider: 'proxy',
      apiKey: 'key',
      model: 'model',
      backend: 'gemini',
      baseURL: 'http://localhost:4000',
    });
    expect(result).not.toBeNull();
    expect(result?.baseURL).toBe('http://localhost:4000');
  });

  it('should handle opencode with backend the same as proxy', () => {
    const result = resolveAIConfig({
      provider: 'opencode',
      apiKey: 'key',
      model: 'model',
      backend: 'openai',
    });
    expect(result).not.toBeNull();
    expect(result?.provider).toBe('openai');
    expect(result?.baseURL).toBe('https://api.openai.com/v1');
  });

  it('should strip provider prefix from opencode model', () => {
    const result = resolveAIConfig({
      provider: 'opencode',
      apiKey: 'key',
      model: 'google/gemini-2.5-pro',
      backend: 'google',
    });
    expect(result).not.toBeNull();
    expect(result?.model).toBe('gemini-2.5-pro');
    expect(result?.provider).toBe('openai');
  });

  it('should strip provider prefix from opencode model with anthropic backend', () => {
    const result = resolveAIConfig({
      provider: 'opencode',
      apiKey: 'key',
      model: 'anthropic/claude-sonnet-4-20250514',
      backend: 'anthropic',
    });
    expect(result).not.toBeNull();
    expect(result?.model).toBe('claude-sonnet-4-20250514');
    expect(result?.provider).toBe('anthropic');
  });

  it('should NOT strip model prefix for proxy provider', () => {
    const result = resolveAIConfig({
      provider: 'proxy',
      apiKey: 'key',
      model: 'gemini-2.5-pro',
      backend: 'google',
    });
    expect(result).not.toBeNull();
    expect(result?.model).toBe('gemini-2.5-pro');
  });
});
