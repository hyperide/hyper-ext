/**
 * Sample props for components
 */

export const propsSamples: Record<string, Record<string, unknown>> = {
  ComponentExample: {
    screenshots: ['Screenshot 2025-06-01', 'Screenshot 2025-05-01', 'Screenshot 2025-04-01'],
  },
  Button: {
    children: 'Click me',
    variant: 'default',
    size: 'default',
  },
  Input: {
    placeholder: 'Enter text...',
    type: 'text',
  },
  Card: {
    children: 'Card content',
    className: 'p-4',
  },
};
