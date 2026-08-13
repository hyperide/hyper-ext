import type { PropTypeInfo } from '@shared/types/props';

const NAMES = [
  'John Doe',
  'Jane Smith',
  'Alex Johnson',
  'Maria Garcia',
  'David Chen',
  'Sarah Kim',
  'James Wilson',
  'Emma Brown',
  'Michael Lee',
  'Olivia Taylor',
];
const USERNAMES = [
  '@johndoe',
  '@janesmith',
  '@alexj',
  '@mgarcia',
  '@dchen',
  '@sarahk',
  '@jwilson',
  '@emmab',
  '@mlee',
  '@otaylor',
];
const EMAILS = ['john@example.com', 'jane@test.com', 'alex@mail.com', 'maria@demo.com', 'david@sample.com'];
const TITLES = ['Hello World', 'Getting Started', 'My First Post', 'Breaking News', 'Update v2.0', 'Quick Note'];
const DESCRIPTIONS = [
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit.',
  'Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.',
  'Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris.',
  'Duis aute irure dolor in reprehenderit in voluptate velit esse cillum.',
  'Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia.',
];
const URLS = ['https://example.com', 'https://test.com/page', 'https://demo.app/resource'];
const COLORS = ['#3B82F6', '#EF4444', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899'];

const PLACEHOLDER_IMAGE =
  'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22100%22 height=%22100%22%3E%3Crect width=%22100%22 height=%22100%22 fill=%22%23666%22/%3E%3Ctext x=%2250%22 y=%2255%22 text-anchor=%22middle%22 fill=%22%23fff%22 font-size=%2214%22%3Eplaceholder%3C/text%3E%3C/svg%3E';

function generateId(): string {
  return Math.random().toString(36).substring(2, 10);
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function canGenerateSomeValue(fields: Array<{ name: string; typeInfo: PropTypeInfo }>): boolean {
  return fields.some(({ name, typeInfo }) => {
    switch (typeInfo.type) {
      case 'boolean':
      case 'number':
      case 'array':
        return true;
      case 'enum':
        return (typeInfo.enumValues?.length ?? 0) > 0;
      case 'string':
      case 'unknown':
        return getStringFieldGenerator(name) !== null;
      case 'object':
        if (typeInfo.objectSchema) {
          const nested = Object.entries(typeInfo.objectSchema).map(([n, ti]) => ({ name: n, typeInfo: ti }));
          return canGenerateSomeValue(nested);
        }
        return false;
      default:
        return false;
    }
  });
}

export function generateObjectValues(fields: Array<{ name: string; typeInfo: PropTypeInfo }>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const { name, typeInfo } of fields) {
    if (typeInfo.type === 'boolean') {
      const gen = getNumberFieldGenerator(name);
      result[name] = gen ? gen() > 0.5 : Math.random() > 0.5;
    } else if (typeInfo.type === 'number') {
      const gen = getNumberFieldGenerator(name);
      result[name] = gen ? gen() : Math.floor(Math.random() * 1000);
    } else if (typeInfo.type === 'object' && typeInfo.objectSchema) {
      const nestedFields = Object.entries(typeInfo.objectSchema).map(([n, ti]) => ({ name: n, typeInfo: ti }));
      result[name] = generateObjectValues(nestedFields);
    } else if (typeInfo.type === 'enum' && typeInfo.enumValues?.length) {
      result[name] = typeInfo.enumValues[0];
    } else if (typeInfo.type === 'array') {
      result[name] = [];
    } else if (typeInfo.type === 'function') {
      result[name] = undefined;
    } else if (typeInfo.type === 'reactNode') {
      const gen = getStringFieldGenerator(name);
      result[name] = gen ? gen() : 'Sample content';
    } else if (typeInfo.type === 'string' || typeInfo.type === 'unknown') {
      const gen = getStringFieldGenerator(name);
      result[name] = gen ? gen() : undefined;
    }
  }
  return result;
}

export function getGenerateAllAvailability(fields: Array<{ name: string; typeInfo: PropTypeInfo }>): {
  disabled: boolean;
  tooltip: string;
} {
  const generated = generateObjectValues(fields);
  const canGenerate = Object.values(generated).some(isConcreteGeneratedValue);
  return canGenerate
    ? { disabled: false, tooltip: 'Generate example values for supported props' }
    : { disabled: true, tooltip: 'No supported props are available for deterministic value generation' };
}

function isConcreteGeneratedValue(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.values(value).some(isConcreteGeneratedValue);
  return true;
}

export function getStringFieldGenerator(name: string): (() => string) | null {
  const n = name.toLowerCase();
  if (/^id$|id$/i.test(name)) return generateId;
  if (n === 'name' || n === 'fullname' || n === 'displayname' || n === 'username' || n === 'author')
    return () => pick(NAMES);
  if (n === 'handle' || n === 'screenname' || n === 'nickname') return () => pick(USERNAMES);
  if (n === 'email' || n === 'mail') return () => pick(EMAILS);
  if (n === 'title' || n === 'subject' || n === 'heading') return () => pick(TITLES);
  if (n === 'description' || n === 'bio' || n === 'summary' || n === 'text' || n === 'content' || n === 'body')
    return () => pick(DESCRIPTIONS);
  if (n === 'variant') return () => 'default';
  if (n === 'url' || n === 'href' || n === 'link' || n === 'website') return () => pick(URLS);
  if (n === 'color' || n === 'bgcolor' || n === 'background') return () => pick(COLORS);
  if (/avatar|photo|image|pic|thumbnail|icon|logo|src/i.test(n)) return () => PLACEHOLDER_IMAGE;
  if (/count|total|amount|quantity|num|likes|views|followers|shares|comments|subscribers/i.test(n))
    return () => String(Math.floor(Math.random() * 1000));
  if (/^(ts|timestamp|createdAt|updatedAt)$/i.test(n)) return () => String(Date.now());
  if (/price|cost/i.test(n)) return () => (Math.random() * 100).toFixed(2);
  if (/^(date|created|updated)$/i.test(n)) return () => new Date().toISOString().split('T')[0];
  if (/timestamp|^ts$/i.test(n)) return () => new Date().toISOString();
  if (/phone|tel/i.test(n)) return () => `+1 555-${Math.floor(1000 + Math.random() * 9000)}`;
  return null;
}

function getNumberFieldGenerator(name: string): (() => number) | null {
  const n = name.toLowerCase();
  if (/count|total|amount|quantity|num|likes|views|followers|shares|comments|subscribers/i.test(n))
    return () => Math.floor(Math.random() * 1000);
  if (/price|cost/i.test(n)) return () => Math.round(Math.random() * 10000) / 100;
  if (/^(ts|timestamp|createdAt|updatedAt)$/i.test(n)) return () => Date.now();
  if (/age|year|month|day|hour|minute|second/i.test(n)) return () => Math.floor(Math.random() * 100);
  if (/width|height|size|radius|margin|padding|gap|offset/i.test(n)) return () => Math.floor(Math.random() * 200) + 10;
  if (/percent|ratio|opacity|progress/i.test(n)) return () => Math.round(Math.random() * 100);
  return null;
}
