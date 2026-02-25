import { Button } from '@/components/ui/button';

interface AskUserPromptProps {
  question: string;
  options?: string[];
  onSubmit: (response: string) => void;
}

export function AskUserPrompt({ question, options, onSubmit }: AskUserPromptProps) {
  return (
    <div className="mb-2 p-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-300 dark:border-blue-800 rounded">
      <div className="font-semibold text-blue-800 dark:text-blue-400 mb-2 text-sm">
        AI needs your input:
      </div>
      <div className="text-sm text-foreground">{question}</div>
      {options && options.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-3">
          {options.map((option) => (
            <Button
              key={option}
              onClick={() => onSubmit(option)}
              size="sm"
              variant="outline"
            >
              {option}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
