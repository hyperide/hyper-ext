import { IconGitBranch, IconPointer, IconSparkles } from '@tabler/icons-react';

const steps = [
  {
    icon: IconGitBranch,
    title: 'Connect Your Project',
    description:
      'Clone your existing React project from Git, or let AI create a new one from scratch. Supports Next.js, Vite, Remix, and more.',
    color: 'from-blue-500 to-cyan-500',
  },
  {
    icon: IconPointer,
    title: 'Edit Visually',
    description:
      'Select elements on the canvas and modify styles through the visual editor. Change layouts, colors, spacing, and effects without touching code.',
    color: 'from-purple-500 to-pink-500',
  },
  {
    icon: IconSparkles,
    title: 'AI Generates Code',
    description:
      'HyperIDE generates clean, production-ready TypeScript code. All changes are saved to your component files and synced with Git.',
    color: 'from-orange-500 to-yellow-500',
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
            From project setup to production code in three simple steps.
          </p>
        </div>

        {/* Steps */}
        <div className="mt-16">
          <div className="relative">
            {/* Connection line */}
            <div className="absolute left-1/2 top-0 hidden h-full w-px -translate-x-1/2 bg-border lg:block" />

            <div className="grid gap-12 lg:grid-cols-3 lg:gap-8">
              {steps.map((step, index) => (
                <div key={step.title} className="relative">
                  {/* Step number */}
                  <div className="mb-6 flex items-center gap-4 lg:flex-col lg:items-center lg:text-center">
                    <div className="relative">
                      <div
                        className={`flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br ${step.color} text-white shadow-lg`}
                      >
                        <step.icon className="h-7 w-7" />
                      </div>
                      <div className="absolute -right-1 -top-1 flex h-6 w-6 items-center justify-center rounded-full bg-background text-sm font-bold shadow">
                        {index + 1}
                      </div>
                    </div>
                  </div>

                  {/* Content */}
                  <div className="lg:text-center">
                    <h3 className="text-xl font-semibold">{step.title}</h3>
                    <p className="mt-3 text-muted-foreground">{step.description}</p>
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
