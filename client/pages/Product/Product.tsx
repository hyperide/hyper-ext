import Hero from './components/Hero';
import Features from './components/Features';
import HowItWorks from './components/HowItWorks';
import Demo from './components/Demo';
import FAQ from './components/FAQ';
import Footer from './components/Footer';

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
