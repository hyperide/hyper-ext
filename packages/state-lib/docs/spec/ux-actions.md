<span id="causal-ui" class="anchor"></span>

### Causal actions, forms and animation state

**Specification amendment.** Extends R7, R10, R56, R67, R71–R79. These contracts integrate the September 7 product notes; they are not all implemented by the access experiment.

The three-layer event vocabulary separates technical input (pointer, key, navigation), semantic intent (`document.save`), and the concrete action instance carrying parameters, cause and identity. Multiple controls can invoke one semantic action. Test selectors may reuse stable semantic target metadata, but entity ID, UI-instance ID, DOM handle and action invocation ID remain distinct. This gives tests, accessibility bindings, analytics and agents a shared vocabulary without turning one ID into an ambiguous global identifier.

A disabled control exposes a typed reason, a visible explanation and an accessible association, not only a tooltip reachable by hover. Pending, loading, progress, success, error, invalid, denied and cancelled states belong to action instances and local boundaries, not manually maintained unrelated booleans. Utility JSX components should render these states and map declared state dependencies to props without container components or per-consumer selectors. The compiler still has to implement those bindings; syntax alone does not create subscriptions.

Action data types plus explicit constraint tags generate validation and form constraints. Input text, parsed value, optimistic projection and server-confirmed state remain separate. Failed validation or a server error must not erase the draft. IME composition, caret/focus and selection are main-thread responsibilities; durable draft recovery is an optional persistence layer, not a promise provided by an in-memory transaction.

Session state stores resource-scoped action grants, expiry and policy version. A shared permission declaration can generate frontend eligibility hints and backend guards, but the server independently authorizes every request. An optimistic update never grants authority. A revoked permission or stale policy must reconcile the projection and explain the outcome. Idempotency identifies one invocation and its retries; a hash of command meaning must not collapse two genuinely separate identical actions.

Optimistic layers are removed/rebased by action ID. A rejected old action cannot blindly apply an inverse patch over a newer accepted action. Async results carry query/document generation and version preconditions. Cancellation propagates to request/worker work where possible; lifecycle settlement and visible status are distinct.

#### WAAPI means Web Animations API

```js
const animation = element.animate(
  [{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'translateY(0)' }],
  { duration: 160, easing: 'ease-out' }
);
```

The browser runs the animation. The state layer records the action ID, transaction/log position, cause (user/system), initial value, target, start and lifecycle. Do not emit a global state transaction every animation frame. Handle cancellation, interruption, retargeting and `prefers-reduced-motion`. WAAPI can animate properties that still require main-thread/layout work; not every animation is automatically compositor-only.

A view-transition bridge likewise coordinates state/navigation lifetimes, cancellation and focus restoration. Logical commit order is not necessarily animation completion order.

Source: [Web Animations API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Animations_API). See [prototype API](/api), [compiler/tooling](/spec#compiler-contract) and [normalized state](/spec#normalized-views).
