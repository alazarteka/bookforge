const stringUrlFunctions = new Set(["image", "src"]);
const imageSetFunctions = new Set(["image-set", "-webkit-image-set"]);

export function validateCss(css: string, label: string): string[] {
  const references: string[] = [];
  for (let index = 0; index < css.length;) {
    const character = css[index]!;
    if (character === "\"" || character === "'") { index = skipCssString(css, index); continue; }
    if (css.startsWith("/*", index)) {
      const commentEnd = skipCssComment(css, index);
      if (/(?:^|\s)[#@]\s*sourcemappingurl\s*=/i.test(css.slice(index + 2, commentEnd))) {
        throw new Error(`${label}: CSS source maps are not allowed`);
      }
      index = commentEnd;
      continue;
    }
    if (character === "@") {
      const atKeyword = readCssIdentifier(css, index + 1);
      if (atKeyword?.value.toLowerCase() === "import") throw new Error(`${label}: CSS @import is not allowed`);
      if (atKeyword) { index = atKeyword.end; continue; }
    }
    const identifier = readCssIdentifier(css, index);
    if (!identifier) { index += 1; continue; }
    const name = identifier.value.toLowerCase();
    if (css[identifier.end] === "(") {
      if (name === "local") throw new Error(`${label}: CSS local() resources are not allowed`);
      if (name === "expression") throw new Error(`${label}: executable CSS resources are not allowed`);
      if (imageSetFunctions.has(name)) {
        const functionValue = readCssFunction(css, identifier.end);
        if (!functionValue) throw new Error(`${label}: CSS image-set() is not closed`);
        validateImageSet(functionValue.body, label);
        references.push(...validateCss(functionValue.body, label));
        index = functionValue.end;
        continue;
      }
      if (stringUrlFunctions.has(name)) throw new Error(`${label}: CSS string URL resources are not allowed`);
      if (name === "url") {
        const functionValue = readCssFunction(css, identifier.end);
        if (!functionValue) throw new Error(`${label}: CSS url() is not closed`);
        const value = readCssUrlValue(functionValue.body);
        if (!value) throw new Error(`${label}: CSS url() must name a declared theme asset`);
        if (/^(?:https?:|data:|javascript:|\/\/)/i.test(value)) throw new Error(`${label}: remote, embedded, or executable CSS resources are not allowed`);
        references.push(value);
        index = functionValue.end;
        continue;
      }
    }
    index = identifier.end;
  }
  return references;
}

function validateImageSet(body: string, label: string): void {
  let depth = 0;
  let candidateStart = true;
  for (let index = 0; index < body.length;) {
    if (isCssWhitespace(body[index])) { index += 1; continue; }
    if (body.startsWith("/*", index)) { index = skipCssComment(body, index); continue; }
    const candidateFunction = candidateStart ? readCssIdentifier(body, index) : undefined;
    if (candidateFunction?.value.toLowerCase() === "var" && body[candidateFunction.end] === "(") {
      throw new Error(`${label}: CSS variable image-set candidates are not allowed`);
    }
    if (body[index] === "\"" || body[index] === "'") {
      if (depth === 0 && candidateStart) throw new Error(`${label}: CSS string URL resources are not allowed`);
      candidateStart = false;
      index = skipCssString(body, index);
      continue;
    }
    if (body[index] === "(") { depth += 1; candidateStart = false; index += 1; continue; }
    if (body[index] === ")") { depth = Math.max(0, depth - 1); candidateStart = false; index += 1; continue; }
    if (body[index] === "," && depth === 0) { candidateStart = true; index += 1; continue; }
    candidateStart = false;
    index += 1;
  }
}

function readCssIdentifier(css: string, start: number): { value: string; end: number } | undefined {
  if (!isCssNameStart(css[start])) return undefined;
  let value = "";
  let index = start;
  while (index < css.length) {
    if (css.startsWith("/*", index)) {
      index = skipCssComment(css, index);
    } else if (css[index] === "\\") {
      const escaped = readCssEscape(css, index);
      value += escaped.value;
      index = escaped.end;
    } else if (isCssNameCharacter(css[index])) {
      value += css[index];
      index += 1;
    } else break;
  }
  return value ? { value, end: index } : undefined;
}

function readCssFunction(css: string, openingParenthesis: number): { body: string; end: number } | undefined {
  let depth = 1;
  let index = openingParenthesis + 1;
  while (index < css.length) {
    if (css[index] === "\"" || css[index] === "'") { index = skipCssString(css, index); continue; }
    if (css.startsWith("/*", index)) { index = skipCssComment(css, index); continue; }
    if (css[index] === "\\") { index = readCssEscape(css, index).end; continue; }
    if (css[index] === "(") depth += 1;
    if (css[index] === ")" && --depth === 0) return { body: css.slice(openingParenthesis + 1, index), end: index + 1 };
    index += 1;
  }
  return undefined;
}

function readCssUrlValue(body: string): string | undefined {
  let index = skipCssWhitespaceAndComments(body, 0);
  if (index >= body.length) return undefined;
  if (body[index] === "\"" || body[index] === "'") {
    const string = readCssStringValue(body, index);
    return string && skipCssWhitespaceAndComments(body, string.end) === body.length ? string.value : undefined;
  }
  let value = "";
  for (; index < body.length; index += 1) {
    if (isCssWhitespace(body[index])) return skipCssWhitespaceAndComments(body, index) === body.length ? value : undefined;
    if (body.startsWith("/*", index) || body[index] === "\"" || body[index] === "'" || body[index] === "(") return undefined;
    if (body[index] === "\\") {
      const escaped = readCssEscape(body, index);
      value += escaped.value;
      index = escaped.end - 1;
    } else value += body[index];
  }
  return value;
}

function readCssStringValue(value: string, start: number): { value: string; end: number } | undefined {
  const quote = value[start]!;
  let result = "";
  for (let index = start + 1; index < value.length; index += 1) {
    if (value[index] === quote) return { value: result, end: index + 1 };
    if (value[index] === "\\") {
      const continuation = cssNewlineEnd(value, index + 1);
      if (continuation) { index = continuation - 1; continue; }
      const escaped = readCssEscape(value, index);
      result += escaped.value;
      index = escaped.end - 1;
    } else if (cssNewlineEnd(value, index)) return undefined;
    else result += value[index];
  }
  return undefined;
}

function readCssEscape(value: string, start: number): { value: string; end: number } {
  let index = start + 1;
  if (index >= value.length) return { value: "", end: index };
  if (isCssHexDigit(value[index])) {
    const hexStart = index;
    while (index < value.length && index - hexStart < 6 && isCssHexDigit(value[index])) index += 1;
    const codePoint = Number.parseInt(value.slice(hexStart, index), 16);
    if (isCssWhitespace(value[index])) index = cssNewlineEnd(value, index) ?? index + 1;
    return { value: codePoint === 0 || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff) ? "�" : String.fromCodePoint(codePoint), end: index };
  }
  return { value: value[index]!, end: index + 1 };
}

function skipCssString(value: string, start: number): number {
  const quote = value[start]!;
  for (let index = start + 1; index < value.length; index += 1) {
    if (value[index] === quote) return index + 1;
    if (cssNewlineEnd(value, index)) return index;
    if (value[index] === "\\") index = (cssNewlineEnd(value, index + 1) ?? readCssEscape(value, index).end) - 1;
  }
  return value.length;
}

function cssNewlineEnd(value: string, start: number): number | undefined {
  if (value[start] === "\r") return value[start + 1] === "\n" ? start + 2 : start + 1;
  return value[start] === "\n" || value[start] === "\f" ? start + 1 : undefined;
}

function skipCssComment(value: string, start: number): number {
  const end = value.indexOf("*/", start + 2);
  return end === -1 ? value.length : end + 2;
}

function skipCssWhitespaceAndComments(value: string, start: number): number {
  let index = start;
  while (index < value.length) {
    if (isCssWhitespace(value[index])) { index += 1; continue; }
    if (value.startsWith("/*", index)) { index = skipCssComment(value, index); continue; }
    break;
  }
  return index;
}

function isCssNameStart(character: string | undefined): boolean {
  return character === "\\" || character === "-" || character === "_" || !!character && (/[A-Za-z]/.test(character) || character.codePointAt(0)! >= 0x80);
}

function isCssNameCharacter(character: string | undefined): boolean {
  return isCssNameStart(character) || !!character && /[0-9]/.test(character);
}

function isCssWhitespace(character: string | undefined): boolean {
  return character === " " || character === "\t" || character === "\n" || character === "\r" || character === "\f";
}

function isCssHexDigit(character: string | undefined): boolean {
  return !!character && /[0-9a-f]/i.test(character);
}
