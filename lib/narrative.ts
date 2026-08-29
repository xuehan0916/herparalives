export type NarrativeBeat = {
  text: string;
};

const SENTENCE_END = /[^。！？；!?;]+[。！？；!?;]?/g;
const MAX_PARAGRAPH_LENGTH = 220;
const COMFORTABLE_PAGE_LENGTH = 230;
const MAX_PARAGRAPHS_PER_PAGE = 4;
const COMFORTABLE_LINES_PER_PAGE = 11;
const CHARACTERS_PER_LINE = 25;

type NarrativePageOptions = {
  maxPages?: number;
};

const estimatedLines = (paragraph: string) => Math.max(1, Math.ceil(paragraph.length / CHARACTERS_PER_LINE)) + 1;

function splitLongParagraph(text: string): string[] {
  const sentences = text.match(SENTENCE_END)?.map((item) => item.trim()).filter(Boolean) ?? [text.trim()];
  const chunks: string[] = [];
  let buffer = "";

  sentences.forEach((sentence) => {
    if (!buffer) {
      buffer = sentence;
      return;
    }
    if (buffer.length < 130 && buffer.length + sentence.length <= MAX_PARAGRAPH_LENGTH) {
      buffer += sentence;
      return;
    }
    chunks.push(buffer);
    buffer = sentence;
  });
  if (buffer) chunks.push(buffer);
  return chunks;
}

/**
 * Turns both legacy story strings and newly generated, paragraph-rich scenes
 * into a small number of page-sized beats. Paragraphs and quoted phrases stay
 * intact; long paragraphs are split only at sentence boundaries.
 */
export function buildNarrativeBeats(scene: string, dialogue?: string, options: NarrativePageOptions = {}): NarrativeBeat[] {
  const paragraphs = scene
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .map((item) => item.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean);

  const pieces = paragraphs.flatMap((paragraph) => paragraph.length > MAX_PARAGRAPH_LENGTH ? splitLongParagraph(paragraph) : [paragraph]);

  const extraDialogue = dialogue?.trim();
  if (extraDialogue && !pieces.some((paragraph) => paragraph.includes(extraDialogue))) pieces.push(extraDialogue);
  if (!pieces.length) return [{ text: scene.trim() }];

  const maxPages = Math.max(1, options.maxPages ?? 5);
  const totalCharacters = pieces.reduce((sum, paragraph) => sum + paragraph.length, 0);
  const totalLines = pieces.reduce((sum, paragraph) => sum + estimatedLines(paragraph), 0);
  const desiredPages = Math.min(maxPages, pieces.length, Math.max(
    1,
    Math.ceil(totalCharacters / COMFORTABLE_PAGE_LENGTH),
    Math.ceil(pieces.length / MAX_PARAGRAPHS_PER_PAGE),
    Math.ceil(totalLines / COMFORTABLE_LINES_PER_PAGE),
  ));

  const pages: string[][] = [];
  let cursor = 0;
  for (let pageIndex = 0; pageIndex < desiredPages; pageIndex += 1) {
    const remainingPages = desiredPages - pageIndex;
    const remainingPieces = pieces.length - cursor;
    const maxTake = remainingPieces - (remainingPages - 1);
    const targetCharacters = pieces.slice(cursor).reduce((sum, paragraph) => sum + paragraph.length, 0) / remainingPages;
    const targetParagraphs = Math.ceil(remainingPieces / remainingPages);
    const page: string[] = [];
    let pageCharacters = 0;
    let pageLines = 0;

    while (page.length < maxTake) {
      const piece = pieces[cursor + page.length];
      const shouldStop = page.length > 0 && page.length >= targetParagraphs && pageCharacters >= targetCharacters;
      if (shouldStop) break;
      page.push(piece);
      pageCharacters += piece.length;
      pageLines += estimatedLines(piece);
      if (page.length >= MAX_PARAGRAPHS_PER_PAGE && remainingPieces <= MAX_PARAGRAPHS_PER_PAGE * remainingPages) break;
      if (pageLines >= COMFORTABLE_LINES_PER_PAGE && page.length >= Math.floor(targetParagraphs / 2)) break;
    }
    pages.push(page);
    cursor += page.length;
  }

  if (cursor < pieces.length) pages[pages.length - 1].push(...pieces.slice(cursor));
  const minimumBalancedLength = Math.min(110, Math.floor(totalCharacters / desiredPages * 0.65));
  for (let pageIndex = pages.length - 1; pageIndex > 0; pageIndex -= 1) {
    const pageLength = () => pages[pageIndex].reduce((sum, paragraph) => sum + paragraph.length, 0);
    while (pageLength() < minimumBalancedLength && pages[pageIndex - 1].length > 2 && pages[pageIndex].length < MAX_PARAGRAPHS_PER_PAGE) {
      pages[pageIndex].unshift(pages[pageIndex - 1].pop() as string);
    }
  }
  return pages.length ? pages.map((page) => ({ text: page.join("\n\n") })) : [{ text: scene.trim() }];
}
