import { useState } from 'react';
import { GLM_RECOMMENDATION, PROVIDER_LABELS } from '../../../shared/ai-provider-info';

interface EmptyStateProps {
  hasApiKey?: boolean | null;
  onConfigureProvider?: () => void;
}

export function EmptyState({ hasApiKey, onConfigureProvider }: EmptyStateProps) {
  return (
    <div className="py-6 space-y-4">
      <div className="text-center text-sm text-muted-foreground">
        <p>Ask me anything about your code!</p>
        <p className="text-xs mt-1">I can read files, edit code, search, and run git commands.</p>
      </div>

      {hasApiKey === false && <ProviderBanner onConfigure={onConfigureProvider} />}
    </div>
  );
}

function ProviderBanner({ onConfigure }: { onConfigure?: () => void }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="mx-1 rounded-md border border-border bg-muted/40 text-xs">
      <div className="p-3 space-y-2">
        <p className="font-medium text-foreground">Set up an AI provider to get started</p>

        {/* GLM — recommended, expandable */}
        <button
          type="button"
          className="w-full text-left rounded border border-border bg-background p-2 hover:bg-accent transition-colors"
          onClick={() => setExpanded(!expanded)}
        >
          <div className="flex items-center justify-between">
            <span className="font-medium text-foreground">
              {PROVIDER_LABELS.glm}
              <span className="ml-1.5 text-[10px] font-normal text-muted-foreground bg-muted px-1 py-0.5 rounded">
                recommended
              </span>
            </span>
            <span className="text-muted-foreground">{expanded ? '\u25B2' : '\u25BC'}</span>
          </div>
          {!expanded && <p className="text-muted-foreground mt-0.5">Flat-rate from $10/mo, not per-token</p>}
        </button>

        {expanded && (
          <div className="rounded border border-border bg-background p-2.5 space-y-2">
            <p className="text-muted-foreground">{GLM_RECOMMENDATION.description}</p>

            <table className="w-full text-left">
              <thead>
                <tr className="text-muted-foreground">
                  <th className="font-medium pb-1">Plan</th>
                  <th className="font-medium pb-1">Price</th>
                  <th className="font-medium pb-1">vs Claude</th>
                </tr>
              </thead>
              <tbody className="text-foreground">
                {GLM_RECOMMENDATION.plans.map((plan) => (
                  <tr key={plan.name}>
                    <td className="py-0.5">{plan.name}</td>
                    <td className="py-0.5">{plan.price}</td>
                    <td className="py-0.5 text-muted-foreground">{plan.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <a
              href={GLM_RECOMMENDATION.subscribeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block underline hover:text-foreground text-muted-foreground"
            >
              Subscribe at Z.ai &rarr;
            </a>
          </div>
        )}

        {/* Other providers */}
        <div className="flex flex-wrap gap-1.5 text-muted-foreground">
          <span>Also available:</span>
          <span>{PROVIDER_LABELS.claude}</span>
          <span>&middot;</span>
          <span>{PROVIDER_LABELS.openai}</span>
        </div>
      </div>

      {/* Configure button */}
      {onConfigure && (
        <div className="px-3 pb-3">
          <button
            type="button"
            className="w-full rounded bg-primary text-primary-foreground py-1.5 text-xs font-medium hover:bg-primary/90 transition-colors"
            onClick={onConfigure}
          >
            Configure AI Provider
          </button>
        </div>
      )}
    </div>
  );
}
