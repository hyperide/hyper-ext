/**
 * Overlay shown when no components are found in the project
 */

export function NoComponentsOverlay() {
  return (
    <div
      data-testid="NoComponentsOverlay"
      className="h-full flex items-center justify-center bg-slate-100 dark:bg-slate-900"
    >
      <div className="text-center space-y-2">
        <p className="text-lg text-slate-400">No components found</p>
        <p className="text-sm text-slate-400">Add .tsx components to your project</p>
      </div>
    </div>
  );
}
