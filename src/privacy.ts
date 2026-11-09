import { posix } from 'node:path';

/** Normalize the file scheme whether it is standalone or attached to a compiler flag. */
function fileProtocol(value = ''): boolean {
  const protocol = value.toLowerCase();
  return protocol === 'file' || (protocol.startsWith('-') && protocol.endsWith('file'));
}

/** Recognize absolute home aliases with disjoint token/colon scans and anchored local rules. */
export function containsPrivateHomePath(text: string): boolean {
  for (const match of text.matchAll(/[\p{L}\p{N}_./\\~:$+-]+/gu)) {
    // A sentence-final period is punctuation, not part of the path: a home alias followed by a period classifies like the bare alias.
    // An index loop keeps long runs of dots linear (a `/\.+$/` replace is quadratic on them).
    let end = match[0].length;
    while (end > 0 && match[0][end - 1] === '.') end--;
    const token = match[0].slice(0, end).replace(/^(?:vscode|vscode-insiders|vscodium|cursor|idea|zed):\/\/file(?=\/)/iu, '');
    if (token === '') continue;
    const protocol = token.split(':', 1)[0].toLowerCase();
    const localScheme = /^(?:[a-z]|source)$/u.test(protocol) || fileProtocol(protocol);
    if (/^-?[a-z][a-z0-9+.-]*:\/\//iu.test(token) && !localScheme) continue;
    const pieces = token.split(':');
    for (const [index, piece] of pieces.entries()) {
      let local = piece.replaceAll('\\', '/').replace(/^-[a-z][a-z0-9_-]*(?=\/)/iu, '');
      if (fileProtocol(pieces[index - 1])) local = local.replace(/^\/+localhost(?=\/)/iu, '');
      if (!local.startsWith('/')) continue;
      local = local.replace(/^\/+(?:[?.]\/)?unc\//iu, '//');
      for (const spelling of [local, posix.normalize(local)]) {
        const parts = spelling.toLowerCase().split(/\/+/u).filter(Boolean);
        const drive = pieces[index - 1]?.toLowerCase();
        if (drive?.length === 1 && 'abcdefghijklmnopqrstuvwxyz'.includes(drive)) parts.unshift(drive);
        const wsl = local.startsWith('//') && (parts[0] === 'wsl$' || parts[0] === 'wsl.localhost');
        const path = (wsl ? parts.slice(2) : parts).join('/');
        const after = text[match.index + end];
        if (/^(?:home|users|root)\//u.test(path) || (/^(?:home|users|root)$/u.test(path) && spelling.endsWith('/')) || (path === 'root' && (after === undefined || after.trim() === '' || '"\'`,;[]{}<>|&!?).'.includes(after)))) return true;
        if (/^(?:[a-z]|cygdrive\/[a-z]|mnt\/(?:host\/)?[a-z]|run\/desktop\/mnt\/host\/[a-z]|var|system\/volumes\/data)\/(?:users|home)(?:\/|$)/u.test(path)) return true;
        if (/^(?:var|private\/var)\/root(?:\/|$)/u.test(path)) return true;
        if (!wsl && local.startsWith('//') && /^(?:[^/]+\/){1,2}(?:users|home)(?:\/|$)/u.test(path)) return true;
      }
    }
  }
  return false;
}
