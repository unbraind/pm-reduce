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
  const additions = additionalHomePaths(); forbidden.push(...additions.forbidden); allowed.push(...additions.allowed);
  return { forbidden, allowed };
}

/** Additional lexical aliases and delimiters use only synthetic directory and distribution names. */
export function additionalHomePaths(): { forbidden: string[]; allowed: string[] } {
  const forbidden: string[] = []; const allowed: string[] = [];
  for (const editor of ['vscode', 'vscode-insiders', 'vscodium', 'cursor', 'idea', 'zed']) {
    for (const profile of ['home', 'Users']) {
      const path = ['', profile, 'example', 'repo', 'src', 'x.ts'].join('/');
      forbidden.push(`${editor}://file${path}:12`, `${editor}://open?file=${path}`);
      for (const remote of ['https', 'http', 'ssh', 'git']) allowed.push(`${remote}://file${path}`);
    }
    forbidden.push(`${editor}://file/` + 'root', `${editor}://file/` + 'root.');
    allowed.push(`${editor}://file/public/fixture.ts:12`, `${editor}://extension/publisher.name`);
  }
  allowed.push('home', 'root', 'Users', 'plain words');
  const root = '/' + 'root';
  for (const suffix of [' ', '\t', '\n', '\r\n', '\u00a0', '\u2003', '\u2028', '\ufeff', '"', "'", '`', ',', ';', ')', ']', '}', '|', '&', '!', '?', '.', '...', '. ', '.\n']) forbidden.push(root + suffix, '"' + root + suffix, 'source:' + root + suffix);
  allowed.push('docs' + root + '\n', 'https://example.com' + root + '\n', String.raw`regex: \/root(?:\/|$)`);
  // Trimming sentence periods must not widen the policy: public names that merely end in dots stay allowed.
  allowed.push('/' + 'home.', '/' + 'Users.', root + '.ts', 'docs' + root + '.', '/var/log.', '/public/fixture...', '.'.repeat(5000));
  for (const parts of [['', 'var', 'home'], ['', 'var', 'root'], ['', 'private', 'var', 'root'], ['', 'System', 'Volumes', 'Data', 'Users']]) {
    // Sentence-final periods are punctuation: every bare alias stays forbidden with one or more trailing dots.
    for (const tail of ['', '.', '...', '. ']) forbidden.push(parts.join('/') + tail, 'Reproduced as ' + parts.join('/') + tail);
    const canonical = [...parts, 'example', 'fixture'].join('/');
    for (const separator of ['/', '//', '\\', '/\\']) {
      const native = canonical.replaceAll('/', separator);
      for (const prefix of ['', '-I', 'file:', 'file://localhost', 'source:']) forbidden.push(prefix + native);
      allowed.push('docs' + native, 'log$' + native, 'https://example.com' + canonical);
    }
  }
  for (const host of ['wsl$', 'WSL$', 'wsl.localhost']) for (const profile of [['home'], ['root'], ['var', 'home'], ['mnt', 'c', 'Users']]) for (const separator of ['/', '//', '\\', '/\\']) {
    const native = ['', '', host, 'ExampleDistro', ...profile, 'example', 'fixture'].join(separator);
    for (const prefix of ['', '-I', 'file:', 'file://localhost', 'source:']) forbidden.push(prefix + native, prefix + native + ':42');
    allowed.push('docs' + native, 'log$' + native, `https://${host}/ExampleDistro/${profile.join('/')}/example`);
  }
  for (const host of ['wsl$', 'wsl.localhost']) allowed.push(['', '', host, 'ExampleDistro', 'public', 'root', 'fixture'].join('/'), ['', '', host, 'ExampleDistro'].join('/'));
  allowed.push(['', '', 'wsl$ ', 'ExampleDistro', 'home', 'example'].join('/'), '/var/log/fixture', '/System/Volumes/Data/public/fixture');
  allowed.push(...publicRootPaths().filter(path => path.startsWith('//')));
  allowed.push('1:/public/fixture', '$:/public/fixture');
  const share = ['', '', 'wsl$not-a-share', 'var', 'home'].join('/'); forbidden.push(share); allowed.push('docs' + share);
  return { forbidden, allowed };
}

/** Representative additions for real SDK and installed CLI mutation journeys. */
export function homeProbePaths(): string[] {
  const values = additionalHomePaths().forbidden;
  return ['\n', ['var', 'home'].join('/'), ['System', 'Volumes', 'Data'].join('/'), 'wsl$'].map(marker => values.find(value => value.includes(marker))!);
}

/** Classifier-only public controls; the separate SDK scanner retains its own admission policy. */
export function publicRootPaths(): string[] {
  const paths: string[] = [];
  for (const prefix of ['C:', 'Z:', ['', '', 'server', 'share'].join('/')]) for (const separator of ['/', '\\']) paths.push(prefix + ['', 'root', 'public'].join(separator));
  return paths;
}
