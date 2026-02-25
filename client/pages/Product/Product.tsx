import Demo from './components/Demo';
import FAQ from './components/FAQ';
import Features from './components/Features';
import Footer from './components/Footer';
import Hero from './components/Hero';
import HowItWorks from './components/HowItWorks';

export default function Product() {
  return (
    <div className="min-h-screen bg-background">
      <Hero />
      <Features />
      <HowItWorks />
      <Demo />
      <FAQ />
      <Footer />
    </div>
  );
}
