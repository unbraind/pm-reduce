/** Generate private mounted-profile aliases and public controls without local machine data. */
export function mountedHomePaths(): { forbidden: string[]; allowed: string[] } {
  const forbidden: string[] = []; const allowed: string[] = [];
  for (const drive of 'abcdefghijklmnopqrstuvwxyz') for (const profile of ['Users', 'home']) {
    const path = ['', 'mnt', drive, profile, 'example', 'include'].join('/');
    for (const alias of [path, path.toUpperCase(), path.replaceAll('/', '//')]) {
      for (const prefix of ['', '-I', '-L', '-isystem', 'file:', 'file://', 'file://localhost', '-Ifile://localhost', '-isystemfile:', 'source:file://localhost', 'log|', 'log&', 'log@', 'source:', '"']) forbidden.push(prefix + alias);
      allowed.push(`https://example.com${alias}`, `docs${alias}`, `-Ihttps://example.com${alias}`);
    }
  }
  const profiles = ['home', 'Users', 'root'];
  for (const profile of profiles) {
    const path = ['', profile, 'example', 'fixture'].join('/');
    for (const separator of ['/', '//', '\\', '\\\\', '/\\']) {
      const native = path.replaceAll('/', separator); forbidden.push(native, '-I' + native, 'file://' + native);
      allowed.push('https://example.com' + path, '-Ihttps://example.com' + path, 'docs' + path);
    }
  }
  for (const drive of ['c', 'Z']) for (const profile of ['Users', 'home']) {
    for (const root of [['', drive], ['', 'cygdrive', drive], ['', 'mnt', 'host', drive], ['', 'run', 'desktop', 'mnt', 'host', drive]]) {
      const path = [...root, profile, 'example', 'fixture'].join('/'); forbidden.push(path, '-isystem' + path); allowed.push('docs' + path, 'https://example.com' + path);
    }
    for (const separator of ['/', '//', '\\', '\\\\', '/\\']) forbidden.push(drive + ':' + ['', profile, 'example', 'fixture'].join(separator));
  }
  for (const parts of [['', '', 'server', 'Users', 'example'], ['', '', 'server', 'share', 'Users', 'example'], ['', '', 'server', 'Users']]) forbidden.push(parts.join('/'));
  for (const parts of [['', '.', 'home', 'example'], ['', 'public', '..', 'home', 'example'], ['', 'mnt', '.', 'c', 'Users', 'example'], ['', '', '?', 'UNC', 'server', 'share', 'Users', 'example'], ['', '', '.', 'UNC', 'server', 'share', 'Users', 'example']]) forbidden.push(parts.join('/'));
  allowed.push('/public/../fixture', '/public/./fixture');
  for (const profile of ['home', 'Users', 'root']) forbidden.push(['', profile, ''].join('/'));
  forbidden.push('/' + 'root'); allowed.push('/' + 'home', '/' + 'Users', String.raw`regex: \/root(?:\/|$)`, '-Ifile:///public/fixture');
  allowed.push('/', '//public/fixtures', '/public/fixture', 'https://example.com/root/page', 'https://example.com/Users/page', 'git+ssh://example.com/home/page', 'file:///public/fixture', '-Ipublic/fixture', 'source:/public/fixture', 'file://localhost/public/fixture', 'word:');
  allowed.push('/mnt/c/public/include', ['mnt', 'c', 'Users', 'example', 'include'].join('/'), '-Iinclude', 'src/root.ts');
  return { forbidden, allowed };
}
