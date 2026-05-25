// The acknowledgements markdown carries a placeholder delimited by HTML
// comments. At build time the `thirdPartyNotices` Vite plugin generates the real
// licence notices; this helper swaps the placeholder block (comment wrappers
// included) for that generated Markdown.
const START_MARKER = 'THIRD-PARTY-NOTICES:START';
const END_MARKER = 'THIRD-PARTY-NOTICES:END';

/**
 * Replace the THIRD-PARTY-NOTICES delimiter block in `markdown` — including the
 * enclosing `<!-- ... -->` comments — with `notices`. Throws if the delimiters
 * are missing or malformed, so a broken acknowledgements page fails loudly
 * rather than silently shipping the placeholder.
 */
export function injectThirdPartyNotices(markdown: string, notices: string): string {
  const startMarkerIdx = markdown.indexOf(START_MARKER);
  const endMarkerIdx = markdown.indexOf(END_MARKER);
  if (startMarkerIdx === -1 || endMarkerIdx === -1 || endMarkerIdx < startMarkerIdx) {
    throw new Error(
      'injectThirdPartyNotices: THIRD-PARTY-NOTICES:START/END delimiters not found',
    );
  }

  // Widen the slice to the surrounding comment wrappers so they go too.
  const blockStart = markdown.lastIndexOf('<!--', startMarkerIdx);
  const commentEnd = markdown.indexOf('-->', endMarkerIdx);
  if (blockStart === -1 || commentEnd === -1) {
    throw new Error('injectThirdPartyNotices: malformed THIRD-PARTY-NOTICES comment delimiters');
  }

  return markdown.slice(0, blockStart) + notices + markdown.slice(commentEnd + '-->'.length);
}
