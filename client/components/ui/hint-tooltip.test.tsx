import { describe, expect, it } from 'bun:test';
import { fireEvent, render } from '@testing-library/react';
import { forwardRef } from 'react';
import { createPortal } from 'react-dom';
import { HintTooltip } from './hint-tooltip';

// HYP-1001: HintTooltip renders a REAL in-DOM tooltip (Radix, portaled) — NOT a native `title`
// attribute. These tests assert the hint text actually becomes visible on interaction, so a
// regression that renders nothing (or falls back to `title`) fails loudly.
describe('HintTooltip', () => {
  it('renders the trigger child and adds no native title attribute', () => {
    const { getByTestId } = render(
      <HintTooltip label="Some hint">
        <button data-testid="trig" type="button">
          x
        </button>
      </HintTooltip>,
    );
    const trig = getByTestId('trig');
    expect(trig).not.toBeNull();
    expect(trig.getAttribute('title')).toBeNull();
  });

  it('shows the hint text when a focusable trigger (button) is focused', async () => {
    const label = 'Grid — rows and columns (display: grid)';
    const { getByTestId, findAllByText } = render(
      <HintTooltip label={label}>
        <button data-testid="trig" type="button">
          x
        </button>
      </HintTooltip>,
    );
    fireEvent.focus(getByTestId('trig'));
    const found = await findAllByText(label);
    expect(found.length).toBeGreaterThan(0);
  });

  it('shows the hint text when a non-focusable field trigger (div) is hovered', async () => {
    const label = 'Gap — spacing between stacked children';
    const { getByTestId, findAllByText } = render(
      <HintTooltip label={label}>
        <div data-testid="field">
          <input aria-label="gap" />
        </div>
      </HintTooltip>,
    );
    const field = getByTestId('field');
    fireEvent.pointerEnter(field);
    fireEvent.pointerMove(field);
    const found = await findAllByText(label);
    expect(found.length).toBeGreaterThan(0);
  });

  // HYP-1085 follow-up (Codex + review-cli findings, PR #679): FillPicker / ColorCombobox render
  // their linked color/image popover content via a Radix Portal to `document.body`. React bubbles
  // events from portaled content through the REACT tree (not the DOM tree) — so without a guard,
  // Radix's OWN TooltipTrigger (which listens for onPointerMove/onFocus internally) still "sees"
  // hover/focus events from inside that popover and asks HintTooltip's controlled `open` to turn
  // on. These tests reproduce a portal nested inside the trigger's own children and assert the
  // tooltip does NOT reopen from events whose real DOM target lives in the portal (rejected by
  // HintTooltip's `handleOpenChange`, driven by native — not synthetic — listeners), while normal
  // hover/focus on the trigger's own subtree still opens it correctly.
  // Forwards every extra prop (ref, …) onto the actual DOM node — mirrors how the real call sites
  // (FillSection etc.) pass a literal `<div>` as HintTooltip's `children`, so Radix's `asChild`
  // attaches directly to this div, not to an opaque custom component that would swallow the ref.
  const TriggerWithPortal = forwardRef<HTMLDivElement, { portalTestId: string } & Record<string, unknown>>(
    ({ portalTestId, ...rest }, ref) => (
      <div ref={ref} data-testid="field" {...rest}>
        <input aria-label="own-input" />
        {createPortal(<input aria-label="portal-input" data-testid={portalTestId} />, document.body)}
      </div>
    ),
  );

  it('does not reopen the hint when a child popover portaled into document.body is focused', async () => {
    const label = 'Fill color — background color or image';
    const { getByTestId, queryAllByText } = render(
      <HintTooltip label={label}>
        <TriggerWithPortal portalTestId="portal-input-focus" />
      </HintTooltip>,
    );

    // `focusIn` (bubbling native `focusin`) — not `focus` — is what HintTooltip's native guard
    // (and React's own onFocus, backed by `focusin`) actually listens for. Driving the test this
    // way means it genuinely exercises the guard rather than passing vacuously.
    fireEvent.focusIn(getByTestId('portal-input-focus'));
    // Give any (incorrectly) scheduled open a chance to land before asserting absence.
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(queryAllByText(label).length).toBe(0);
  });

  it('does not reopen the hint when a child popover portaled into document.body receives pointer events', async () => {
    const label = 'Fill color — background color or image';
    const { getByTestId, queryAllByText } = render(
      <HintTooltip label={label}>
        <TriggerWithPortal portalTestId="portal-input-pointer" />
      </HintTooltip>,
    );

    const portalInput = getByTestId('portal-input-pointer');
    fireEvent.pointerEnter(portalInput);
    fireEvent.pointerMove(portalInput);
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(queryAllByText(label).length).toBe(0);
  });

  it('still shows the hint on normal hover/focus of the trigger even though it wraps a portal-rendering child', async () => {
    const label = 'Fill color — background color or image';
    const { getByTestId, findAllByText } = render(
      <HintTooltip label={label}>
        <TriggerWithPortal portalTestId="portal-input-control" />
      </HintTooltip>,
    );

    fireEvent.focusIn(getByTestId('field'));
    const found = await findAllByText(label);
    expect(found.length).toBeGreaterThan(0);
  });

  it('does not clobber a genuine pointer-hover when focus separately moves into the popover', async () => {
    // Regression test for an Opus review finding on an earlier revision: pointer-hover and
    // focus-within must be tracked as two INDEPENDENT flags. A single shared flag would have the
    // pointer still resting on the trigger wrongly cleared to "away" the moment focus moves
    // elsewhere (e.g. into the popover), rejecting a legitimate subsequent hover-driven reopen.
    const label = 'Fill color — background color or image';
    const { getByTestId, findAllByText } = render(
      <HintTooltip label={label}>
        <TriggerWithPortal portalTestId="portal-input-independent-flags" />
      </HintTooltip>,
    );

    const field = getByTestId('field');
    fireEvent.pointerEnter(field);
    // Focus moves away from the trigger (e.g. into the popover) while the pointer stays put.
    fireEvent.focusOut(field);
    fireEvent.pointerMove(field);
    const found = await findAllByText(label);
    expect(found.length).toBeGreaterThan(0);
  });

  it('fails open (still shows the hint) when the child forwards props but drops the ref', async () => {
    // Regression test for an Opus review finding: if `children` never forwards its ref to a DOM
    // node, this component never learns "over own subtree" ground truth (`wrapperNode` stays
    // `null`). It must fail OPEN (still show the hint on a genuine hover/focus reaching the real
    // DOM node) rather than silently disabling the tooltip forever. `RefDroppingTrigger` spreads
    // every other prop (so Radix's own onFocus/onPointerMove wiring still reaches the button) but
    // intentionally discards the incoming `ref`.
    const RefDroppingTrigger = forwardRef<HTMLButtonElement, Record<string, unknown>>((props, _ref) => (
      <button data-testid="no-ref-trig" type="button" {...props}>
        x
      </button>
    ));
    const label = 'Fill color — background color or image';
    const { getByTestId, findAllByText } = render(
      <HintTooltip label={label}>
        <RefDroppingTrigger />
      </HintTooltip>,
    );
    fireEvent.focusIn(getByTestId('no-ref-trig'));
    const found = await findAllByText(label);
    expect(found.length).toBeGreaterThan(0);
  });

  // Direct regression test for the P2 finding on an earlier revision of this fix: that revision
  // suppressed the reopen by calling `event.preventDefault()` on the bubbled synthetic event,
  // which also marks the REAL native event dispatched inside the portal as prevented — capable of
  // cancelling the popover's own default behavior (touch-scroll, drag/drop). The current
  // implementation never calls preventDefault at all; it rejects the reopen via a separately
  // tracked `open` state. Assert the portal's own dispatched event is never marked
  // `defaultPrevented`, so its native default action (e.g. touch scrolling inside the color list)
  // is left completely alone.
  it('never marks the popover-internal pointermove event as defaultPrevented', async () => {
    const label = 'Fill color — background color or image';
    const { getByTestId } = render(
      <HintTooltip label={label}>
        <TriggerWithPortal portalTestId="portal-input-defprevented" />
      </HintTooltip>,
    );

    const portalInput = getByTestId('portal-input-defprevented');
    const nativeEvent = new window.PointerEvent('pointermove', { bubbles: true, cancelable: true });
    portalInput.dispatchEvent(nativeEvent);
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(nativeEvent.defaultPrevented).toBe(false);
  });
});
