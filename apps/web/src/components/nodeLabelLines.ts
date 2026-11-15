const graphemeSegmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;

function graphemes(text: string) {
  if (graphemeSegmenter) return Array.from(graphemeSegmenter.segment(text), item => item.segment);
  const result: string[] = [];
  for (const character of text) {
    if (result.length && /\p{Mark}/u.test(character)) result[result.length - 1] += character;
    else result.push(character);
  }
  return result;
}

export function nodeLabelLines(name: string, measure: (text: string) => number, maxWidth = 76) {
  const characters = graphemes(name);
  const lines: string[] = [];
  let start = 0;
  while (start < characters.length) {
    let text = '', fitted = '', fittedEnd = start, natural = '', naturalEnd = start;
    for (let end = start + 1; end <= characters.length; end++) {
      const previous = characters[end - 1], next = characters[end];
      text += previous;
      if (measure(text) > maxWidth) break;
      const boundary = next === undefined || /\s/u.test(previous) || /\s/u.test(next) || previous === '-' || next === '-';
      const candidate = text + (boundary ? '' : '-');
      // Include the continuation mark in fitting, rather than adding it to a full line.
      if (measure(candidate) <= maxWidth) {
        fitted = candidate; fittedEnd = end;
        if (boundary) { natural = candidate; naturalEnd = end; }
      }
    }
    if (fittedEnd === characters.length) {
      lines.push(fitted); start = fittedEnd;
    } else if (naturalEnd > start) {
      lines.push(natural); start = naturalEnd;
    } else if (fittedEnd > start) {
      lines.push(fitted); start = fittedEnd;
    } else {
      // An indivisible grapheme can exceed the budget; consume it once and progress.
      lines.push(characters[start++]);
    }
  }
  return lines;
}
