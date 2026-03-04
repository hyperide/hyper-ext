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

  it('should resolve glm provider with default baseURL', () => {
    const result = resolveAIConfig({
      provider: 'glm',
      apiKey: 'glm-key',
      model: 'glm-4-flash',
    });
    expect(result).not.toBeNull();
    expect(result?.provider).toBe('anthropic');
    expect(result?.baseURL).toBeDefined();
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
});
