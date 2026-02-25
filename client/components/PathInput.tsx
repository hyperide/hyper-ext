import { IconSparkles, IconX } from '@tabler/icons-react';
import cn from 'clsx';
import { Input } from '@/components/ui/input';

interface PathInputProps {
  label: string;
  description?: string;
  value: string | null;
  onChange: (path: string | null) => void;
  placeholder?: string;
  isAIDetected?: boolean;
  className?: string;
}

export function PathInput({
  label,
  description,
  value,
  onChange,
  placeholder = 'e.g., src/components',
  isAIDetected = false,
  className,
}: PathInputProps) {
  const inputId = `path-input-${label.toLowerCase().replace(/\s+/g, '-')}`;
  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex items-center justify-between">
        <label htmlFor={inputId} className="text-sm font-medium text-gray-700">
          {label}
        </label>
        {isAIDetected && (
          <span className="flex items-center gap-1 text-xs text-blue-600">
            <IconSparkles className="w-3 h-3" />
            AI detected
          </span>
        )}
      </div>
      {description && <p className="text-xs text-gray-500">{description}</p>}
      <div className="flex items-center gap-2">
        <Input
          id={inputId}
          type="text"
          value={value || ''}
          onChange={(e) => onChange(e.target.value || null)}
          placeholder={placeholder}
          className="flex-1 h-8 text-sm font-mono"
        />
        {value && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
            title="Clear"
          >
            <IconX className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}
