# Required Screenshots

This file lists all screenshots needed for documentation and landing page.
Screenshots should be placed in `docs/public/screenshots/` folder.

## Getting Started

- [ ] `install-docker.png` - Docker Desktop running with HyperIDE container
- [ ] `first-launch.png` - Initial HyperIDE screen (Projects page)
- [ ] `create-project.png` - Project creation dialog

## Projects

- [ ] `clone-repo.png` - Clone from Git form with options
- [ ] `ai-creation.png` - AI chat creating a new project
- [ ] `project-settings.png` - Project settings modal

## Editor Modes

- [ ] `interact-mode.png` - Interact mode overview (element selected)
- [ ] `design-mode.png` - Design mode with selection and right sidebar
- [ ] `code-mode.png` - Monaco editor view with file tree
- [ ] `board-mode.png` - Multi-canvas board view with annotations

## Styling Panels

- [ ] `layout-section.png` - Layout panel (flexbox, dimensions)
- [ ] `appearance-section.png` - Appearance panel (colors, radius)
- [ ] `effects-section.png` - Effects panel (shadows, blur)

## AI Assistant

- [ ] `ai-chat.png` - AI chat modal with conversation
- [ ] `auto-fix.png` - Auto-fix feature in action

## Landing Page

- [ ] `hero-screenshot.png` - Main editor screenshot for hero section (high quality, wide)
- [ ] `feature-visual.png` - Visual editing demonstration
- [ ] `feature-ai.png` - AI assistant demonstration

## Screenshot Guidelines

### Dimensions

| Location | Recommended Size |
|----------|------------------|
| Hero | 1920x1080 or 16:9 aspect |
| Feature cards | 800x600 or 4:3 aspect |
| Documentation | 1200x800 (flexible) |

### Quality

- Use PNG format for UI screenshots
- Ensure dark mode is consistent across all screenshots
- Remove any personal data or sensitive information
- Use sample/demo content, not real projects

### Capturing

1. Use browser dev tools to set exact viewport size
2. Hide any floating elements that shouldn't appear
3. Use consistent sample data across screenshots
4. Crop to relevant area, avoid excess whitespace

## Placeholder Format

In documentation, placeholders look like:

```markdown
![Description](/screenshots/filename.png)
```

In React components, placeholders show:

```tsx
<div className="flex items-center justify-center">
  <div className="text-center">
    <div className="text-4xl">📸</div>
    <p className="text-sm">filename.png</p>
  </div>
</div>
```
