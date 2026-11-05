const packageName = /^(?:@[a-z0-9_-][a-z0-9._-]*\/)?[a-z0-9_-][a-z0-9._-]*$/i;
const bunPg = /^node_modules\/\.bun\/pg@[0-9][a-z0-9._+-]*$/i;
export function assertPackageName(name) {
  if (typeof name !== 'string' || !packageName.test(name)) throw new Error('Invalid package name');
}
/** Only these two pg mappings are replaced by the materialized dependency tree. */
export function assertOnlyPgMappings(mapping) {
  if (mapping === undefined) return;
  if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) throw new Error('Invalid filePathMap');
  for (const [source, destination] of Object.entries(mapping)) {
    if (source !== destination || (source !== 'node_modules/pg' && !bunPg.test(source))) {
      throw new Error('Unhandled traced file mapping; review and package it explicitly');
    }
  }
}
