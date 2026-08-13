// Tamagui generates its own CSS and does NOT use PostCSS/Tailwind. This explicit
// empty config is a boundary: without it, `next build` walks up the directory tree
// and inherits a parent project's postcss.config (e.g. the hyper-saas monorepo's
// Tailwind config) when this template is built in place, failing with
// "Cannot find module 'tailwindcss'". Keep this file even though it looks empty.
// `plugins` must be an explicit (empty) key: Next's webpack PostCSS path rejects a
// config without it ("Your custom PostCSS configuration must export a `plugins` key").
export default { plugins: {} };
