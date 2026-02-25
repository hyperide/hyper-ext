/** Escape special RegExp characters in a string for safe use in `new RegExp()` */
export function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
