import assert from 'node:assert/strict';

const nativeExec = RegExp.prototype.exec;

/** Identify one character-class or literal run with no suffix that could force backtracking. */
function characterRun(source: string): boolean {
  if (!source.endsWith('+')) return false;
  if (source.length === 2 && !'()[]*+?{}|^$'.includes(source[0])) return true;
  if (source.length === 3 && source[0] === '\\' && '/:;'.includes(source[1])) return true;
  if (!source.startsWith('[')) return false;
  for (let index = 1; index < source.length; index++) {
    if (source[index] === '\\') index++;
    else if (source[index] === ']') return index === source.length - 2;
  }
  return false;
}

/** A bounded repeated group is safe here only when it consumes a delimiter-excluding run and delimiter. */
function delimitedRun(body: string): boolean {
  const content = body.startsWith('?:') ? body.slice(2) : body;
  const delimiter = content.at(-1)!;
  const prefix = content.slice(0, content.endsWith('\\' + delimiter) ? -2 : -1);
  return !'\\[]().*+?{}|^$'.includes(delimiter) && prefix === `[^${delimiter}]+`;
}

/** Conservative grammar for validated RegExp sources: disjoint unanchored runs, or anchored single-unbounded-atom rules. */
export function linearPattern(source: string, flags = ''): boolean {
  if (flags.includes('m')) return false;
  if (characterRun(source)) return true;
  if (!source.startsWith('^')) return false;
  const groups: number[] = []; let unbounded = 0;
  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    if (character === '\\') { if ('123456789k'.includes(source[++index])) return false; continue; }
    if (character === '[') {
      while (++index < source.length) { if (source[index] === '\\') index++; else if (source[index] === ']') break; }
    } else if (character === '(') groups.push(index + 1);
    else if (character === ')') {
      const start = groups.pop()!; const next = source[index + 1];
      if (next === '+' || next === '*') return false;
      if (next === '{') {
        const repeat = nativeExec.call(/^\{(\d+),(\d+)\}/u, source.slice(index + 1));
        if (!repeat || Number(repeat[2]) > 2 || !delimitedRun(source.slice(start, index))) return false;
        index += repeat[0].length;
      }
    } else if (character === '{' || (character === '|' && groups.length === 0)) return false;
    else if (character === '+' || character === '*') { if (++unbounded > 1) return false; }
  }
  return true;
}

/** Count regex input work without a clock; only proven single-start or disjoint scans reach the engine. */
export function regexWork(action: () => void): number {
  let work = 0; let internal = false;
  RegExp.prototype.exec = function (this: RegExp, input: string): RegExpExecArray | null {
    if (internal) return nativeExec.call(this, input);
    internal = true;
    try {
      assert.ok(linearPattern(this.source, this.flags), 'proof:path_complexity');
      const start = this.lastIndex; const result = nativeExec.call(this, input);
      work += this.sticky ? (result === null ? 1 : this.lastIndex - start) : this.global ? (result === null ? input.length - start : this.lastIndex - start) : input.length;
      return result;
    } finally { internal = false; }
  };
  try { action(); } finally { RegExp.prototype.exec = nativeExec; }
  return work;
}
