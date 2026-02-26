import { useCallback, useEffect, useState } from 'react';
import { NetworkStatusIndicator } from '@/components/NetworkStatusIndicator';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useNetworkAwareFetch } from '@/hooks/useNetworkAwareFetch';
import { useAuthStore } from '@/stores/authStore';
import { authFetch } from '@/utils/authFetch';
import { AI_PROVIDER_DEFAULTS, type AIProvider } from '../../shared/ai-provider-defaults';

interface AIConfig {
  id: number;
  provider: AIProvider;
  apiKey: string;
  baseURL: string | null;
  model: string;
  commitPrompt: string | null;
  braveSearchApiKey: string;
}

// Shared model interface for multi-provider systems
interface ProviderModel {
  id: string;
  name: string;
  publisher: string;
  keyType: 'gemini' | 'google' | 'openai' | 'anthropic' | 'deepseek' | 'mistral' | 'groq' | 'qwen';
}

// Legacy alias for proxy
type ProxyModel = ProviderModel;

const PROXY_MODELS: ProxyModel[] = [
  // Google (prefix: gemini/)
  {
    id: 'gemini/gemini-3-pro-preview',
    name: 'Gemini 3 Pro',
    publisher: 'Google',
    keyType: 'gemini',
  },
  {
    id: 'gemini/gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    publisher: 'Google',
    keyType: 'gemini',
  },
  {
    id: 'gemini/gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    publisher: 'Google',
    keyType: 'gemini',
  },
  // DeepSeek (prefix: deepseek/) - both are V3.2
  {
    id: 'deepseek/deepseek-chat',
    name: 'DeepSeek V3.2',
    publisher: 'DeepSeek',
    keyType: 'deepseek',
  },
  {
    id: 'deepseek/deepseek-reasoner',
    name: 'DeepSeek R1 (V3.2 Reasoning)',
    publisher: 'DeepSeek',
    keyType: 'deepseek',
  },
  // Mistral (prefix: mistral/)
  {
    id: 'mistral/mistral-large-latest',
    name: 'Mistral Large',
    publisher: 'Mistral',
    keyType: 'mistral',
  },
  {
    id: 'mistral/codestral-latest',
    name: 'Codestral',
    publisher: 'Mistral',
    keyType: 'mistral',
  },
  // Groq (prefix: groq/)
  {
    id: 'groq/llama-3.3-70b-versatile',
    name: 'Llama 3.3 70B',
    publisher: 'Groq',
    keyType: 'groq',
  },
  {
    id: 'groq/mixtral-8x7b-32768',
    name: 'Mixtral 8x7B',
    publisher: 'Groq',
    keyType: 'groq',
  },
];

// OpenCode models (native SDK integration)
const OPENCODE_MODELS: ProviderModel[] = [
  // Google Gemini
  {
    id: 'google/gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    publisher: 'Google',
    keyType: 'google',
  },
  {
    id: 'google/gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    publisher: 'Google',
    keyType: 'google',
  },
  {
    id: 'google/gemini-2.0-flash',
    name: 'Gemini 2.0 Flash',
    publisher: 'Google',
    keyType: 'google',
  },
  // DeepSeek (deepseek-chat and deepseek-reasoner are both V3.2)
  {
    id: 'deepseek/deepseek-chat',
    name: 'DeepSeek V3.2',
    publisher: 'DeepSeek',
    keyType: 'deepseek',
  },
  {
    id: 'deepseek/deepseek-reasoner',
    name: 'DeepSeek R1 (V3.2 Reasoning)',
    publisher: 'DeepSeek',
    keyType: 'deepseek',
  },
  // Qwen (Alibaba)
  {
    id: 'qwen/qwen-max',
    name: 'Qwen Max',
    publisher: 'Alibaba',
    keyType: 'qwen',
  },
  {
    id: 'qwen/qwen-plus',
    name: 'Qwen Plus',
    publisher: 'Alibaba',
    keyType: 'qwen',
  },
  {
    id: 'qwen/qwen-coder-plus',
    name: 'Qwen Coder Plus',
    publisher: 'Alibaba',
    keyType: 'qwen',
  },
];

// Group models by publisher
const PROXY_MODELS_GROUPED = PROXY_MODELS.reduce(
  (acc, model) => {
    if (!acc[model.publisher]) {
      acc[model.publisher] = [];
    }
    acc[model.publisher].push(model);
    return acc;
  },
  {} as Record<string, ProxyModel[]>,
);

const OPENCODE_MODELS_GROUPED = OPENCODE_MODELS.reduce(
  (acc, model) => {
    if (!acc[model.publisher]) {
      acc[model.publisher] = [];
    }
    acc[model.publisher].push(model);
    return acc;
  },
  {} as Record<string, ProviderModel[]>,
);

// API key info by type
const KEY_INFO: Record<
  ProviderModel['keyType'],
  { label: string; placeholder: string; helpUrl: string; helpText: string }
> = {
  gemini: {
    label: 'Gemini API Key',
    placeholder: 'AIza...',
    helpUrl: 'https://aistudio.google.com/apikey',
    helpText: 'Get free key at Google AI Studio',
  },
  google: {
    label: 'Google AI API Key',
    placeholder: 'AIza...',
    helpUrl: 'https://aistudio.google.com/apikey',
    helpText: 'Get free key at Google AI Studio',
  },
  deepseek: {
    label: 'DeepSeek API Key',
    placeholder: 'sk-...',
    helpUrl: 'https://platform.deepseek.com/api_keys',
    helpText: 'Get key at DeepSeek Platform',
  },
  qwen: {
    label: 'Qwen API Key',
    placeholder: 'sk-...',
    helpUrl: 'https://dashscope.console.aliyun.com/apiKey',
    helpText: 'Get key at Alibaba DashScope',
  },
  mistral: {
    label: 'Mistral API Key',
    placeholder: '',
    helpUrl: 'https://console.mistral.ai/api-keys',
    helpText: 'Get key at Mistral Console',
  },
  groq: {
    label: 'Groq API Key',
    placeholder: 'gsk_...',
    helpUrl: 'https://console.groq.com/keys',
    helpText: 'Get free key at Groq Console',
  },
  openai: {
    label: 'OpenAI API Key',
    placeholder: 'sk-...',
    helpUrl: 'https://platform.openai.com/api-keys',
    helpText: 'Get key at OpenAI Platform',
  },
  anthropic: {
    label: 'Anthropic API Key',
    placeholder: 'sk-ant-...',
    helpUrl: 'https://console.anthropic.com/settings/keys',
    helpText: 'Get key at Anthropic Console',
  },
};

export default function AISettings() {
  const { currentWorkspace } = useAuthStore();
  const [config, setConfig] = useState<AIConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [apiKey, setApiKey] = useState('');

  // Proxy-specific state
  const [proxyApiKey, setProxyApiKey] = useState('');
  const [selectedProxyModel, setSelectedProxyModel] = useState<string>('');

  // OpenCode-specific state
  const [openCodeApiKey, setOpenCodeApiKey] = useState('');
  const [selectedOpenCodeModel, setSelectedOpenCodeModel] = useState<string>('');

  // Commit prompt state
  const [commitPrompt, setCommitPrompt] = useState('');
  const [defaultCommitPrompt, setDefaultCommitPrompt] = useState('');

  // External APIs state
  const [braveSearchApiKey, setBraveSearchApiKey] = useState('');

  // Network-aware config loading
  const {
    data: fetchedConfig,
    error: configError,
    isNetworkError: isConfigNetworkError,
    isOffline,
    isLoading: loading,
    refetch: refetchConfig,
  } = useNetworkAwareFetch(
    async () => {
      if (!currentWorkspace) return null;
      const response = await authFetch(`/api/ai-config?workspaceId=${currentWorkspace.id}`);
      if (!response.ok) {
        // Config doesn't exist yet - that's OK, return empty form
        return {
          id: 0,
          provider: 'glm' as const,
          apiKey: '',
          baseURL: AI_PROVIDER_DEFAULTS.glm.baseURL,
          model: AI_PROVIDER_DEFAULTS.glm.model,
          commitPrompt: null,
          braveSearchApiKey: '',
        };
      }
      return response.json();
    },
    {
      deps: [currentWorkspace?.id],
      autoRetryOnReconnect: true,
      skip: !currentWorkspace,
    },
  );

  // Sync fetched config to local state
  useEffect(() => {
    if (fetchedConfig) {
      setConfig(fetchedConfig);
      setCommitPrompt(fetchedConfig.commitPrompt || '');
      if (fetchedConfig.provider === 'proxy' && fetchedConfig.model) {
        setSelectedProxyModel(fetchedConfig.model);
      }
      if (fetchedConfig.provider === 'opencode' && fetchedConfig.model) {
        setSelectedOpenCodeModel(fetchedConfig.model);
      }
    }
  }, [fetchedConfig]);

  const loadDefaultCommitPrompt = useCallback(async () => {
    try {
      const response = await authFetch('/api/git/default-commit-prompt');
      if (response.ok) {
        const data = await response.json();
        setDefaultCommitPrompt(data.prompt);
      }
    } catch (error) {
      console.error('Failed to load default commit prompt:', error);
    }
  }, []);

  useEffect(() => {
    if (currentWorkspace) {
      loadDefaultCommitPrompt();
    }
  }, [currentWorkspace, loadDefaultCommitPrompt]);

  // Get the selected model info (proxy)
  const getSelectedProxyModelInfo = (): ProxyModel | undefined => {
    return PROXY_MODELS.find((m) => m.id === selectedProxyModel);
  };

  // Get the selected model info (opencode)
  const getSelectedOpenCodeModelInfo = (): ProviderModel | undefined => {
    return OPENCODE_MODELS.find((m) => m.id === selectedOpenCodeModel);
  };

  // Get key type for current model (unified for both providers)
  const getRequiredKeyType = (): ProviderModel['keyType'] | null => {
    if (config?.provider === 'opencode') {
      const model = getSelectedOpenCodeModelInfo();
      return model?.keyType || null;
    }
    const model = getSelectedProxyModelInfo();
    return model?.keyType || null;
  };

  const handleProviderChange = (provider: AIProvider) => {
    if (!config) return;

    const newConfig = { ...config, provider };

    // Set defaults based on provider
    switch (provider) {
      case 'glm':
        newConfig.baseURL = AI_PROVIDER_DEFAULTS.glm.baseURL;
        newConfig.model = AI_PROVIDER_DEFAULTS.glm.model;
        break;
      case 'claude':
        newConfig.baseURL = AI_PROVIDER_DEFAULTS.claude.baseURL;
        newConfig.model = AI_PROVIDER_DEFAULTS.claude.model;
        break;
      case 'openai':
        newConfig.baseURL = AI_PROVIDER_DEFAULTS.openai.baseURL;
        newConfig.model = AI_PROVIDER_DEFAULTS.openai.model;
        break;
      case 'proxy':
        // Don't set default model - user must choose
        newConfig.model = '';
        newConfig.baseURL = null;
        setSelectedProxyModel('');
        setProxyApiKey('');
        break;
      case 'opencode':
        // Don't set default model - user must choose
        newConfig.model = '';
        newConfig.baseURL = null;
        setSelectedOpenCodeModel('');
        setOpenCodeApiKey('');
        break;
    }

    setConfig(newConfig);
  };

  const handleProxyModelChange = (modelId: string) => {
    setSelectedProxyModel(modelId);
    setProxyApiKey(''); // Reset API key when model changes

    if (config) {
      setConfig({ ...config, model: modelId });
    }
  };

  const handleOpenCodeModelChange = (modelId: string) => {
    setSelectedOpenCodeModel(modelId);
    setOpenCodeApiKey(''); // Reset API key when model changes

    if (config) {
      setConfig({ ...config, model: modelId });
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentWorkspace) return;

    setSaving(true);
    setMessage(null);

    try {
      const updates: Record<string, unknown> = {
        workspaceId: currentWorkspace.id,
      };

      if (config) {
        updates.provider = config.provider;
        updates.model = config.model;
        updates.baseURL = config.baseURL;
        // Save commit prompt (null if empty to use default)
        updates.commitPrompt = commitPrompt.trim() || null;

        if (config.provider === 'proxy') {
          // For proxy, validate model and key
          if (!selectedProxyModel) {
            throw new Error('Please select a model');
          }
          if (!proxyApiKey && !config.apiKey) {
            throw new Error('Please enter the API key');
          }
          // Store proxy API key and backend type separately
          if (proxyApiKey) {
            updates.apiKey = proxyApiKey;
            updates.backend = getRequiredKeyType();
          }
        } else if (config.provider === 'opencode') {
          // For opencode, validate model and key
          if (!selectedOpenCodeModel) {
            throw new Error('Please select a model');
          }
          if (!openCodeApiKey && !config.apiKey) {
            throw new Error('Please enter the API key');
          }
          // Store opencode API key and backend type separately
          if (openCodeApiKey) {
            updates.apiKey = openCodeApiKey;
            updates.backend = getRequiredKeyType();
          }
        } else if (apiKey && apiKey.trim().length > 0) {
          updates.apiKey = apiKey;
        }

        // Save Brave Search API key if provided
        if (braveSearchApiKey && braveSearchApiKey.trim().length > 0) {
          updates.braveSearchApiKey = braveSearchApiKey;
        }
      }

      const response = await authFetch('/api/ai-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });

      if (!response.ok) {
        throw new Error('Failed to save config');
      }

      setMessage({
        type: 'success',
        text: 'AI configuration saved successfully!',
      });
      refetchConfig();
      setApiKey('');
      setProxyApiKey('');
      setOpenCodeApiKey('');
      setBraveSearchApiKey('');
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Failed to save configuration',
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="text-center py-12">Loading AI configuration...</div>;
  }

  // Network error - show banner with retry
  if (isConfigNetworkError) {
    return (
      <Card>
        <CardContent className="py-6">
          <NetworkStatusIndicator variant="banner" isOffline={isOffline} onRetry={refetchConfig} />
        </CardContent>
      </Card>
    );
  }

  // Server error or no config
  if (!config) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <p className="text-destructive">{configError || 'Failed to load AI configuration'}</p>
        </CardContent>
      </Card>
    );
  }

  const isProxyProvider = config.provider === 'proxy';
  const isOpenCodeProvider = config.provider === 'opencode';
  const requiredKeyType = getRequiredKeyType();
  const keyInfo = requiredKeyType ? KEY_INFO[requiredKeyType] : null;
  const hasExistingProxyKey = isProxyProvider && config.apiKey && config.apiKey.length > 0;
  const hasExistingOpenCodeKey = isOpenCodeProvider && config.apiKey && config.apiKey.length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>AI Configuration</CardTitle>
        <CardDescription>Configure the AI model used for code generation. Default is GLM-4.6 via Z.ai.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSave} className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="provider">Provider</Label>
            <select
              id="provider"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base"
              value={config.provider}
              onChange={(e) => handleProviderChange(e.target.value as AIProvider)}
            >
              <option value="glm">GLM (Z.ai)</option>
              <option value="claude">Claude (Anthropic)</option>
              <option value="openai">OpenAI or other</option>
              <option value="proxy">Proxy (Gemini, DeepSeek, Mistral, Groq)</option>
              <option value="opencode">OpenCode (Gemini, DeepSeek, Qwen)</option>
            </select>
          </div>

          {isProxyProvider ? (
            <>
              {/* Model selection */}
              <div className="space-y-2">
                <Label htmlFor="proxyModel">Model</Label>
                <select
                  id="proxyModel"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base"
                  value={selectedProxyModel}
                  onChange={(e) => handleProxyModelChange(e.target.value)}
                >
                  <option value="">Select a model...</option>
                  {Object.entries(PROXY_MODELS_GROUPED).map(([publisher, models]) => (
                    <optgroup key={publisher} label={publisher}>
                      {models.map((model) => (
                        <option key={model.id} value={model.id}>
                          {model.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  Proxy will start automatically when you use the AI agent
                </p>
              </div>

              {/* Show API key field only when model is selected */}
              {selectedProxyModel && keyInfo && (
                <div className="space-y-2">
                  <Label htmlFor="proxyApiKey">{keyInfo.label}</Label>
                  <Input
                    id="proxyApiKey"
                    type="password"
                    value={proxyApiKey}
                    onChange={(e) => setProxyApiKey(e.target.value)}
                    placeholder={hasExistingProxyKey ? 'Key saved. Enter new key to update.' : keyInfo.placeholder}
                  />
                  <p className="text-xs text-muted-foreground">
                    {keyInfo.helpText}{' '}
                    <a href={keyInfo.helpUrl} target="_blank" rel="noopener noreferrer" className="underline">
                      Get API key
                    </a>
                  </p>
                </div>
              )}
            </>
          ) : isOpenCodeProvider ? (
            <>
              {/* OpenCode Model selection */}
              <div className="space-y-2">
                <Label htmlFor="openCodeModel">Model</Label>
                <select
                  id="openCodeModel"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base"
                  value={selectedOpenCodeModel}
                  onChange={(e) => handleOpenCodeModelChange(e.target.value)}
                >
                  <option value="">Select a model...</option>
                  {Object.entries(OPENCODE_MODELS_GROUPED).map(([publisher, models]) => (
                    <optgroup key={publisher} label={publisher}>
                      {models.map((model) => (
                        <option key={model.id} value={model.id}>
                          {model.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  OpenCode server will start automatically when you use the AI agent
                </p>
              </div>

              {/* Show API key field only when model is selected */}
              {selectedOpenCodeModel && keyInfo && (
                <div className="space-y-2">
                  <Label htmlFor="openCodeApiKey">{keyInfo.label}</Label>
                  <Input
                    id="openCodeApiKey"
                    type="password"
                    value={openCodeApiKey}
                    onChange={(e) => setOpenCodeApiKey(e.target.value)}
                    placeholder={hasExistingOpenCodeKey ? 'Key saved. Enter new key to update.' : keyInfo.placeholder}
                  />
                  <p className="text-xs text-muted-foreground">
                    {keyInfo.helpText}{' '}
                    <a href={keyInfo.helpUrl} target="_blank" rel="noopener noreferrer" className="underline">
                      Get API key
                    </a>
                  </p>
                </div>
              )}
            </>
          ) : config.provider === 'glm' ? (
            <>
              {/* GLM provider UI */}
              <div className="space-y-2">
                <Label htmlFor="model">Model</Label>
                <Input
                  id="model"
                  value={config.model}
                  onChange={(e) => setConfig({ ...config, model: e.target.value })}
                  placeholder="glm-4.7"
                  required
                />
                <p className="text-sm text-muted-foreground">Examples: glm-4.7, glm-4.6, glm-4</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="apiKey">API Key</Label>
                <Input
                  id="apiKey"
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={config.apiKey ? `Current: ${config.apiKey}` : 'Enter API key'}
                />
                <p className="text-sm text-muted-foreground">
                  {config.apiKey
                    ? 'Enter a new key to update it, or leave blank to keep current.'
                    : 'Your API key will be stored securely.'}{' '}
                  <a
                    href="https://z.ai/manage-apikey/subscription"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-foreground"
                  >
                    Create &amp; Manage API key — Z.ai
                  </a>
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="baseURL">Base URL</Label>
                <Input
                  id="baseURL"
                  value={config.baseURL || ''}
                  onChange={(e) => setConfig({ ...config, baseURL: e.target.value || null })}
                  placeholder={AI_PROVIDER_DEFAULTS.glm.baseURL ?? ''}
                />
              </div>
            </>
          ) : config.provider === 'claude' ? (
            <>
              {/* Claude provider UI - no baseURL */}
              <div className="space-y-2">
                <Label htmlFor="model">Model</Label>
                <Input
                  id="model"
                  value={config.model}
                  onChange={(e) => setConfig({ ...config, model: e.target.value })}
                  placeholder="claude-sonnet-4-20250514"
                  required
                />
                <p className="text-sm text-muted-foreground">
                  Examples: claude-sonnet-4-20250514, claude-opus-4-20250514
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="apiKey">API Key</Label>
                <Input
                  id="apiKey"
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={config.apiKey ? `Current: ${config.apiKey}` : 'sk-ant-...'}
                />
                <p className="text-sm text-muted-foreground">
                  {config.apiKey
                    ? 'Enter a new key to update it, or leave blank to keep current.'
                    : 'Your API key will be stored securely.'}{' '}
                  <a
                    href="https://console.anthropic.com/settings/keys"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-foreground"
                  >
                    Get API key — Anthropic Console
                  </a>
                </p>
              </div>
            </>
          ) : (
            <>
              {/* OpenAI or other provider UI */}
              <div className="space-y-2">
                <Label htmlFor="model">Model</Label>
                <Input
                  id="model"
                  value={config.model}
                  onChange={(e) => setConfig({ ...config, model: e.target.value })}
                  placeholder="gpt-4o"
                  required
                />
                <p className="text-sm text-muted-foreground">Examples: gpt-4o, gpt-4o-mini, o1, o3-mini</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="apiKey">API Key</Label>
                <Input
                  id="apiKey"
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={config.apiKey ? `Current: ${config.apiKey}` : 'sk-...'}
                />
                <p className="text-sm text-muted-foreground">
                  {config.apiKey
                    ? 'Enter a new key to update it, or leave blank to keep current.'
                    : 'Your API key will be stored securely.'}{' '}
                  <a
                    href="https://platform.openai.com/api-keys"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-foreground"
                  >
                    Get API key — OpenAI Platform
                  </a>
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="baseURL">Base URL</Label>
                <Input
                  id="baseURL"
                  value={config.baseURL || ''}
                  onChange={(e) => setConfig({ ...config, baseURL: e.target.value || null })}
                  placeholder="https://api.openai.com/v1"
                />
                <p className="text-sm text-muted-foreground">
                  Default: https://api.openai.com/v1
                  <br />
                  Change for OpenAI-compatible APIs (Azure, local, etc.)
                </p>
              </div>
            </>
          )}

          {/* Commit Message Prompt */}
          <div className="space-y-2 pt-4 border-t">
            <div className="flex items-center justify-between">
              <Label htmlFor="commitPrompt">Commit Message Prompt</Label>
              {commitPrompt && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setCommitPrompt('')}
                  className="h-6 px-2 text-xs"
                >
                  Reset to default
                </Button>
              )}
            </div>
            <Textarea
              id="commitPrompt"
              value={commitPrompt || defaultCommitPrompt}
              onChange={(e) => setCommitPrompt(e.target.value)}
              placeholder={defaultCommitPrompt}
              className="min-h-[200px] font-mono text-xs"
            />
            <p className="text-xs text-muted-foreground">
              Customize the prompt used for AI commit message generation. Use{' '}
              <code className="bg-muted px-1 rounded">{'{diff}'}</code> for changes and{' '}
              <code className="bg-muted px-1 rounded">{'{examples}'}</code> for commit history examples.
            </p>
          </div>

          {/* External APIs */}
          <div className="space-y-4 pt-4 border-t">
            <div>
              <h3 className="text-sm font-medium">External APIs</h3>
              <p className="text-xs text-muted-foreground">
                Configure API keys for external services used by the AI agent
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="braveSearchApiKey">Brave Search API Key</Label>
              <Input
                id="braveSearchApiKey"
                type="password"
                value={braveSearchApiKey}
                onChange={(e) => setBraveSearchApiKey(e.target.value)}
                placeholder={
                  config.braveSearchApiKey ? `Current: ${config.braveSearchApiKey}` : 'Enter Brave Search API key'
                }
              />
              <p className="text-xs text-muted-foreground">
                {config.braveSearchApiKey
                  ? 'Enter a new key to update it, or leave blank to keep current.'
                  : 'Enables web search capability for the AI agent.'}{' '}
                <a
                  href="https://brave.com/search/api/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-foreground"
                >
                  Get API key — Brave Search
                </a>
              </p>
            </div>
          </div>

          {message && (
            <div
              className={`p-3 rounded-md text-sm ${
                message.type === 'success'
                  ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                  : 'bg-destructive/10 text-destructive'
              }`}
            >
              {message.text}
            </div>
          )}

          <Button type="submit" disabled={saving}>
            {saving ? 'Saving...' : 'Save Configuration'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
