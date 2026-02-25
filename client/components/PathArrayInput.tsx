import { IconPlus, IconSparkles, IconX } from '@tabler/icons-react';
import cn from 'clsx';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface PathArrayInputProps {
  label: string;
  description?: string;
  value: string[];
  onChange: (paths: string[]) => void;
  placeholder?: string;
  isAIDetected?: boolean;
  className?: string;
}

export function PathArrayInput({
  label,
  description,
  value,
  onChange,
  placeholder = 'e.g., src/components/atoms',
  isAIDetected = false,
  className,
}: PathArrayInputProps) {
  const handleAdd = () => {
    onChange([...value, '']);
  };

  const handleRemove = (index: number) => {
    const newPaths = value.filter((_, i) => i !== index);
    onChange(newPaths);
  };

  const handleChange = (index: number, newValue: string) => {
    const newPaths = [...value];
    newPaths[index] = newValue;
    onChange(newPaths);
  };

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-gray-700">{label}</span>
        {isAIDetected && (
          <span className="flex items-center gap-1 text-xs text-blue-600">
            <IconSparkles className="w-3 h-3" />
            AI detected
          </span>
        )}
      </div>
      {description && <p className="text-xs text-gray-500">{description}</p>}

      <div className="space-y-2">
        {value.length === 0 ? (
          <p className="text-xs text-gray-400 italic">No paths configured</p>
        ) : (
          value.map((path, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: array items have no stable unique identifier
            <div key={index} className="flex items-center gap-2">
              <Input
                type="text"
                value={path}
                onChange={(e) => handleChange(index, e.target.value)}
                placeholder={placeholder}
                className="flex-1 h-8 text-sm font-mono"
              />
              <button
                type="button"
                onClick={() => handleRemove(index)}
                className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                title="Remove path"
              >
                <IconX className="w-4 h-4" />
              </button>
            </div>
          ))
        )}
      </div>

      <Button type="button" variant="outline" size="sm" onClick={handleAdd} className="w-full h-8">
        <IconPlus className="w-4 h-4 mr-1" />
        Add path
      </Button>
    </div>
  );
}
