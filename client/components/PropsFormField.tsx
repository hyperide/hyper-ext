/**
 * Recursive form field component for rendering different prop types
 */

import type { PropTypeInfo } from '@shared/types/props';
import { IconPlus, IconTrash } from '@tabler/icons-react';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';

// Helper to detect if value is a token (format: $word or $number or $word.number)
const isTokenValue = (val: unknown): val is string => {
  return typeof val === 'string' && /^\$[\w.]+$/.test(val);
};

interface TamaguiTokens {
  color: string[];
  size: string[];
  space: string[];
}

interface PropsFormFieldProps {
  name: string;
  propInfo: PropTypeInfo;
  value: unknown;
  onChange: (value: unknown) => void;
  depth?: number;
  tamaguiTokens?: TamaguiTokens;
}

/**
 * Render form field based on prop type
 */
export function PropsFormField({ name, propInfo, value, onChange, depth = 0, tamaguiTokens }: PropsFormFieldProps) {
  // Prevent infinite recursion
  if (depth > 5) {
    return <div className="text-sm text-muted-foreground">Max nesting depth reached</div>;
  }

  const fieldId = `prop-${name}-${depth}`;

  // Token field (for design tokens like colors, sizes, spacing)
  const showTokens = propInfo.tokenCategory || isTokenValue(value);
  if ((propInfo.type === 'string' || propInfo.type === 'unknown') && showTokens && tamaguiTokens) {
    // Determine token list based on category
    let tokenList = tamaguiTokens.color;

    if (propInfo.tokenCategory === 'size') {
      tokenList = tamaguiTokens.size;
    } else if (propInfo.tokenCategory === 'space') {
      tokenList = tamaguiTokens.space;
    } else if (propInfo.tokenCategory === 'color') {
      tokenList = tamaguiTokens.color;
    } else if (isTokenValue(value)) {
      // If value looks like a token but no category, try to guess from value
      if (value.match(/^\$\d/) || value.match(/^\$(true)$/)) {
        tokenList = tamaguiTokens.size;
      } else {
        tokenList = tamaguiTokens.color;
      }
    }

    return (
      <div className="space-y-1.5">
        <Label htmlFor={fieldId} className="text-[11px] text-gray-700">
          {name}
          {propInfo.required && <span className="text-red-500">*</span>}
        </Label>
        <div className="w-full h-6 px-2 bg-gray-100 rounded flex items-center">
          <Input
            id={fieldId}
            type="text"
            value={String(value ?? '')}
            onChange={(e) => onChange(e.target.value)}
            placeholder={propInfo.description || 'Enter token or value'}
            list={`${fieldId}-tokens`}
            className="h-auto border-0 bg-transparent !text-[11px] text-gray-800 p-0 focus-visible:ring-0 focus-visible:ring-offset-0 flex-1"
          />
          <datalist id={`${fieldId}-tokens`}>
            {tokenList.map((token) => (
              <option key={token} value={token} />
            ))}
          </datalist>
        </div>
      </div>
    );
  }

  // String type
  if (propInfo.type === 'string') {
    return (
      <div className="space-y-1.5">
        <Label htmlFor={fieldId} className="text-[11px] text-gray-700">
          {name}
          {propInfo.required && <span className="text-red-500">*</span>}
        </Label>
        <div className="w-full h-6 px-2 bg-gray-100 rounded flex items-center">
          <Input
            id={fieldId}
            type="text"
            value={String(value ?? '')}
            onChange={(e) => onChange(e.target.value)}
            placeholder={propInfo.description}
            className="h-auto border-0 bg-transparent !text-[11px] text-gray-800 p-0 focus-visible:ring-0 focus-visible:ring-offset-0 flex-1"
          />
        </div>
      </div>
    );
  }

  // Number type
  if (propInfo.type === 'number') {
    return (
      <div className="space-y-1.5">
        <Label htmlFor={fieldId} className="text-[11px] text-gray-700">
          {name}
          {propInfo.required && <span className="text-red-500">*</span>}
        </Label>
        <div className="w-full h-6 px-2 bg-gray-100 rounded flex items-center">
          <Input
            id={fieldId}
            type="number"
            value={value != null ? String(value) : ''}
            onChange={(e) => {
              const num = Number.parseFloat(e.target.value);
              onChange(Number.isNaN(num) ? undefined : num);
            }}
            placeholder={propInfo.description}
            className="h-auto border-0 bg-transparent !text-[11px] text-gray-800 p-0 focus-visible:ring-0 focus-visible:ring-offset-0 flex-1"
          />
        </div>
      </div>
    );
  }

  // Boolean type
  if (propInfo.type === 'boolean') {
    return (
      <div className="flex items-center justify-between">
        <Label htmlFor={fieldId} className="text-[11px] text-gray-700">
          {name}
          {propInfo.required && <span className="text-red-500">*</span>}
        </Label>
        <Switch id={fieldId} checked={Boolean(value ?? false)} onCheckedChange={onChange} />
      </div>
    );
  }

  // Enum/Union type (dropdown)
  if (propInfo.type === 'enum' && propInfo.enumValues) {
    return (
      <div className="space-y-1.5">
        <Label htmlFor={fieldId} className="text-[11px] text-gray-700">
          {name}
          {propInfo.required && <span className="text-red-500">*</span>}
        </Label>
        <Select value={String(value ?? '')} onValueChange={onChange}>
          <SelectTrigger id={fieldId} className="h-6 bg-gray-100 border-0 text-[11px] text-gray-800">
            <SelectValue placeholder="Select value" />
          </SelectTrigger>
          <SelectContent>
            {propInfo.enumValues.map((enumValue) => (
              <SelectItem key={enumValue} value={enumValue} className="text-[11px]">
                {enumValue}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }

  // Object type (nested form)
  if (propInfo.type === 'object' && propInfo.objectSchema) {
    const objValue = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;

    return (
      <Accordion type="single" collapsible>
        <AccordionItem value={name}>
          <AccordionTrigger className="text-[11px] text-gray-700">
            <div className="flex items-center gap-2">
              {name}
              {propInfo.required && <span className="text-red-500">*</span>}
            </div>
          </AccordionTrigger>
          <AccordionContent>
            <div className="space-y-3 pl-3 border-l-2 border-gray-200">
              {Object.entries(propInfo.objectSchema).map(([propName, propTypeInfo]) => (
                <PropsFormField
                  key={propName}
                  name={propName}
                  propInfo={propTypeInfo}
                  value={objValue[propName]}
                  onChange={(newValue) => {
                    onChange({
                      ...objValue,
                      [propName]: newValue,
                    });
                  }}
                  depth={depth + 1}
                  tamaguiTokens={tamaguiTokens}
                />
              ))}
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    );
  }

  // Array type
  if (propInfo.type === 'array') {
    const arrValue = Array.isArray(value) ? value : [];

    return (
      <div className="space-y-1.5">
        <Label className="text-[11px] text-gray-700">
          {name}
          {propInfo.required && <span className="text-red-500">*</span>}
        </Label>
        <div className="space-y-2 pl-3 border-l-2 border-gray-200">
          {arrValue.map((item, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: array items have no stable unique id
            <div key={index} className="flex items-start gap-2">
              <div className="flex-1">
                {propInfo.arrayItemType ? (
                  <PropsFormField
                    name={`[${index}]`}
                    propInfo={propInfo.arrayItemType}
                    value={item}
                    onChange={(newValue) => {
                      const newArr = [...arrValue];
                      newArr[index] = newValue;
                      onChange(newArr);
                    }}
                    depth={depth + 1}
                    tamaguiTokens={tamaguiTokens}
                  />
                ) : (
                  <div className="w-full h-6 px-2 bg-gray-100 rounded flex items-center">
                    <Input
                      type="text"
                      value={item || ''}
                      onChange={(e) => {
                        const newArr = [...arrValue];
                        newArr[index] = e.target.value;
                        onChange(newArr);
                      }}
                      className="h-auto border-0 bg-transparent !text-[11px] text-gray-800 p-0 focus-visible:ring-0 focus-visible:ring-offset-0 flex-1"
                    />
                  </div>
                )}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => {
                  const newArr = arrValue.filter((_, i) => i !== index);
                  onChange(newArr);
                }}
                className="h-6 w-6"
              >
                <IconTrash className="h-3 w-3" />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              onChange([...arrValue, propInfo.arrayItemType?.type === 'string' ? '' : undefined]);
            }}
            className="h-6 text-[11px]"
          >
            <IconPlus className="h-3 w-3 mr-1" />
            Add Item
          </Button>
        </div>
      </div>
    );
  }

  // Function and ReactNode types (not editable)
  if (propInfo.type === 'function' || propInfo.type === 'reactNode') {
    return (
      <div className="space-y-1.5">
        <Label className="text-[11px] text-gray-400">
          {name}
          {propInfo.required && <span className="text-red-500">*</span>}
        </Label>
        <div className="text-[11px] text-gray-400 italic">Not editable ({propInfo.type})</div>
      </div>
    );
  }

  // Unknown type - show as text input
  return (
    <div className="space-y-1.5">
      <Label htmlFor={fieldId} className="text-[11px] text-gray-700">
        {name}
        {propInfo.required && <span className="text-red-500">*</span>}
      </Label>
      <div className="w-full h-6 px-2 bg-gray-100 rounded flex items-center">
        <Input
          id={fieldId}
          type="text"
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          placeholder={propInfo.description || 'Unknown type'}
          className="h-auto border-0 bg-transparent !text-[11px] text-gray-800 p-0 focus-visible:ring-0 focus-visible:ring-offset-0 flex-1"
        />
      </div>
    </div>
  );
}
