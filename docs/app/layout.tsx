import { Footer, Layout, Navbar } from 'nextra-theme-docs'
import { Head } from 'nextra/components'
import { getPageMap } from 'nextra/page-map'
import 'nextra-theme-docs/style.css'

export const metadata = {
  title: {
    default: 'HyperIDE Documentation',
    template: '%s | HyperIDE Docs',
  },
  description: 'Visual React component editor with AI assistant. Edit components like Figma, generate code with AI.',
  openGraph: {
    title: 'HyperIDE Documentation',
    description: 'Visual React component editor with AI assistant',
    siteName: 'HyperIDE Docs',
  },
}

const navbar = (
  <Navbar
    logo={
      <span className="font-bold text-lg">
        HyperIDE
      </span>
    }
    projectLink="https://github.com/hyperide/hypercanvas"
  />
)

const footer = (
  <Footer>
    <div className="flex w-full justify-between items-center">
      <span>MIT {new Date().getFullYear()} © HyperIDE</span>
      <a href="https://github.com/hyperide/hypercanvas" target="_blank" rel="noopener noreferrer">
        GitHub
      </a>
    </div>
  </Footer>
)

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const pageMap = await getPageMap()

  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <Head />
      <body>
        <Layout
          navbar={navbar}
          pageMap={pageMap}
          docsRepositoryBase="https://github.com/hyperide/hypercanvas/tree/main/docs"
          footer={footer}
          sidebar={{ defaultMenuCollapseLevel: 1 }}
          editLink="Edit this page on GitHub"
          feedback={{ content: null }}
        >
          {children}
        </Layout>
      </body>
    </html>
  )
}
