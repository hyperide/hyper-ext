import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';

const faqs = [
  {
    question: 'What frameworks does HyperIDE support?',
    answer:
      'HyperIDE supports Vite, Next.js (both App Router and Pages Router), Remix, Create React App, and Bun-based React projects.',
  },
  {
    question: 'Where do I install HyperIDE?',
    answer:
      'Install the HyperIDE extension from the Visual Studio Marketplace or Open VSX, then open a React workspace in VS Code, Cursor, or another compatible editor.',
  },
  {
    question: 'Can I use my existing project?',
    answer:
      'Yes. Open your existing repository, start its dev server, and HyperIDE maps the running UI back to components, styles, and source locations.',
  },
  {
    question: 'How does the AI assistant work?',
    answer:
      'The AI assistant uses large language models to understand your requests and generate code. It knows your component structure, selected elements, and project configuration to provide contextual assistance.',
  },
  {
    question: 'Is my code sent to external servers?',
    answer:
      'Visual editing runs inside your editor workspace. AI features only send the context needed for the specific request to the configured AI provider.',
  },
  {
    question: 'Is HyperIDE free to use?',
    answer: 'HyperIDE is open source. Check the GitHub repository for license details and contribution guidelines.',
  },
];

export default function FAQ() {
  return (
    <section className="border-t py-20 sm:py-32">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
        {/* Section header */}
        <div className="text-center">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Frequently asked questions</h2>
          <p className="mt-4 text-lg text-muted-foreground">Got questions? We have answers.</p>
        </div>

        {/* FAQ Accordion */}
        <div className="mt-12">
          <Accordion type="single" collapsible className="w-full">
            {faqs.map((faq) => (
              <AccordionItem key={faq.question} value={faq.question}>
                <AccordionTrigger className="text-left">{faq.question}</AccordionTrigger>
                <AccordionContent className="text-muted-foreground">{faq.answer}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </div>
    </section>
  );
}
