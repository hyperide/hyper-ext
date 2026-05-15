import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';

const faqs = [
  {
    question: 'What frameworks does HyperIDE support?',
    answer:
      'HyperIDE supports Vite, Next.js (both App Router and Pages Router), Remix, Create React App, and Bun-based projects. Any React project with a standard package.json can be connected.',
  },
  {
    question: 'Do I need Docker installed?',
    answer:
      'Yes, Docker is required. HyperIDE uses Docker to run your projects in isolated containers, ensuring consistent environments and safe code execution.',
  },
  {
    question: 'Can I use my existing project?',
    answer:
      'Absolutely! Clone your project from Git and HyperIDE will analyze and configure it automatically. Your original repository is never modified — changes are made in a local copy.',
  },
  {
    question: 'How does the AI assistant work?',
    answer:
      'The AI assistant uses large language models to understand your requests and generate code. It knows your component structure, selected elements, and project configuration to provide contextual assistance.',
  },
  {
    question: 'Is my code sent to external servers?',
    answer:
      'AI features require sending code context to AI providers. Check the privacy policy and project settings for configuration options. The editor itself runs locally.',
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
