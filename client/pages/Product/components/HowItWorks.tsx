import { IconGitBranch, IconPointer, IconSparkles } from '@tabler/icons-react';
import { screenshotSrc } from '../screenshotSrc';

const steps = [
  {
    icon: IconGitBranch,
    title: 'Inspect the Live Tree',
    description:
      'Open the running React screen in Hyper Canvas. HyperIDE maps the rendered UI into an element tree, so structure, canvas, and code stay connected.',
    color: 'from-blue-500 to-cyan-500',
    image: screenshotSrc('/screenshots/panel-tree.png'),
    imageAlt: 'HyperIDE Hyper Canvas next to the Inspector element tree for the bulka-the-dog project',
  },
  {
    icon: IconPointer,
    title: 'Edit Visually',
    description:
      'Select the Jump button on the canvas and adjust spacing, variants, and Tailwind styles in the Inspector while the JSX stays in sync.',
    color: 'from-purple-500 to-pink-500',
    image: screenshotSrc('/screenshots/panel-inspector.png'),
    imageAlt: 'HyperIDE canvas showing the selected Jump button with Inspector style controls',
  },
  {
    icon: IconSparkles,
    title: 'Use Context Actions',
    description:
      'Right-click the selected element to jump to code, copy, duplicate, wrap, delete, or hand the exact element context to AI.',
    color: 'from-orange-500 to-yellow-500',
    image: screenshotSrc('/screenshots/panel-canvas-preview.png'),
    imageAlt: 'HyperIDE context menu opened on the selected Jump button with Go to Code and edit actions',
  },
];

export default function HowItWorks() {
  return (
    <section className="border-y bg-muted/30 py-20 sm:py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Section header */}
        <div className="text-center">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">How it works</h2>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-muted-foreground">
            Open the real app, select an element, and act on it without leaving the IDE.
          </p>
        </div>

        {/* Steps */}
        <div className="mt-16">
          <div className="relative">
            {/* Connection line */}
            <div className="absolute left-1/2 top-0 hidden h-full w-px -translate-x-1/2 bg-border lg:block" />

            <div className="grid gap-16 lg:grid-cols-3 lg:gap-8">
              {steps.map((step) => (
                <div key={step.title} className="relative">
                  <div className="overflow-hidden rounded-xl border bg-background p-2 shadow-xl sm:p-3">
                    <img
                      src={step.image}
                      alt={step.imageAlt}
                      className="aspect-[4/3] w-full rounded-lg object-cover object-top"
                      loading="lazy"
                    />
                  </div>

                  <div className="mt-6 flex items-start gap-4 lg:flex-col lg:items-center lg:text-center">
                    {/* Step number */}
                    <div className="relative shrink-0">
                      <div
                        className={`flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br ${step.color} text-white shadow-lg`}
                      >
                        <step.icon className="h-7 w-7" />
                      </div>
                    </div>

                    {/* Content */}
                    <div className="min-w-0 pt-1 lg:pt-0">
                      <h3 className="text-xl font-semibold">{step.title}</h3>
                      <p className="mt-3 text-muted-foreground">{step.description}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
