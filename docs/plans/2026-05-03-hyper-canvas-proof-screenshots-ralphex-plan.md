# Hyper Canvas Proof Screenshots Plan

## Context

Several previously sent screenshots are not valid completion proof:

- Resize: screenshot only shows handles, not a changed size.
- Bulka delete: before/after screenshots do not show the target element in the
  viewport and therefore do not visually prove deletion.
- i18n inspector: screenshots are blank/incorrect and do not show the inspector
  fields or a successful edit/language switch.

Do not reuse old `/tmp/hyper-i18n-inspector-*.png`,
`/tmp/hyper-bulka-delete-i18n-*.png`, or `/tmp/resize-handles-pass.png` as final
proof.

### Task 1: Audit Required Proof Per Feature

- [x] List each feature that still needs visual proof:
  - resize mutation,
  - Bulka element delete,
  - i18n text inspector.
- [x] For each feature, define the exact before/after visual evidence required.
- [x] Mark existing screenshots invalid in the progress log and do not send them
      again.

### Task 2: Bulka Element Delete Proof

- [ ] Use the VS Code/Electron extension harness, not a browser-only session.
- [ ] Open
      `/Users/ultra/work/ext-test-projects/bulka-the-dog/client/pages/Index.tsx`
      around the target element.
- [ ] Capture `/tmp/proof-bulka-delete-before.png` showing the target line:
      `<p className="text-foreground/80">{t("habits.walks")}</p>`.
- [ ] Trigger Hyper Canvas element delete for that selected element.
- [ ] Capture `/tmp/proof-bulka-delete-after.png` showing the element removed
      from source or visibly absent from the preview.
- [ ] Assert the source count changed from 2 to 1 and restore the fixture.

### Task 3: i18n Inspector Proof

- [ ] Use a project where the i18n inspector is expected to be visible.
- [ ] Select an element backed by an i18n binding.
- [ ] Capture `/tmp/proof-i18n-inspector-visible.png` showing:
  - key combobox/dropdown with `habits.walks`,
  - resolved text field,
  - language selector/switcher.
- [ ] Edit resolved text or switch language.
- [ ] Capture `/tmp/proof-i18n-inspector-after.png` showing the visible result
      and verify the locale resource/source change.
- [ ] Do not treat a blank VS Code window or generic Explorer screenshot as proof.

### Task 4: Resize Proof Handoff

- [ ] If resize mutation is not implemented yet, explicitly report that no valid
      resize-changed screenshot can be captured.
- [ ] If the resize mutation plan lands while this plan is running, use its
      before/after screenshots only if the selected element visibly changes size and
      the source changes.

### Task 5: Telegram Delivery

- [ ] Send only the new proof screenshots to Telegram.
- [ ] Captions must say what changed and which file/source condition was
      verified.
- [ ] If a feature lacks valid proof, send a short blocker statement instead of
      an unrelated screenshot.
