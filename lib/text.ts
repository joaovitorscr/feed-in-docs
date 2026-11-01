const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Limits text to `max` UTF-16 units without splitting an emoji or a combined character. */
export function truncate(text: string, max: number) {
  if (text.length <= max) return text;
  let result = "";
  for (const { segment } of graphemes.segment(text)) {
    if (result.length + segment.length > max) break;
    result += segment;
  }
  return result.trimEnd();
}

/** Keeps characters that would otherwise close a link or open an HTML tag as literal text. */
export function escapeMarkdown(text: string) {
  return text.replace(/[\\[\]<>]/g, "\\$&");
}
