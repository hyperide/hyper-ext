import nextra from 'nextra';

const withNextra = nextra({
  contentDirBasePath: '/docs',
});

export default withNextra({
  reactStrictMode: true,
  // Static export for docs.hyperide.ai
  output: 'export',
  // Fix for Turbopack + MDX (Next.js 15+)
  turbopack: {
    resolveAlias: {
      'next-mdx-import-source-file': './mdx-components.tsx',
    },
  },
});
