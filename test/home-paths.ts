/** Generate private mounted-profile aliases and public controls without local machine data. */
export function mountedHomePaths(): { forbidden: string[]; allowed: string[] } {
  const forbidden: string[] = []; const allowed: string[] = [];
  for (const drive of 'abcdefghijklmnopqrstuvwxyz') for (const profile of ['Users', 'home']) {
    const path = ['', 'mnt', drive, profile, 'example', 'include'].join('/');
    for (const alias of [path, path.toUpperCase(), path.replaceAll('/', '//')]) {
      for (const prefix of ['', '-I', '-L', '-isystem', 'file:', 'file://', 'file://localhost', 'log|', 'log&', 'log@', 'source:', '"']) forbidden.push(prefix + alias);
      allowed.push(`https://example.com${alias}`, `docs${alias}`, `-Ihttps://example.com${alias}`);
    }
  }
  allowed.push('/mnt/c/public/include', ['mnt', 'c', 'Users', 'example', 'include'].join('/'), '-Iinclude', 'src/root.ts');
  return { forbidden, allowed };
}
