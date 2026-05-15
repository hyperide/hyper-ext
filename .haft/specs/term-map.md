# Term Map

```yaml term-map
entries:
  - term: CanvasInteraction
    domain: target-system
    definition: A user action performed on the live preview canvas — clicking, dragging, or editing a value in the inspector panel — that triggers an AST transformation of the corresponding source file.
  - term: ASTTransformation
    domain: target-system
    definition: A programmatic, syntax-preserving rewrite of a React source file performed by the extension in response to a CanvasInteraction. Preserves formatting and produces valid TypeScript/JSX output.
  - term: SourceFileDiff
    domain: target-system
    definition: A git-tracked change to a React source file produced by an ASTTransformation, observable via `git status` or SCM panel before the developer opens a text editor.
  - term: HyperCanvas
    domain: target-system
    definition: The VS Code extension and SaaS product that enables CanvasInteractions to produce SourceFileDiffs. Comprises a preview panel (live iframe), inspector panel (style/text/i18n controls), and AST engine.
status: active
```
