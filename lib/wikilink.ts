export const WIKILINK = /\[\[([^\]|#]+)(?:\|[^\]]*)?\]\]/g;

export function wikilinks(text: string): string[] {
  return [...text.matchAll(WIKILINK)].map((m) => m[1].trim());
}
