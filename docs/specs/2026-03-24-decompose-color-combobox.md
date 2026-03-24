# HYP-349: Decompose ColorCombobox

## Problem

`client/components/ui/color-combobox.tsx` is 1283 lines with a single `ColorCombobox`
function containing ~25 hooks/states/refs and ~400 lines of JSX. Violates the ~100 line
function guideline and makes the component hard to maintain and test.

## Approach

Full decomposition: extract hooks (feature-level + composite), sub-components, a shared
context provider, and pure utility functions. Zero behavior changes.

## File Structure

```
client/components/ui/
  color-combobox.tsx              — ColorCombobox wiring (~120-150 lines)
  color-combobox.test.ts          — existing tests (unchanged)
  color-utils.ts                  — pure functions + types
  color-utils.test.ts             — tests for findNearestPassingColor (moved from color-combobox.test.ts)
  color-picker-context.ts         — ColorPickerContext type + createContext + useColorPickerContext
  color-swatch.tsx                — ColorSwatch component (~60 lines)
  linked-color-picker.tsx         — Popover + Command, reads from context
  unlinked-color-picker.tsx       — hex input + native color picker + ContrastBadge
  color-strip-bar.tsx             — component colors + recent colors horizontal strip
  color-palette-grid.tsx          — grid view (non-search mode, inside CommandList)
  color-search-results.tsx        — list view (search mode, inside CommandList)
  hooks/
    use-color-search.ts           — search/filter logic
    use-color-search.test.ts
    use-contrast-fix.ts           — Double-Ctrl contrast fix (token + hex modes)
    use-contrast-fix.test.ts
    use-color-copy.ts             — Cmd+C copy mode + hotkey dispatch
    use-color-copy.test.ts
    use-color-keyboard.ts         — composite: contrast + copy + Enter/Backspace/arrow nav
    use-color-keyboard.test.ts
    use-color-tooltip.ts          — hoveredColor, focusedValue, hover/leave, timers, layout clamp
    use-color-tooltip.test.ts
    use-color-value.ts            — isLinked, currentHex, currentToken, toggle/select/hex-input
    use-color-value.test.ts
```

## Module Responsibilities

### color-utils.ts

Pure functions, zero React. Exported types and helpers:

- **Types**: `TokenSystem`, `ColorOption`, `SearchResult`, `ColorShades`, `HoveredColorState`
- **Constants**: `SPECIAL_CSS_VALUES`
- **Functions**: `getTokenFromHex`, `getHexFromToken`, `findClosestColor`,
  `generateColorOptions`, `getColorGroups`, `findNearestPassingColor`

`findNearestPassingColor` is the only currently exported function — re-export
from `color-utils.ts`, update the test import.

**Import migration**: `TokenSystem` is currently imported by 5 files
(`fill-picker.tsx`, `opacity-input.tsx`, `extract-component-colors.ts`,
`use-component-colors.ts`, `FillSection.tsx` via fill-picker). All imports
must be updated from `./color-combobox` to `./color-utils`.

### color-picker-context.ts

```ts
interface ColorPickerContext {
  // Props forwarded
  tokenSystem: TokenSystem;
  colorOptions: ColorOption[];
  colorGroups: Record<string, ColorOption[]>;
  contrastPairedHex: string | undefined;
  contrastRole: 'text' | 'bg' | undefined;
  engine: CanvasEngine | null;
  componentPath: string | null;
  value: string;
  onChange: (value: string) => void;
  open: boolean;
  setOpen: (open: boolean) => void;

  // useColorTooltip
  hoveredColor: HoveredColorState | null;
  copyMode: boolean;
  focusedValue: string | null;
  handleColorHover: (tokenName: string, hex: string, el: HTMLElement,
    sourceLabel?: string, pairedHex?: string, isTextColor?: boolean) => void;
  handleColorLeave: () => void;
  popoverContentRef: RefObject<HTMLDivElement>;
  infoPanelRef: RefObject<HTMLDivElement>;

  // useColorSearch
  search: string;
  setSearch: (value: string) => void;
  parsedSearchColor: ParsedColorInput | null;
  filteredGroups: Record<string, SearchResult[]>;
  isSearching: boolean;
  hasResults: boolean;
  highlightMatch: (text: string) => ReactNode;

  // useColorValue
  isLinked: boolean;
  currentHex: string;
  currentToken: string | null;
  handleSelect: (token: string) => void;
  handleUnlinkToggle: () => void;
  handleHexInput: (value: string) => void;

  // useRecentColors (forwarded)
  addRecentColor: (hex: string, token?: string) => void;

  // Popover lifecycle
  resetPopoverState: () => void;
}
```

Single `createContext` + `useColorPickerContext()` hook that throws if used outside provider.

`HoveredColorState` is defined in `color-utils.ts`:

```ts
interface HoveredColorState {
  tokenName: string;
  hex: string;
  sourceLabel?: string;
  pairedHex?: string;
  isTextColor?: boolean;
  anchorRect: DOMRect;
}
```

### Hooks

#### useColorSearch(search, colorGroups, parsedSearchColor)

- `COLOR_SEARCH_DISTANCE_THRESHOLD` constant (40)
- `parsedSearchColor` memo (delegates to `parseColorInput`)
- `filteredGroups` memo — text search + color proximity merge, exact match reordering
- `isSearching`, `hasResults` derived booleans
- `highlightMatch` callback

#### useColorTooltip(popoverContentRef?)

- State: `hoveredColor`, `copyMode`, `focusedValue`
- Refs: `focusedValueRef`, `leaveTimerRef`, `copyModeTimerRef`, `popoverContentRef`,
  `infoPanelRef`, `lastCommandValueRef`
- `handleColorHover` — clears leave timer, sets hoveredColor
- `handleColorLeave` — 80ms debounce, respects focusedValue lock
- Cleanup effect for timers
- Layout clamp effect (infoPanelRef bottom vs Toolbar top)
- Creates and returns `popoverContentRef` and `infoPanelRef` if not provided

#### useContrastFix(params)

Params: `colorOptions`, `tokenSystem`, tooltip refs (`hoveredColorRef`,
`focusedValueRef`), mode refs (`isLinkedRef`, `currentHexRef`,
`effectiveContrastPairedRef`), `popoverContentRef`, `handleColorHover`,
`setFocusedValue`, `onChangeRef`, `addRecentColorRef`.

Returns `handleContrastKey(e: KeyboardEvent): boolean` — true if consumed.

- Token picker mode: Double-Ctrl with hovered color that has pairedHex.
  Finds nearest passing color, scrolls to it, shows tooltip, sets focusedValue.
- Hex mode: Double-Ctrl when unlinked with contrast pair.
  Calls `findContrastFixHex`, emits onChange.
- Tracks `lastCtrlPressRef` and `lastCtrlPressHexRef` internally.

**DOM coupling**: Token picker mode queries `popoverContentRef` for
`[data-color-value="${fix.value}"]` to scroll and show tooltip. This couples
the hook to the DOM structure rendered by `ColorPaletteGrid`. Both files must
document this contract. Tests must verify `stopImmediatePropagation` is called
to prevent other picker instances from firing.

#### useColorCopy(params)

Params: tooltip refs (`hoveredColorRef`, `copyModeRef`), `setCopyMode`.

Returns `handleCopyKey(e: KeyboardEvent): boolean` — true if consumed.

- Cmd+C on hovered color → enter copy mode (2s timeout)
- In copy mode: hotkey → `copyToClipboard`, Escape → exit copy mode

#### useColorKeyboard(params)

Composite hook. Params: all refs needed by sub-hooks + `open`, `search` refs,
`filteredGroups`, `colorGroups`, `tokenSystem`, `effectiveContrastPaired`,
`contrastRole`.

- Single `useEffect` with global `addEventListener('keydown', handler, true)`
- Handler chain: Enter (focusedValue apply) → Backspace (clear) →
  `handleContrastKey` → `handleCopyKey`
- Separate effect for arrow nav tooltip (on popover container keydown).
  Deps: `open`, `search`, `filteredGroups`, `colorGroups`, `tokenSystem`,
  `effectiveContrastPaired`, `contrastRole` (7 values — unavoidable since
  the handler reads all of them to resolve the hovered option).

**Not included here**: scroll-to-current on popover open. This is not a
keyboard concern — it stays in the wiring component (`ColorCombobox`) or
in `useColorValue` (triggered by `[open, currentToken]`).

#### useColorValue(value, tokenSystem, controlledIsUnlinked, onChange, addRecentColor)

Manages the color value lifecycle for both linked (token) and unlinked (hex) modes.

- `internalIsLinked` state + sync effect from external value
- `isLinked` derived (controlled vs internal)
- `currentHex` memo
- `currentToken` memo
- `handleSelect(token)` — resolves token → hex, calls onChange, addRecentColor.
  **Note**: does NOT call `setOpen(false)` or `setSearch('')` — these are
  popover/search concerns. The wiring component wraps `handleSelect` to also
  close the popover and clear search via `resetPopoverState()`.
- `handleUnlinkToggle()` — linked→hex, hex→nearest token
- `handleHexInput(value)` — validates hex, calls onChange + addRecentColor
- Scroll-to-current effect (`[open, currentToken]`) — scrolls to the selected
  swatch when popover opens. Needs `popoverContentRef` as param.

### Sub-components

All read state from `useColorPickerContext()`. No prop drilling.

#### ColorSwatch

Already exists inline. Extract as-is. Props: `hex`, `value?`, `size?`, `className?`.
Renders: none (dashed + red diagonal), transparent (checkerboard), unknown token (?),
normal color.

#### ColorStripBar

Component colors strip + separator + recent colors strip.
Reads from context: `handleColorHover`, `handleColorLeave`, `handleSelect`,
`onChange`, `addRecentColor`, `currentHex`, `engine`, `componentPath`,
`contrastPairedHex`, `contrastRole`, `tokenSystem`.

Also needs `componentColors` and `recentColorsFiltered` — these can be passed as
props since they're derived from hooks called in ColorCombobox (`useComponentColors`,
`useRecentColors`).

**Click handler density**: Each component color button has 3 click modes:
Shift+Click (select all elements using this color via `engine.selectMultiple`),
Cmd+Click (navigate to source code via `engine.setMode('code')` + custom event),
normal click (select color). This logic stays inline in `ColorStripBar` — it is
~20 lines and tightly coupled to `engine` which is already in context.

#### LinkedColorPicker

Popover + Command wrapper. Reads from context for open/setOpen, search/setSearch,
tooltip handlers, refs.

Contains:
- CommandInput with parsedSearchColor preview
- `<ColorStripBar />` (if componentColors or recentColors exist)
- CommandList: `{isSearching ? <ColorSearchResults /> : <ColorPaletteGrid />}`
- ColorInfoPanel portal (hoveredColor tooltip)

**Popover close cleanup**: `onOpenChange(false)` calls `resetPopoverState()`
from context, which resets search, hoveredColor, copyMode, focusedValue, and
lastCommandValueRef. This callback is assembled in the wiring component and
crosses hook boundaries (tooltip + search state).

#### UnlinkedColorPicker

- Native `<input type="color">` with ColorSwatch label
- Hex text Input
- ContrastBadge (when contrast pair available)

#### ColorPaletteGrid

Grid view of color groups. Renders CommandGroup per color family with
grid of color swatch buttons. Reads from context: filteredGroups, tokenSystem,
currentToken, focusedValue, handleColorHover, handleColorLeave, handleSelect,
onChange, addRecentColor.

Special group rendering for Tailwind "Basic" colors (CommandItem list).

#### ColorSearchResults

Search results list view. Renders CommandGroup + CommandItem per match.
Shows: ColorSwatch, highlighted label, hex, exact/similar badges, check mark.
Reads from context: filteredGroups, parsedSearchColor, isSearching,
highlightMatch, tokenSystem, currentToken, handleColorHover, handleColorLeave,
handleSelect, contrastPairedHex, contrastRole.

## ColorCombobox (wiring)

```tsx
export function ColorCombobox(props: ColorComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const colorOptions = useMemo(() => generateColorOptions(props.tokenSystem), [...]);
  const colorGroups = useMemo(() => getColorGroups(colorOptions), [...]);
  const componentColors = useComponentColors(engine, componentPath, tokenSystem);
  const { recentColors, addRecentColor } = useRecentColors();

  const tooltip = useColorTooltip();
  const colorValue = useColorValue(value, tokenSystem, controlledIsUnlinked, onChange, addRecentColor);
  const colorSearch = useColorSearch(search, colorGroups, tokenSystem);
  useColorKeyboard({ tooltip, colorValue, colorSearch, open, search, ... });

  const recentColorsFiltered = useMemo(() => { ... }, [recentColors, componentColors]);
  const effectiveContrastPaired = opacity !== '100' ? undefined : contrastPairedHex;

  // Cross-concern callbacks assembled here
  const resetPopoverState = useCallback(() => {
    setSearch('');
    tooltip.setHoveredColor(null);
    tooltip.setCopyMode(false);
    tooltip.setFocusedValue(null);
    tooltip.resetLastCommandValue();
  }, [tooltip]);

  // Wrap handleSelect to also close popover
  const handleSelectAndClose = useCallback((token: string) => {
    colorValue.handleSelect(token);
    setOpen(false);
    resetPopoverState();
  }, [colorValue, resetPopoverState]);

  const ctx: ColorPickerContext = {
    ...props forwarded,
    ...tooltip,
    ...colorSearch,
    ...colorValue,
    handleSelect: handleSelectAndClose,
    open, setOpen, search, setSearch,
    addRecentColor, resetPopoverState,
  };

  return (
    <ColorPickerProvider value={ctx}>
      <div className={cn('flex items-center gap-0.5', className)}>
        {colorValue.isLinked
          ? <LinkedColorPicker componentColors={componentColors}
              recentColors={recentColorsFiltered} />
          : <UnlinkedColorPicker />}

        {shouldShowOpacity(...) && <OpacityInput ... />}
        {beforeUnlinkSlot}
        <UnlinkButton isLinked={colorValue.isLinked}
          onToggle={colorValue.handleUnlinkToggle}
          tokenSystem={tokenSystem} beforeUnlinkSlot={beforeUnlinkSlot} />
      </div>
    </ColorPickerProvider>
  );
}
```

Target: ~120-150 lines.

## Constraints

- **Zero behavior changes** — existing tests pass without modification
- **Existing test file** (`color-combobox.test.ts`) only tests `findNearestPassingColor`.
  Move to `color-utils.test.ts`, update import. Keep re-export from
  `color-combobox.tsx` for any external consumers.
- **TypeScript strict**, no `as any`
- **All new hooks get unit tests** — test the returned values/callbacks in isolation
  using `renderHook` or direct function calls for pure logic
- **Ref sync pattern**: All hooks that store props in refs for use in event
  listeners must use direct assignment in the hook body (not in `useEffect`)
  to avoid one-render-cycle staleness.
- **`stopImmediatePropagation` preservation**: The contrast fix handler uses
  `stopImmediatePropagation` (not just `stopPropagation`) to prevent other
  picker instances from also firing. Tests must verify this behavior.
- **`ColorComboboxProps` interface** stays in `color-combobox.tsx`.

## Acceptance Criteria

- [ ] `ColorCombobox` function body < 200 lines (target 120-150)
- [ ] All extracted hooks live in `client/components/ui/hooks/`
- [ ] All extracted components live in `client/components/ui/`
- [ ] Zero behavior changes — existing tests pass without modification
- [ ] New hooks have unit tests
- [ ] TypeScript strict, no `as any`
- [ ] No new lint warnings
