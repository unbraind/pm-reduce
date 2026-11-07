import { posix } from 'node:path';

/** Normalize the file scheme whether it is standalone or attached to a compiler flag. */
function fileProtocol(value = ''): boolean {
  const protocol = value.toLowerCase();
  return protocol === 'file' || (protocol.startsWith('-') && protocol.endsWith('file'));
}

/** Recognize absolute home aliases with disjoint token/colon scans and anchored local rules. */
export function containsPrivateHomePath(text: string): boolean {
  for (const match of text.matchAll(/[\p{L}\p{N}_./\\~:+-]+/gu)) {
    const token = match[0];
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
        const path = spelling.split(/\/+/u).filter(Boolean).join('/').toLowerCase();
        if (/^(?:home|users|root)\//u.test(path) || (/^(?:home|users|root)$/u.test(path) && spelling.endsWith('/')) || (path === 'root' && match.index + token.length === text.length)) return true;
        if (/^(?:[a-z]|cygdrive\/[a-z]|mnt\/(?:host\/)?[a-z]|run\/desktop\/mnt\/host\/[a-z])\/(?:users|home)(?:\/|$)/u.test(path)) return true;
        if (local.startsWith('//') && /^(?:[^/]+\/){1,2}(?:users|home)(?:\/|$)/u.test(path)) return true;
      }
    }
  }
  return false;
}
