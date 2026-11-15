export interface ParsedType { cypher: string; outerNotNull: boolean; vector: boolean; genericVector: boolean; dimension?: number }
const aliases: Record<string, string> = { BOOL: 'BOOLEAN', INT: 'INTEGER', 'SIGNED INTEGER': 'INTEGER', VARCHAR: 'STRING', 'TIMESTAMP WITHOUT TIME ZONE': 'LOCAL DATETIME', 'TIMESTAMP WITHOUT TIMEZONE': 'LOCAL DATETIME', 'TIME WITHOUT TIME ZONE': 'LOCAL TIME', 'TIME WITHOUT TIMEZONE': 'LOCAL TIME', 'TIMESTAMP WITH TIME ZONE': 'ZONED DATETIME', 'TIMESTAMP WITH TIMEZONE': 'ZONED DATETIME', 'TIME WITH TIME ZONE': 'ZONED TIME', 'TIME WITH TIMEZONE': 'ZONED TIME' };
const scalars = new Set(['BOOLEAN', 'STRING', 'INTEGER', 'FLOAT', 'DATE', 'DURATION', 'LOCAL DATETIME', 'LOCAL TIME', 'ZONED DATETIME', 'ZONED TIME', 'POINT', 'UUID']);
// A closed grammar: declarations are never interpolated into executable Cypher.
export function parsePropertyType(declaration: string): ParsedType | null {
  let text = declaration.trim().toUpperCase().replace(/\s+/g, ' ');
  const outerNotNull = /(?: NOT NULL|!)$/.test(text);
  text = text.replace(/(?: NOT NULL|!)$/, '').trim();
  if (text.startsWith('ANY<') && text.endsWith('>')) text = text.slice(4, -1);
  let depth = 0, start = 0;
  const parts: string[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '<' || text[i] === '(') depth++;
    if (text[i] === '>' || text[i] === ')') depth--;
    if (depth < 0) return null;
    if (text[i] === '|' && depth === 0) { parts.push(text.slice(start, i).trim()); start = i + 1; }
  }
  if (depth !== 0) return null;
  parts.push(text.slice(start).trim());
  if (parts.length > 1) {
    const parsed = parts.map(parsePropertyType);
    if (parsed.some(p => !p) || parsed.some(p => p!.outerNotNull)) return null;
    return { cypher: parsed.map(p => p!.cypher).join(' | '), outerNotNull, vector: parsed.some(p => p!.vector), genericVector: parsed.some(p => p!.genericVector) };
  }
  const scalar = aliases[text] ?? text;
  if (scalars.has(scalar) || scalar === 'PROPERTY VALUE' || scalar === 'ANY PROPERTY VALUE') return { cypher: scalar === 'ANY PROPERTY VALUE' ? 'PROPERTY VALUE' : scalar, outerNotNull, vector: false, genericVector: false };
  const list = /^(?:LIST|ARRAY)\s*<\s*(.*?)\s*>$/.exec(text) ?? /^(.*?) (?:LIST|ARRAY)$/.exec(text);
  if (list) {
    const inner = parsePropertyType(list[1]!);
    if (!inner || !scalars.has(inner.cypher)) return null;
    return { cypher: `LIST<${inner.cypher} NOT NULL>`, outerNotNull, vector: false, genericVector: false };
  }
  const vector = /^VECTOR(?:\s*<\s*(INTEGER8|INTEGER16|INTEGER32|INTEGER64|INT8|INT16|INT32|INT64|FLOAT32|FLOAT64)\s*>)?(?:\(\s*([0-9]+)\s*\))?$/.exec(text);
  const alt = /^VECTOR\(\s*([0-9]+)\s*,\s*(INTEGER8|INTEGER16|INTEGER32|INTEGER64|INT8|INT16|INT32|INT64|FLOAT32|FLOAT64)\s*\)$/.exec(text);
  if (vector || alt) {
    const rawCoordinate = vector?.[1] ?? alt?.[2], coordinate = rawCoordinate?.replace(/^INT(?=\d)/, 'INTEGER'), dimension = vector?.[2] ?? alt?.[1];
    if (dimension && (+dimension < 1 || +dimension > 4096)) return null;
    return { cypher: `VECTOR${coordinate ? `<${coordinate}>` : ''}${dimension ? `(${+dimension})` : ''}`, outerNotNull, vector: true, genericVector: !coordinate || !dimension, ...(dimension ? { dimension: +dimension } : {}) };
  }
  return null;
}
