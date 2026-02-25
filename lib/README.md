# AST Manipulation Library

A library for safe manipulation of React/TypeScript AST (Abstract Syntax Tree) code while preserving formatting.

## Structure

```plain
lib/
├── ast/                    # AST operations
│   ├── parser.ts          # Parse/print with recast
│   ├── traverser.ts       # Find elements by UUID
│   ├── mutator.ts         # Modify attributes
│   ├── uuid.ts            # UUID management
│   └── *.test.ts          # Tests
├── tailwind/              # Tailwind CSS utilities
│   ├── parser.ts          # Parse Tailwind classes
│   ├── generator.ts       # Generate Tailwind classes
│   └── *.test.ts          # Tests
└── types.ts               # Shared types
```

## Features

✅ **109 unit tests** covering all functionality
✅ Uses **recast** to preserve code formatting
✅ Full **TypeScript support**
✅ **UUID-based** element tracking
✅ **Tailwind CSS** class manipulation

## Usage

### AST Operations

```typescript
import { readAndParseFile, writeAST } from './lib/ast/parser';
import { findElementByUuid } from './lib/ast/traverser';
import { setAttribute, valueToJSXAttribute } from './lib/ast/mutator';

// Read and parse file
const { ast, absolutePath } = await readAndParseFile('component.tsx');

// Find element
const result = findElementByUuid(ast, 'uuid-123');

// Modify attribute
setAttribute(result.element, 'className', valueToJSXAttribute('new-class'));

// Save
await writeAST(ast, absolutePath);
```

### Tailwind Operations

```typescript
import { generateTailwindClasses } from './lib/tailwind/generator';
import { removeConflictingClasses } from './lib/tailwind/parser';

// Generate Tailwind classes
const classes = generateTailwindClasses({
  width: '16rem',
  height: '8rem',
  marginTop: '1rem',
});
// Result: "w-64 h-32 mt-4"

// Remove conflicting classes
const preserved = removeConflictingClasses('w-32 h-16 flex', ['width']);
// Result: "h-16 flex"
```

### UUID Management

```typescript
import { generateUuid, updateAllChildUuids, ensureUuid } from './lib/ast/uuid';

// Generate UUID
const uuid = generateUuid();

// Update all children UUIDs recursively
updateAllChildUuids(element);

// Ensure element has UUID
ensureUuid(element, 'optional-custom-uuid');
```

## API Reference

### parser.ts

- `parseCode(source)` - Parse source code to AST
- `printAST(ast)` - Print AST back to code
- `readAndParseFile(path)` - Read file and parse to AST
- `writeAST(ast, path)` - Write AST to file

### traverser.ts

- `findElementByUuid(ast, uuid)` - Find element by data-uniq-id
- `getUuidFromElement(element)` - Extract UUID from element
- `findAllJSXElements(ast)` - Get all JSX elements
- `traverseJSXElements(ast, visitor)` - Custom traversal

### mutator.ts

- `getAttribute(element, name)` - Get attribute value
- `getAttributeString(element, name)` - Get string attribute
- `setAttribute(element, name, value)` - Set/update attribute
- `removeAttribute(element, name)` - Remove attribute
- `valueToJSXAttribute(value)` - Convert JS value to JSX attribute
- `cloneElement(element)` - Deep clone element

### uuid.ts

- `generateUuid()` - Generate new UUID
- `updateAllChildUuids(element)` - Update all children UUIDs
- `ensureUuid(element, uuid?)` - Add UUID if missing

### tailwind/parser.ts

- `parseTailwindClasses(className)` - Parse classes to CSS values
- `removeConflictingClasses(className, keys)` - Remove conflicting classes
- `getConflictingPrefixes(keys)` - Get conflicting prefixes

### tailwind/generator.ts

- `generateTailwindClasses(styles)` - Generate Tailwind classes from styles

## Testing

```bash
pnpm run test lib/
```

All 109 tests should pass:

- ✅ lib/ast/parser.test.ts (11 tests)
- ✅ lib/ast/traverser.test.ts (11 tests)
- ✅ lib/ast/mutator.test.ts (18 tests)
- ✅ lib/ast/uuid.test.ts (9 tests)
- ✅ lib/tailwind/parser.test.ts (24 tests)
- ✅ lib/tailwind/generator.test.ts (36 tests)

## Migration from server/utils

Old imports from `server/utils` have been removed. Update your imports:

```typescript
// ❌ Old (removed)
import { babelParserWrapper } from '../utils/babelParser';
import { generateTailwindClasses } from '../utils/tailwindGenerator';
import { parseTailwindClasses } from '../utils/tailwindParser';

// ✅ New
import { babelParserWrapper } from '../../lib/ast/parser';
import { generateTailwindClasses } from '../../lib/tailwind/generator';
import { parseTailwindClasses } from '../../lib/tailwind/parser';
```

## Implementation Details

- Uses **@babel/parser** for parsing TypeScript/JSX
- Uses **@babel/traverse** for AST traversal
- Uses **@babel/types** for AST node creation
- Uses **recast** to preserve original formatting
- UUID tracking via `data-uniq-id` attributes

## Examples

See refactored routes for usage examples:

- [server/routes/deleteElement.ts](../server/routes/deleteElement.ts) - Simple element deletion
- [server/routes/updateComponentStyles.ts](../server/routes/updateComponentStyles.ts) - Style updates
- [server/routes/updateComponentProps.ts](../server/routes/updateComponentProps.ts) - Prop updates
- [server/routes/duplicateElement.ts](../server/routes/duplicateElement.ts) - Element duplication with UUID management
