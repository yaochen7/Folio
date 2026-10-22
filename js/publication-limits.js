/** Shared manuscript limits. Book size is the UTF-8 length of JSON.stringify(chapters), shown to authors as "5 MB". */
export const MAX_BOOK_BYTES = 5_000_000;
export const PART_BYTES = 1_000_000;
// Parts are cut on code-point boundaries, so a full 5 MB book can need one extra part.
export const MAX_PARTS = 6;
export const MAX_CHAPTERS = 1_000;
export const MAX_PARAGRAPHS_PER_CHAPTER = 20_000;
export const MAX_PARAGRAPH_CHARS = 100_000;
