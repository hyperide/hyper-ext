/**
 * Overlay shown when no components are found in the project
 */

export function NoComponentsOverlay() {
  return (
    <div
      data-uniq-id="eb442acd-60db-4937-b711-bf005df76cb9"
      className="h-full flex items-center justify-center bg-slate-100 dark:bg-slate-900"
    >
      <div data-uniq-id="438f8990-b926-49e2-9fa1-45227f3cf1a6" className="text-center space-y-2">
        <p data-uniq-id="21a8e88a-0a85-4ef2-b039-66ce6ef7c380" className="text-lg text-slate-400">
          No components found
        </p>
        <p data-uniq-id="2c802c3c-2a7a-45cb-adbc-63c2585b70b0" className="text-sm text-slate-400">
          Add .tsx components to your project
        </p>
      </div>
    </div>
  );
}
