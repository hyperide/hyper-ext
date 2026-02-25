import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  IconBrush,
  IconMessageChatbot,
  IconBolt,
  IconCode,
  IconBox,
} from '@tabler/icons-react';

const features = [
  {
    icon: IconBrush,
    title: 'Visual Editing',
    description:
      'Edit React components with a Figma-like interface. Select elements, modify styles, and see changes instantly.',
  },
  {
    icon: IconMessageChatbot,
    title: 'AI Assistant',
    description:
      'Generate and modify code through natural language chat. Ask for new components, styling changes, or logic updates.',
  },
  {
    icon: IconBolt,
    title: 'Live Preview',
    description:
      'See changes instantly with Hot Module Replacement. Your components update in real-time as you edit.',
  },
  {
    icon: IconCode,
    title: 'Framework Support',
    description:
      'Works with Next.js, Vite, Remix, Create React App, and Bun. Clone your existing project and start editing.',
  },
  {
    icon: IconBox,
    title: 'Docker Isolation',
    description:
      'Each project runs in a secure, sandboxed Docker container. Safe execution with easy cleanup.',
  },
];

export default function Features() {
  return (
    <section className="py-20 sm:py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Section header */}
        <div className="text-center">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Everything you need to build faster
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-muted-foreground">
            HyperIDE combines visual editing, AI assistance, and developer tools
            in one seamless experience.
          </p>
        </div>

        {/* Features grid */}
        <div className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => (
            <Card key={feature.title} className="relative overflow-hidden">
              <div className="absolute right-0 top-0 h-20 w-20 translate-x-6 -translate-y-6 rounded-full bg-primary/5" />
              <CardHeader>
                <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                  <feature.icon className="h-6 w-6 text-primary" />
                </div>
                <CardTitle className="text-xl">{feature.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription className="text-base">
                  {feature.description}
                </CardDescription>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
