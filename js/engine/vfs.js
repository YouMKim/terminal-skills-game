// Virtual filesystem: a tree of dir/file nodes addressed by absolute paths.

export function dir(children = {}) {
  return { type: 'dir', children };
}

export function file(content = '', opts = {}) {
  return { type: 'file', content, exec: !!opts.exec };
}

export class VFS {
  constructor(root) {
    this.root = root || dir();
  }

  // Resolve a path (possibly relative, with ., .., ~) to a normalized absolute path.
  resolve(path, cwd = '/', home = '/home/dev') {
    if (!path) path = '.';
    if (path === '~') path = home;
    else if (path.startsWith('~/')) path = home + path.slice(1);
    const base = path.startsWith('/') ? [] : cwd.split('/').filter(Boolean);
    const parts = base.concat(path.split('/').filter(Boolean));
    const out = [];
    for (const p of parts) {
      if (p === '.') continue;
      if (p === '..') { out.pop(); continue; }
      out.push(p);
    }
    return '/' + out.join('/');
  }

  get(absPath) {
    if (absPath === '/') return this.root;
    const parts = absPath.split('/').filter(Boolean);
    let node = this.root;
    for (const p of parts) {
      if (!node || node.type !== 'dir') return null;
      node = node.children[p];
    }
    return node || null;
  }

  isDir(absPath) {
    const n = this.get(absPath);
    return !!n && n.type === 'dir';
  }

  read(absPath) {
    const n = this.get(absPath);
    if (!n) return null;
    if (n.type !== 'file') return null;
    return n.content;
  }

  // Returns [parentNode, name] or [null, name].
  parentOf(absPath) {
    const parts = absPath.split('/').filter(Boolean);
    const name = parts.pop();
    const parent = this.get('/' + parts.join('/'));
    return [parent && parent.type === 'dir' ? parent : null, name];
  }

  write(absPath, content, { append = false } = {}) {
    const existing = this.get(absPath);
    if (existing) {
      if (existing.type !== 'file') return false;
      existing.content = append ? existing.content + content : content;
      return true;
    }
    const [parent, name] = this.parentOf(absPath);
    if (!parent || !name) return false;
    parent.children[name] = file(content);
    return true;
  }

  append(absPath, content) {
    return this.write(absPath, content, { append: true });
  }

  mkdir(absPath, { parents = false } = {}) {
    const parts = absPath.split('/').filter(Boolean);
    let node = this.root;
    let path = '';
    for (let i = 0; i < parts.length; i++) {
      path += '/' + parts[i];
      const child = node.children[parts[i]];
      if (child) {
        if (child.type !== 'dir') return false;
        node = child;
      } else {
        if (!parents && i < parts.length - 1) return false;
        node = node.children[parts[i]] = dir();
      }
    }
    return true;
  }

  remove(absPath) {
    const [parent, name] = this.parentOf(absPath);
    if (!parent || !parent.children[name]) return false;
    delete parent.children[name];
    return true;
  }

  move(fromAbs, toAbs) {
    const node = this.get(fromAbs);
    if (!node) return false;
    let dest = toAbs;
    if (this.isDir(toAbs)) dest = toAbs.replace(/\/$/, '') + '/' + fromAbs.split('/').filter(Boolean).pop();
    const [parent, name] = this.parentOf(dest);
    if (!parent) return false;
    this.remove(fromAbs);
    parent.children[name] = node;
    return true;
  }

  copy(fromAbs, toAbs) {
    const node = this.get(fromAbs);
    if (!node) return false;
    let dest = toAbs;
    if (this.isDir(toAbs)) dest = toAbs.replace(/\/$/, '') + '/' + fromAbs.split('/').filter(Boolean).pop();
    const [parent, name] = this.parentOf(dest);
    if (!parent) return false;
    parent.children[name] = structuredClone
      ? structuredClone(node)
      : JSON.parse(JSON.stringify(node));
    return true;
  }

  list(absPath) {
    const n = this.get(absPath);
    if (!n || n.type !== 'dir') return null;
    return Object.keys(n.children).sort();
  }

  // Walk the tree depth-first; cb(absPath, node).
  walk(absPath, cb) {
    const n = this.get(absPath);
    if (!n) return;
    cb(absPath === '' ? '/' : absPath, n);
    if (n.type === 'dir') {
      for (const name of Object.keys(n.children).sort()) {
        this.walk((absPath === '/' ? '' : absPath) + '/' + name, cb);
      }
    }
  }

  // Expand a glob pattern (only * supported, in the last path segment).
  glob(pattern, cwd, home) {
    if (!pattern.includes('*')) return [pattern];
    const abs = this.resolve(pattern, cwd, home);
    const parts = abs.split('/').filter(Boolean);
    const last = parts.pop();
    const dirPath = '/' + parts.join('/');
    const names = this.list(dirPath);
    if (!names) return [pattern];
    const re = new RegExp('^' + last.split('*').map(escapeRe).join('.*') + '$');
    const matched = names.filter((n) => re.test(n) && !n.startsWith('.'));
    if (!matched.length) return [pattern];
    // Return paths in the same style the user typed (relative stays relative).
    const prefix = pattern.includes('/') ? pattern.slice(0, pattern.lastIndexOf('/') + 1) : '';
    return matched.map((n) => prefix + n);
  }
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
