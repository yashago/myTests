/*
 * Git Practice Lab — simulated git + bash environment.
 *
 * Everything runs in memory: the file system, the local repositories, the
 * "GitHub" server and the teammates who push to it. Output mimics real git
 * (2.4x) closely so that students can transfer what they learn to a real terminal.
 *
 * Works in the browser (window.GitLab) and in Node (module.exports) for tests.
 */
(function (root) {
  'use strict';

  const HOME = '/home/student';
  const GIT_VERSION = 'git version 2.47.1 (git-lab simulator)';

  const GIT_COMMANDS = ['add', 'branch', 'checkout', 'clone', 'commit', 'config', 'diff', 'fetch', 'help',
    'init', 'log', 'merge', 'mv', 'pull', 'push', 'remote', 'reset', 'restore', 'rm', 'show', 'stash',
    'status', 'switch', 'version'];
  const NOT_IN_LAB = ['rebase', 'cherry-pick', 'revert', 'tag', 'blame', 'bisect', 'reflog', 'clean', 'worktree', 'submodule'];

  // ───────────────────────── utilities ─────────────────────────

  function randomHash() {
    let s = '';
    for (let i = 0; i < 40; i++) s += '0123456789abcdef'[Math.floor(Math.random() * 16)];
    return s;
  }
  const short = (id) => (id ? id.slice(0, 7) : '');
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const keys = (...objs) => [...new Set(objs.flatMap((o) => Object.keys(o || {})))].sort();
  const plural = (n, word, pl) => `${n} ${n === 1 ? word : pl || word + 's'}`;
  const firstLine = (msg) => msg.split('\n')[0];

  function blobId(content) {
    if (content === undefined) return '0000000';
    let h = 0x811c9dc5;
    for (let i = 0; i < content.length; i++) h = Math.imul(h ^ content.charCodeAt(i), 16777619) >>> 0;
    return (h.toString(16) + 'a3f9c2e').slice(0, 7);
  }

  function fmtDate(t) {
    const d = new Date(t);
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const mons = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const pad = (n) => String(n).padStart(2, '0');
    return `${days[d.getUTCDay()]} ${mons[d.getUTCMonth()]} ${d.getUTCDate()} ` +
      `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} ${d.getUTCFullYear()} +0000`;
  }

  function splitLines(text) {
    if (text === undefined || text === null || text === '') return [];
    const lines = text.split('\n');
    if (lines[lines.length - 1] === '') lines.pop();
    return lines;
  }
  const joinLines = (lines) => (lines.length ? lines.join('\n') + '\n' : '');

  function levenshtein(a, b) {
    const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) dp[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
    }
    return dp[a.length][b.length];
  }

  function globToRegex(glob) {
    const re = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]');
    return new RegExp('^' + re + '$');
  }
  const hasGlob = (s) => /[*?]/.test(s);

  // ───────────────────────── line diff & 3-way merge ─────────────────────────

  function diffLines(aText, bText) {
    const a = splitLines(aText), b = splitLines(bText);
    const n = a.length, m = b.length;
    const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    const ops = [];
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (a[i] === b[j]) { ops.push({ t: ' ', s: a[i] }); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ t: '-', s: a[i] }); i++; }
      else { ops.push({ t: '+', s: b[j] }); j++; }
    }
    while (i < n) ops.push({ t: '-', s: a[i++] });
    while (j < m) ops.push({ t: '+', s: b[j++] });
    return ops;
  }

  function lineStats(aText, bText) {
    let ins = 0, del = 0;
    for (const op of diffLines(aText, bText)) {
      if (op.t === '+') ins++;
      else if (op.t === '-') del++;
    }
    return { ins, del };
  }

  // Unified-diff hunks with 3 lines of context.
  function diffHunks(ops, context = 3) {
    let a = 0, b = 0;
    for (const op of ops) {
      op.a = a; op.b = b;
      if (op.t !== '+') a++;
      if (op.t !== '-') b++;
    }
    const groups = [];
    ops.forEach((op, i) => {
      if (op.t === ' ') return;
      const s = Math.max(0, i - context), e = Math.min(ops.length - 1, i + context);
      const last = groups[groups.length - 1];
      if (last && s <= last.e + 1) last.e = Math.max(last.e, e);
      else groups.push({ s, e });
    });
    return groups.map(({ s, e }) => {
      const slice = ops.slice(s, e + 1);
      const oc = slice.filter((o) => o.t !== '+').length;
      const nc = slice.filter((o) => o.t !== '-').length;
      const os = oc ? ops[s].a + 1 : ops[s].a;
      const ns = nc ? ops[s].b + 1 : ops[s].b;
      const f = (st, c) => (c === 1 ? `${st}` : `${st},${c}`);
      return { header: `@@ -${f(os, oc)} +${f(ns, nc)} @@`, lines: slice };
    });
  }

  // Regions of `base` that `other` replaced: base[s..e) -> lines
  function changeHunks(base, other) {
    const hunks = [];
    let bi = 0, cur = null;
    for (const op of diffLines(joinLines(base), joinLines(other))) {
      if (op.t === ' ') {
        if (cur) { hunks.push(cur); cur = null; }
        bi++;
      } else {
        if (!cur) cur = { s: bi, e: bi, lines: [] };
        if (op.t === '-') { cur.e++; bi++; } else cur.lines.push(op.s);
      }
    }
    if (cur) hunks.push(cur);
    return hunks;
  }

  function applyRegion(base, gs, ge, hunks) {
    const res = [];
    let p = gs;
    for (const h of hunks) {
      for (; p < h.s; p++) res.push(base[p]);
      res.push(...h.lines);
      p = h.e;
    }
    for (; p < ge; p++) res.push(base[p]);
    return res;
  }

  // diff3-style merge. Like git, changes touching the same or adjacent lines conflict.
  function merge3(baseT, oursT, theirsT, oursLabel, theirsLabel) {
    const base = splitLines(baseT);
    const A = changeHunks(base, splitLines(oursT)).map((h) => ({ ...h, side: 'a' }));
    const B = changeHunks(base, splitLines(theirsT)).map((h) => ({ ...h, side: 'b' }));
    const all = [...A, ...B].sort((x, y) => x.s - y.s || x.e - y.e);
    const out = [];
    let pos = 0, conflict = false, k = 0;
    while (k < all.length) {
      const group = [all[k]];
      const gs = all[k].s;
      let ge = all[k].e;
      k++;
      while (k < all.length && all[k].s <= ge) { group.push(all[k]); ge = Math.max(ge, all[k].e); k++; }
      for (; pos < gs; pos++) out.push(base[pos]);
      const sideA = group.filter((h) => h.side === 'a'), sideB = group.filter((h) => h.side === 'b');
      const ra = applyRegion(base, gs, ge, sideA), rb = applyRegion(base, gs, ge, sideB);
      if (!sideB.length) out.push(...ra);
      else if (!sideA.length) out.push(...rb);
      else if (ra.join('\n') === rb.join('\n')) out.push(...ra);
      else {
        conflict = true;
        out.push('<<<<<<< ' + oursLabel, ...ra, '=======', ...rb, '>>>>>>> ' + theirsLabel);
      }
      pos = ge;
    }
    for (; pos < base.length; pos++) out.push(base[pos]);
    return { text: joinLines(out), conflict };
  }

  // ───────────────────────── environment & repositories ─────────────────────────

  function createEnv() {
    return {
      cwd: '',                        // '' = home folder, otherwise the name of a project folder
      dirs: { '': newDir() },
      server: {},                     // "GitHub": url -> bare repository
      config: {
        'user.name': 'Student',
        'user.email': 'student@git-lab.dev',
        'init.defaultBranch': 'main',
        'pull.rebase': 'false',
      },
      clock: Date.UTC(2026, 0, 12, 9, 0, 0),
    };
  }

  function newDir() { return { files: {}, folders: [], repo: null }; }

  function newRepo(branch) {
    return {
      commits: {}, branches: {}, head: { type: 'branch', name: branch || 'main' },
      index: {}, remotes: {}, remoteRefs: {}, upstream: {}, merge: null, stash: [], prev: null,
    };
  }

  const tick = (env) => (env.clock += 7 * 60 * 1000);
  const headId = (repo) => (repo.head.type === 'branch' ? repo.branches[repo.head.name] : repo.head.id);
  const treeOf = (repo, id) => (id && repo.commits[id] ? repo.commits[id].tree : {});
  const author = (env) => `${env.config['user.name'] || 'Student'} <${env.config['user.email'] || 'student@git-lab.dev'}>`;

  function makeCommit(env, repo, tree, parents, message, by) {
    const c = { id: randomHash(), parents: parents.filter(Boolean), message, tree: clone(tree), author: by || author(env), time: tick(env) };
    repo.commits[c.id] = c;
    return c;
  }

  function setHead(repo, id) {
    if (repo.head.type === 'branch') repo.branches[repo.head.name] = id;
    else repo.head.id = id;
  }

  function ancestors(repo, id) {
    const seen = new Set();
    const stack = id ? [id] : [];
    while (stack.length) {
      const c = stack.pop();
      if (seen.has(c) || !repo.commits[c]) continue;
      seen.add(c);
      stack.push(...repo.commits[c].parents);
    }
    return seen;
  }
  const isAncestor = (repo, a, b) => !!a && ancestors(repo, b).has(a);

  function mergeBase(repo, a, b) {
    const A = ancestors(repo, a);
    let best = null;
    for (const id of ancestors(repo, b)) {
      if (A.has(id) && (!best || repo.commits[id].time > repo.commits[best].time)) best = id;
    }
    return best;
  }

  function aheadBehind(repo, local, remote) {
    const L = ancestors(repo, local), R = ancestors(repo, remote);
    let ahead = 0, behind = 0;
    L.forEach((x) => { if (!R.has(x)) ahead++; });
    R.forEach((x) => { if (!L.has(x)) behind++; });
    return { ahead, behind };
  }

  function resolveRev(repo, spec) {
    if (!spec) return null;
    const m = /^(.*?)((?:[~^]\d*)*)$/.exec(spec);
    const base = m[1], suffix = m[2];
    let id = null, kind = 'commit';
    if (base === 'HEAD' || base === '@') { id = headId(repo); kind = 'head'; }
    else if (repo.branches[base]) { id = repo.branches[base]; kind = 'branch'; }
    else if (repo.remoteRefs[base]) { id = repo.remoteRefs[base]; kind = 'remote'; }
    else if (base.startsWith('remotes/') && repo.remoteRefs[base.slice(8)]) { id = repo.remoteRefs[base.slice(8)]; kind = 'remote'; }
    else if (/^[0-9a-f]{4,40}$/.test(base)) {
      const hits = Object.keys(repo.commits).filter((k) => k.startsWith(base));
      if (hits.length === 1) id = hits[0];
    }
    if (!id) return null;
    const re = /([~^])(\d*)/g;
    let s;
    while ((s = re.exec(suffix))) {
      const n = s[2] === '' ? 1 : +s[2];
      const c = repo.commits[id];
      if (s[1] === '~') {
        for (let i = 0; i < n && id; i++) id = repo.commits[id] && repo.commits[id].parents[0];
      } else {
        id = n === 0 ? id : c && c.parents[n - 1];
      }
      if (!id) return null;
      kind = 'commit';
    }
    return { id, kind, name: base };
  }

  // ───────────────────────── .gitignore ─────────────────────────

  function ignoreRules(files) {
    return splitLines(files['.gitignore'] || '')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#') && !l.startsWith('!'));
  }

  function isIgnored(rules, path) {
    const segs = path.split('/');
    return rules.some((raw) => {
      const dirOnly = raw.endsWith('/');
      const pat = raw.replace(/^\//, '').replace(/\/$/, '');
      const re = globToRegex(pat);
      if (pat.includes('/')) {
        return segs.some((_, i) => re.test(segs.slice(0, i + 1).join('/')) && (!dirOnly || i < segs.length - 1));
      }
      return segs.some((seg, i) => re.test(seg) && (!dirOnly || i < segs.length - 1));
    });
  }

  // ───────────────────────── status ─────────────────────────

  function computeStatus(dir) {
    const repo = dir.repo;
    const head = treeOf(repo, headId(repo)), idx = repo.index, wt = dir.files;
    const conflicts = repo.merge ? repo.merge.conflicts : [];
    const staged = [], unstaged = [], untracked = [], ignored = [];
    const rules = ignoreRules(wt);
    for (const p of keys(head, idx)) {
      if (conflicts.includes(p)) continue;
      if (!(p in head)) staged.push({ p, k: 'new file' });
      else if (!(p in idx)) staged.push({ p, k: 'deleted' });
      else if (head[p] !== idx[p]) staged.push({ p, k: 'modified' });
    }
    for (const p of Object.keys(idx).sort()) {
      if (conflicts.includes(p)) continue;
      if (!(p in wt)) unstaged.push({ p, k: 'deleted' });
      else if (wt[p] !== idx[p]) unstaged.push({ p, k: 'modified' });
    }
    for (const p of Object.keys(wt).sort()) {
      if (p in idx || conflicts.includes(p)) continue;
      if (isIgnored(rules, p)) ignored.push(p);
      else untracked.push(p);
    }
    return { staged, unstaged, untracked, ignored, conflicts: conflicts.slice() };
  }

  function trackingLines(repo) {
    if (repo.head.type !== 'branch') return [];
    const up = repo.upstream[repo.head.name];
    if (!up) return [];
    const ref = `${up.remote}/${up.branch}`;
    const rid = repo.remoteRefs[ref];
    if (!rid) return [`Your branch is based on '${ref}', but the upstream is gone.`, '  (use "git branch --unset-upstream" to fixup)'];
    const { ahead, behind } = aheadBehind(repo, headId(repo), rid);
    if (!ahead && !behind) return [`Your branch is up to date with '${ref}'.`];
    if (ahead && !behind) return [`Your branch is ahead of '${ref}' by ${plural(ahead, 'commit')}.`, '  (use "git push" to publish your local commits)'];
    if (!ahead) return [`Your branch is behind '${ref}' by ${plural(behind, 'commit')}, and can be fast-forwarded.`, '  (use "git pull" to update your local branch)'];
    return [`Your branch and '${ref}' have diverged,`, `and have ${ahead} and ${behind} different commits each, respectively.`,
      '  (use "git pull" if you want to integrate the remote branch with yours)'];
  }

  // ───────────────────────── output helpers ─────────────────────────

  function fail(msg) { const e = new Error(msg); e.gitFail = true; return e; }
  function failSilent() { const e = new Error(''); e.gitFail = true; e.silent = true; return e; }

  function makeCtx(env, out, actions) {
    const ctx = {
      env, out, actions,
      get dir() { return env.dirs[env.cwd]; },
      get repo() { return env.dirs[env.cwd].repo; },
      p(text, cls) { String(text).split('\n').forEach((t) => out.push([{ t, c: cls }])); },
      seg(segs) { out.push(segs.filter((s) => s.t !== '')); },
      tip(text) { ctx.p('💡 ' + text, 'tip'); },
    };
    return ctx;
  }

  const pwdOf = (env) => (env.cwd ? `${HOME}/${env.cwd}` : HOME);

  function printDiffstat(ctx, A, B, showModes) {
    const rows = keys(A, B).filter((p) => A[p] !== B[p]).map((p) => ({ p, ...lineStats(A[p], B[p]) }));
    if (!rows.length) return;
    const w = Math.max(...rows.map((r) => r.p.length));
    let ti = 0, td = 0;
    for (const r of rows) {
      ti += r.ins; td += r.del;
      const n = r.ins + r.del, scale = n > 40 ? 40 / n : 1;
      ctx.seg([{ t: ` ${r.p.padEnd(w)} | ${String(n).padStart(2)} ` },
        { t: '+'.repeat(Math.round(r.ins * scale)), c: 'add' }, { t: '-'.repeat(Math.round(r.del * scale)), c: 'del' }]);
    }
    printSummary(ctx, rows.length, ti, td);
    if (showModes) printModes(ctx, A, B);
  }

  function printSummary(ctx, files, ins, del) {
    let s = ` ${plural(files, 'file')} changed`;
    if (ins || !del) s += `, ${plural(ins, 'insertion')}(+)`;
    if (del || !ins) s += `, ${plural(del, 'deletion')}(-)`;
    ctx.p(s);
  }

  function printModes(ctx, A, B) {
    for (const p of keys(A, B)) {
      if (!(p in A)) ctx.p(` create mode 100644 ${p}`);
      else if (!(p in B)) ctx.p(` delete mode 100644 ${p}`);
    }
  }

  function printFileDiff(ctx, p, a, b) {
    ctx.p(`diff --git a/${p} b/${p}`, 'bold');
    if (a === undefined) ctx.p('new file mode 100644', 'bold');
    if (b === undefined) ctx.p('deleted file mode 100644', 'bold');
    ctx.p(`index ${blobId(a)}..${blobId(b)}${a !== undefined && b !== undefined ? ' 100644' : ''}`, 'bold');
    ctx.p(a === undefined ? '--- /dev/null' : `--- a/${p}`, 'bold');
    ctx.p(b === undefined ? '+++ /dev/null' : `+++ b/${p}`, 'bold');
    for (const h of diffHunks(diffLines(a, b))) {
      ctx.p(h.header, 'info');
      for (const l of h.lines) ctx.p(l.t + l.s, l.t === '+' ? 'add' : l.t === '-' ? 'del' : undefined);
    }
  }

  function printTreeDiff(ctx, A, B, only) {
    for (const p of keys(A, B)) {
      if (A[p] !== B[p] && (!only || only.includes(p))) printFileDiff(ctx, p, A[p], B[p]);
    }
  }

  function decorations(repo, id) {
    const segs = [];
    const add = (t, c) => { if (segs.length) segs.push({ t: ', ', c: 'hash' }); segs.push(...[].concat(t).map((x, i) => ({ t: x, c: [].concat(c)[i] }))); };
    const cur = repo.head.type === 'branch' ? repo.head.name : null;
    if (cur && repo.branches[cur] === id) add(['HEAD -> ', cur], ['head', 'branch']);
    else if (!cur && repo.head.id === id) add('HEAD', 'head');
    for (const b of Object.keys(repo.branches).sort()) if (b !== cur && repo.branches[b] === id) add(b, 'branch');
    for (const r of Object.keys(repo.remoteRefs).sort()) if (repo.remoteRefs[r] === id) add(r, 'remote');
    return segs.length ? [{ t: ' (', c: 'hash' }, ...segs, { t: ')', c: 'hash' }] : [];
  }

  function printLogEntry(ctx, c, oneline, graph) {
    const g = graph ? [{ t: '* ', c: 'hash' }] : [];
    const deco = decorations(ctx.repo, c.id);
    if (oneline) {
      ctx.seg([...g, { t: short(c.id), c: 'hash' }, ...deco, { t: ' ' + firstLine(c.message) }]);
      return;
    }
    ctx.seg([...g, { t: 'commit ' + c.id, c: 'hash' }, ...deco]);
    const pre = graph ? '| ' : '';
    if (c.parents.length > 1) ctx.p(pre + 'Merge: ' + c.parents.map(short).join(' '));
    ctx.p(pre + 'Author: ' + c.author);
    ctx.p(pre + 'Date:   ' + fmtDate(c.time));
    ctx.p(pre);
    c.message.split('\n').forEach((l) => ctx.p(pre + '    ' + l));
    ctx.p(pre);
  }

  function shortChangeLines(ctx) {
    const st = computeStatus(ctx.dir);
    const seen = new Set();
    const codes = { 'new file': 'A', modified: 'M', deleted: 'D' };
    [...st.staged, ...st.unstaged].forEach((e) => {
      if (seen.has(e.p)) return;
      seen.add(e.p);
      ctx.p(`${codes[e.k]}\t${e.p}`);
    });
  }

  // ───────────────────────── work-tree movement ─────────────────────────

  // Refuse to touch files with uncommitted changes, like real git does.
  function checkLocal(ctx, cur, tgt, op, strictIndex) {
    const { repo, dir } = ctx;
    const idx = repo.index, wt = dir.files;
    const dirty = new Set(), untracked = [];
    for (const p of keys(cur, tgt)) {
      if (cur[p] === tgt[p]) continue;
      if (!(p in cur) && !(p in idx)) {
        if (p in wt && wt[p] !== tgt[p]) untracked.push(p);
        continue;
      }
      const local = idx[p] !== cur[p] || wt[p] !== idx[p];
      if (local && !(idx[p] === tgt[p] && wt[p] === tgt[p])) dirty.add(p);
    }
    if (strictIndex) keys(cur, idx).forEach((p) => { if (cur[p] !== idx[p]) dirty.add(p); });
    const what = op === 'checkout' ? 'switch branches' : op;
    if (dirty.size) {
      throw fail(`error: Your local changes to the following files would be overwritten by ${op}:\n` +
        [...dirty].sort().map((p) => '\t' + p).join('\n') +
        `\nPlease commit your changes or stash them before you ${what}.\nAborting`);
    }
    if (untracked.length) {
      throw fail(`error: The following untracked working tree files would be overwritten by ${op}:\n` +
        untracked.map((p) => '\t' + p).join('\n') + `\nPlease move or remove them before you ${what}.\nAborting`);
    }
  }

  function moveWorkTree(ctx, fromId, toId, op) {
    const { repo, dir } = ctx;
    const cur = treeOf(repo, fromId), tgt = treeOf(repo, toId);
    checkLocal(ctx, cur, tgt, op, op === 'merge');
    for (const p of keys(cur, tgt)) {
      if (cur[p] === tgt[p]) continue;
      if (p in tgt) { repo.index[p] = tgt[p]; dir.files[p] = tgt[p]; }
      else { delete repo.index[p]; delete dir.files[p]; }
    }
  }

  function requireNoMerge(repo) {
    if (repo.merge && repo.merge.conflicts.length) {
      throw fail('error: you need to resolve your current index first\n' +
        repo.merge.conflicts.map((p) => `${p}: needs merge`).join('\n'));
    }
  }

  function switchToBranch(ctx, name) {
    const { repo } = ctx;
    if (repo.head.type === 'branch' && repo.head.name === name) {
      ctx.p(`Already on '${name}'`);
      trackingLines(repo).forEach((l) => ctx.p(l));
      return;
    }
    requireNoMerge(repo);
    moveWorkTree(ctx, headId(repo), repo.branches[name], 'checkout');
    rememberPrev(repo);
    repo.head = { type: 'branch', name };
    shortChangeLines(ctx);
    ctx.p(`Switched to branch '${name}'`);
    trackingLines(repo).forEach((l) => ctx.p(l));
  }

  function rememberPrev(repo) {
    repo.prev = repo.head.type === 'branch' ? repo.head.name : repo.head.id;
  }

  function detachAt(ctx, id, spec) {
    const { repo } = ctx;
    requireNoMerge(repo);
    moveWorkTree(ctx, headId(repo), id, 'checkout');
    rememberPrev(repo);
    repo.head = { type: 'detached', id };
    ctx.p(`Note: switching to '${spec}'.

You are in 'detached HEAD' state. You can look around, make experimental
changes and commit them, and you can discard any commits you make in this
state without impacting any branches by switching back to a branch.

If you want to create a new branch to retain commits you create, you may
do so (now or later) by using -c with the switch command. Example:

  git switch -c <new-branch-name>

Or undo this operation with:

  git switch -
`);
    ctx.p(`HEAD is now at ${short(id)} ${firstLine(repo.commits[id].message)}`);
  }

  const INVALID_BRANCH = /[\s~^:?*[\\]|\.\.|^[-/.]|\/$|\.lock$|@\{|\/\/|^HEAD$/;

  function createAndSwitch(ctx, name, start) {
    const { repo } = ctx;
    if (INVALID_BRANCH.test(name)) throw fail(`fatal: '${name}' is not a valid branch name`);
    if (repo.branches[name]) throw fail(`fatal: a branch named '${name}' already exists`);
    requireNoMerge(repo);
    let startId = headId(repo), track = null;
    if (start) {
      const r = resolveRev(repo, start);
      if (!r) throw fail(`fatal: '${start}' is not a commit and a branch '${name}' cannot be created from it`);
      startId = r.id;
      if (r.kind === 'remote') track = r.name;
    }
    if (!startId) {
      repo.head = { type: 'branch', name };
      ctx.p(`Switched to a new branch '${name}'`);
      return;
    }
    moveWorkTree(ctx, headId(repo), startId, 'checkout');
    rememberPrev(repo);
    repo.branches[name] = startId;
    repo.head = { type: 'branch', name };
    if (track) {
      const [remote, ...rest] = track.split('/');
      repo.upstream[name] = { remote, branch: rest.join('/') };
      ctx.p(`branch '${name}' set up to track '${track}'.`);
    }
    shortChangeLines(ctx);
    ctx.p(`Switched to a new branch '${name}'`);
  }

  // `git checkout foo` where only origin/foo exists → create a tracking branch
  function remoteDwim(repo, name) {
    const hits = Object.keys(repo.remoteRefs).filter((r) => r.split('/').slice(1).join('/') === name);
    return hits.length === 1 ? hits[0] : null;
  }

  function matchSpec(path, spec) {
    spec = normPath(spec);
    if (spec === '' || spec === '.') return true;
    if (hasGlob(spec)) {
      const re = globToRegex(spec);
      return re.test(path) || re.test(path.split('/').pop());
    }
    return path === spec || path.startsWith(spec + '/');
  }

  function normPath(p) {
    return p.replace(/^\.\//, '').replace(/\/+$/, '').replace(/^\.$/, '.');
  }

  function expandSpecs(candidates, specs, msg) {
    const out = new Set();
    for (const s of specs) {
      const hit = candidates.filter((p) => matchSpec(p, s));
      if (!hit.length && normPath(s) !== '.') throw fail(msg(s));
      hit.forEach((p) => out.add(p));
    }
    return [...out].sort();
  }

  // ───────────────────────── merge ─────────────────────────

  function doMerge(ctx, theirs, label, message, opts) {
    opts = opts || {};
    const { repo, dir, env } = ctx;
    const ours = headId(repo);
    if (!ours) {
      moveWorkTree(ctx, null, theirs, 'merge');
      setHead(repo, theirs);
      return;
    }
    if (isAncestor(repo, theirs, ours)) { ctx.p('Already up to date.'); return; }
    if (isAncestor(repo, ours, theirs) && !opts.noFF) {
      const before = treeOf(repo, ours);
      moveWorkTree(ctx, ours, theirs, 'merge');
      setHead(repo, theirs);
      ctx.p(`Updating ${short(ours)}..${short(theirs)}`);
      ctx.p('Fast-forward');
      printDiffstat(ctx, before, treeOf(repo, theirs), true);
      return;
    }
    if (opts.ffOnly) throw fail('fatal: Not possible to fast-forward, aborting.');

    const base = mergeBase(repo, ours, theirs);
    const B = treeOf(repo, base), O = treeOf(repo, ours), T = treeOf(repo, theirs);
    const result = {}, conflicts = [], notes = [];
    for (const p of keys(B, O, T)) {
      const b = B[p], o = O[p], t = T[p];
      if (o === t || t === b) { if (o !== undefined) result[p] = o; continue; }
      if (o === b) { if (t !== undefined) result[p] = t; continue; }
      if (o !== undefined && t !== undefined) {
        notes.push(`Auto-merging ${p}`);
        const m = merge3(b, o, t, 'HEAD', label);
        result[p] = m.text;
        if (m.conflict) {
          conflicts.push(p);
          notes.push(`CONFLICT (${b === undefined ? 'add/add' : 'content'}): Merge conflict in ${p}`);
        }
      } else {
        conflicts.push(p);
        result[p] = o !== undefined ? o : t;
        notes.push(o === undefined
          ? `CONFLICT (modify/delete): ${p} deleted in HEAD and modified in ${label}.  Version ${label} of ${p} left in tree.`
          : `CONFLICT (modify/delete): ${p} deleted in ${label} and modified in HEAD.  Version HEAD of ${p} left in tree.`);
      }
    }
    checkLocal(ctx, O, result, 'merge', true);
    const saved = { index: clone(repo.index), files: clone(dir.files) };
    for (const p of keys(O, result)) {
      const conflicted = conflicts.includes(p);
      if (O[p] === result[p] && !conflicted) continue;
      if (conflicted) {
        dir.files[p] = result[p];
        if (p in O) repo.index[p] = O[p]; else delete repo.index[p];
      } else if (p in result) {
        repo.index[p] = dir.files[p] = result[p];
      } else {
        delete repo.index[p];
        delete dir.files[p];
      }
    }
    notes.forEach((n) => ctx.p(n, n.startsWith('CONFLICT') ? 'err' : undefined));
    if (conflicts.length) {
      repo.merge = { theirs, conflicts, message, saved };
      ctx.p('Automatic merge failed; fix conflicts and then commit the result.');
      throw failSilent();
    }
    const c = makeCommit(env, repo, result, [ours, theirs], message);
    setHead(repo, c.id);
    ctx.p("Merge made by the 'ort' strategy.");
    printDiffstat(ctx, O, c.tree, true);
  }

  function mergeMessage(repo, name, kind) {
    const cur = repo.head.type === 'branch' ? repo.head.name : null;
    const into = cur && cur !== 'main' && cur !== 'master' ? ` into ${cur}` : '';
    return kind === 'remote' ? `Merge remote-tracking branch '${name}'${into}` : `Merge branch '${name}'${into}`;
  }

  // ───────────────────────── remotes ─────────────────────────

  function canonUrl(url) {
    let u = url.trim().replace(/\/+$/, '');
    const ssh = /^git@([^:]+):(.+)$/.exec(u);
    if (ssh) u = `https://${ssh[1]}/${ssh[2]}`;
    if (!u.endsWith('.git')) u += '.git';
    return u;
  }

  function findServer(env, url) {
    const c = canonUrl(url);
    return env.server[c] ? c : null;
  }

  const NO_REMOTE = (name) => `fatal: '${name}' does not appear to be a git repository
fatal: Could not read from remote repository.

Please make sure you have the correct access rights
and the repository exists.`;

  function serverFor(ctx, remoteName) {
    const r = ctx.repo.remotes[remoteName];
    if (!r) throw fail(NO_REMOTE(remoteName));
    const s = ctx.env.server[r.url];
    if (!s) throw fail(`remote: Repository not found.\nfatal: repository '${r.url}/' not found`);
    return { url: r.url, server: s };
  }

  function fetchRemote(ctx, remoteName) {
    const { repo } = ctx;
    const { url, server } = serverFor(ctx, remoteName);
    let objs = 0;
    for (const [id, c] of Object.entries(server.commits)) {
      if (!repo.commits[id]) { repo.commits[id] = c; objs += 3; }
    }
    const updates = [];
    for (const b of Object.keys(server.branches).sort()) {
      const ref = `${remoteName}/${b}`, old = repo.remoteRefs[ref], nw = server.branches[b];
      if (old === nw) continue;
      let field;
      if (!old) field = ' * [new branch]';
      else if (isAncestor(repo, old, nw)) field = `   ${short(old)}..${short(nw)}`;
      else field = ` + ${short(old)}...${short(nw)}`;
      updates.push({ field, b, ref, forced: field.startsWith(' +') });
      repo.remoteRefs[ref] = nw;
    }
    if (!updates.length) return 0;
    if (objs) {
      ctx.p(`remote: Enumerating objects: ${objs}, done.`);
      ctx.p(`remote: Counting objects: 100% (${objs}/${objs}), done.`);
      ctx.p(`remote: Total ${objs} (delta 0), reused ${objs} (delta 0), pack-reused 0`);
      ctx.p(`Unpacking objects: 100% (${objs}/${objs}), done.`);
    }
    ctx.p(`From ${url.replace(/\.git$/, '')}`);
    const w = Math.max(...updates.map((u) => u.b.length));
    updates.forEach((u) => ctx.p(`${u.field.padEnd(21)}${u.b.padEnd(w)} -> ${u.ref}${u.forced ? '  (forced update)' : ''}`));
    return updates.length;
  }

  // ───────────────────────── git commands ─────────────────────────

  const GIT = {};

  GIT.init = (ctx, args) => {
    const { env } = ctx;
    const name = args.find((a) => !a.startsWith('-'));
    let key = env.cwd;
    if (name) {
      if (env.cwd !== '') throw fail('lab: create new projects from your home folder — run `cd ~` first.');
      key = normPath(name);
      if (!env.dirs[key]) env.dirs[key] = newDir();
    }
    const dir = env.dirs[key];
    const where = key ? `${HOME}/${key}/.git/` : `${HOME}/.git/`;
    if (dir.repo) { ctx.p(`Reinitialized existing Git repository in ${where}`); return; }
    dir.repo = newRepo(env.config['init.defaultBranch']);
    ctx.p(`Initialized empty Git repository in ${where}`);
  };

  GIT.status = (ctx, args) => {
    const { repo, dir } = ctx;
    const isShort = args.some((a) => a === '-s' || a === '--short' || a === '-sb');
    const showBranch = args.some((a) => a === '-b' || a === '--branch' || a === '-sb');
    const st = computeStatus(dir);
    const hid = headId(repo);
    if (isShort) {
      if (showBranch) {
        let line = repo.head.type === 'branch' ? `## ${hid ? '' : 'No commits yet on '}${repo.head.name}` : '## HEAD (no branch)';
        const up = repo.head.type === 'branch' && repo.upstream[repo.head.name];
        if (up && hid) {
          const ref = `${up.remote}/${up.branch}`;
          line += `...${ref}`;
          if (repo.remoteRefs[ref]) {
            const { ahead, behind } = aheadBehind(repo, hid, repo.remoteRefs[ref]);
            const parts = [ahead && `ahead ${ahead}`, behind && `behind ${behind}`].filter(Boolean);
            if (parts.length) line += ` [${parts.join(', ')}]`;
          }
        }
        ctx.p(line, 'branch');
      }
      const code = { 'new file': 'A', modified: 'M', deleted: 'D' };
      const rows = {};
      st.staged.forEach((e) => { rows[e.p] = [code[e.k], ' ']; });
      st.unstaged.forEach((e) => { rows[e.p] = [(rows[e.p] || [' '])[0], code[e.k]]; });
      st.conflicts.forEach((p) => ctx.seg([{ t: 'UU', c: 'del' }, { t: ' ' + p }]));
      Object.keys(rows).sort().forEach((p) => ctx.seg([{ t: rows[p][0], c: 'add' }, { t: rows[p][1], c: 'del' }, { t: ' ' + p }]));
      st.untracked.forEach((p) => ctx.seg([{ t: '??', c: 'del' }, { t: ' ' + p }]));
      return;
    }
    ctx.p(repo.head.type === 'branch' ? `On branch ${repo.head.name}` : `HEAD detached at ${short(repo.head.id)}`,
      repo.head.type === 'branch' ? undefined : 'del');
    trackingLines(repo).forEach((l) => ctx.p(l));
    if (!hid) { ctx.p(''); ctx.p('No commits yet'); }
    if (repo.merge) {
      ctx.p('');
      if (st.conflicts.length) {
        ctx.p('You have unmerged paths.\n  (fix conflicts and run "git commit")\n  (use "git merge --abort" to abort the merge)');
      } else {
        ctx.p('All conflicts fixed but you are still merging.\n  (use "git commit" to conclude merge)');
      }
    }
    const lbl = (k) => (k + ':').padEnd(12);
    if (st.staged.length) {
      ctx.p('');
      ctx.p('Changes to be committed:');
      ctx.p(hid ? '  (use "git restore --staged <file>..." to unstage)' : '  (use "git rm --cached <file>..." to unstage)');
      st.staged.forEach((e) => ctx.p(`\t${lbl(e.k)}${e.p}`, 'add'));
    }
    if (st.conflicts.length) {
      ctx.p('');
      ctx.p('Unmerged paths:\n  (use "git add <file>..." to mark resolution)');
      st.conflicts.forEach((p) => ctx.p(`\tboth modified:   ${p}`, 'del'));
    }
    if (st.unstaged.length) {
      ctx.p('');
      ctx.p('Changes not staged for commit:');
      ctx.p('  (use "git add' + (st.unstaged.some((e) => e.k === 'deleted') ? '/rm' : '') + ' <file>..." to update what will be committed)');
      ctx.p('  (use "git restore <file>..." to discard changes in working directory)');
      st.unstaged.forEach((e) => ctx.p(`\t${lbl(e.k)}${e.p}`, 'del'));
    }
    if (st.untracked.length) {
      ctx.p('');
      ctx.p('Untracked files:\n  (use "git add <file>..." to include in what will be committed)');
      st.untracked.forEach((p) => ctx.p(`\t${p}`, 'del'));
    }
    ctx.p('');
    if (st.staged.length || st.conflicts.length) return;
    if (repo.merge) return;
    if (st.unstaged.length) ctx.p('no changes added to commit (use "git add" and/or "git commit -a")');
    else if (st.untracked.length) ctx.p('nothing added to commit but untracked files present (use "git add" to track)');
    else if (!hid) ctx.p('nothing to commit (create/copy files and use "git add" to track)');
    else ctx.p('nothing to commit, working tree clean');
  };

  function stagePath(ctx, p) {
    const { repo, dir } = ctx;
    if (p in dir.files) repo.index[p] = dir.files[p];
    else delete repo.index[p];
    if (repo.merge) repo.merge.conflicts = repo.merge.conflicts.filter((x) => x !== p);
  }

  GIT.add = (ctx, args) => {
    const { repo, dir } = ctx;
    let all = false, update = false, force = false;
    const specs = [];
    for (const a of args) {
      if (a === '-A' || a === '--all') all = true;
      else if (a === '-u' || a === '--update') update = true;
      else if (a === '-f' || a === '--force') force = true;
      else if (a === '--' || a === '-v' || a === '--verbose') continue;
      else if (a.startsWith('-')) throw fail(`error: unknown option '${a.replace(/^-+/, '')}'`);
      else specs.push(a);
    }
    if (!specs.length && !all && !update) {
      ctx.p("Nothing specified, nothing added.\nhint: Maybe you wanted to say 'git add .'?", 'warn');
      return;
    }
    const rules = ignoreRules(dir.files);
    const conflicts = repo.merge ? repo.merge.conflicts : [];
    let cands = keys(dir.files, repo.index, Object.fromEntries(conflicts.map((c) => [c, 1])));
    if (update) cands = cands.filter((p) => p in repo.index || conflicts.includes(p));
    const effective = specs.length ? specs : ['.'];
    const ignoredHits = [];
    const paths = expandSpecs(cands, effective, (s) => `fatal: pathspec '${s}' did not match any files`).filter((p) => {
      const ign = !(p in repo.index) && !force && isIgnored(rules, p);
      if (ign && specs.some((s) => normPath(s) === p)) ignoredHits.push(p);
      return !ign;
    });
    if (ignoredHits.length) {
      throw fail('The following paths are ignored by one of your .gitignore files:\n' + ignoredHits.join('\n') +
        '\nhint: Use -f if you really want to add them.');
    }
    paths.forEach((p) => stagePath(ctx, p));
  };

  GIT.rm = (ctx, args) => {
    const { repo, dir } = ctx;
    const cached = args.includes('--cached');
    const specs = args.filter((a) => !a.startsWith('-'));
    if (!specs.length) throw fail('usage: git rm [<options>] [--] <file>...');
    const paths = expandSpecs(Object.keys(repo.index), specs, (s) => `fatal: pathspec '${s}' did not match any files`);
    for (const p of paths) {
      delete repo.index[p];
      if (!cached) delete dir.files[p];
      ctx.p(`rm '${p}'`);
    }
  };

  GIT.mv = (ctx, args) => {
    const { repo, dir } = ctx;
    const [src, dst] = args.filter((a) => !a.startsWith('-')).map(normPath);
    if (!src || !dst) throw fail('usage: git mv [<options>] <source>... <destination>');
    if (!(src in repo.index)) throw fail(`fatal: not under version control, source=${src}, destination=${dst}`);
    if (dst in dir.files) throw fail(`fatal: destination exists, source=${src}, destination=${dst}`);
    dir.files[dst] = dir.files[src];
    repo.index[dst] = dir.files[src];
    delete dir.files[src];
    delete repo.index[src];
  };

  GIT.commit = (ctx, args) => {
    const { repo, dir, env } = ctx;
    const msgs = [];
    let all = false, amend = false, allowEmpty = false, noEdit = false;
    const paths = [];
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === '-m' || a === '--message' || a === '-am' || a === '-a-m') {
        if (a !== '-m' && a !== '--message') all = true;
        if (i + 1 >= args.length) throw fail("error: switch `m' requires a value");
        msgs.push(args[++i]);
      } else if (a.startsWith('--message=')) msgs.push(a.slice(10));
      else if (/^-m./.test(a)) msgs.push(a.slice(2));
      else if (a === '-a' || a === '--all') all = true;
      else if (a === '--amend') amend = true;
      else if (a === '--allow-empty') allowEmpty = true;
      else if (a === '--no-edit') noEdit = true;
      else if (a === '--') continue;
      else if (a.startsWith('-')) throw fail(`error: unknown option \`${a.replace(/^-+/, '')}'`);
      else paths.push(a);
    }
    if (repo.merge && repo.merge.conflicts.length && !all) {
      throw fail('error: Committing is not possible because you have unmerged files.\n' +
        "hint: Fix them up in the work tree, and then use 'git add/rm <file>'\n" +
        'hint: as appropriate to mark resolution and make a commit.\nfatal: Exiting because of an unresolved conflict.');
    }
    const head = headId(repo);
    if (amend && !head) throw fail('fatal: You have nothing to amend.');
    if (paths.length) {
      expandSpecs(keys(repo.index, dir.files), paths, (s) => `error: pathspec '${s}' did not match any file(s) known to git`)
        .forEach((p) => stagePath(ctx, p));
    }
    if (all) {
      Object.keys(repo.index).forEach((p) => stagePath(ctx, p));
      if (repo.merge) repo.merge.conflicts.slice().forEach((p) => stagePath(ctx, p));
    }
    let message = msgs.join('\n\n');
    if (!message) {
      if (repo.merge) message = repo.merge.message;
      else if (amend && noEdit) message = repo.commits[head].message;
      else {
        ctx.p('Aborting commit due to empty commit message.', 'err');
        ctx.tip('This practice terminal has no text editor for commit messages. Use: git commit -m "describe your change"');
        throw failSilent();
      }
    }
    const tree = clone(repo.index);
    const parentTree = amend ? treeOf(repo, repo.commits[head].parents[0]) : treeOf(repo, head);
    const same = JSON.stringify(tree) === JSON.stringify(treeOf(repo, head));
    if (!repo.merge && !amend && !allowEmpty && same) {
      GIT.status(ctx, []);
      throw failSilent();
    }
    let parents = amend ? repo.commits[head].parents.slice() : [head];
    if (repo.merge) parents = [head, repo.merge.theirs];
    const c = makeCommit(env, repo, tree, parents, message);
    setHead(repo, c.id);
    const wasMerge = !!repo.merge;
    repo.merge = null;
    const where = repo.head.type === 'branch' ? repo.head.name : 'detached HEAD';
    ctx.p(`[${where}${c.parents.length ? '' : ' (root-commit)'} ${short(c.id)}] ${firstLine(message)}`);
    if (wasMerge) return;
    const rows = keys(parentTree, tree).filter((p) => parentTree[p] !== tree[p]);
    let ins = 0, del = 0;
    rows.forEach((p) => { const s = lineStats(parentTree[p], tree[p]); ins += s.ins; del += s.del; });
    printSummary(ctx, rows.length, ins, del);
    printModes(ctx, parentTree, tree);
  };

  GIT.log = (ctx, args) => {
    const { repo } = ctx;
    let oneline = false, all = false, graph = false, limit = Infinity;
    const revs = [];
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === '--oneline' || a === '--pretty=oneline' || a === '--format=oneline') oneline = true;
      else if (a === '--all') all = true;
      else if (a === '--graph') graph = true;
      else if (a === '--decorate' || a.startsWith('--decorate=')) continue;
      else if (a === '-n') limit = +args[++i];
      else if (/^-\d+$/.test(a)) limit = +a.slice(1);
      else if (/^(-n|--max-count=)\d+$/.test(a)) limit = +a.replace(/\D/g, '');
      else if (a.startsWith('-')) throw fail(`fatal: unrecognized argument: ${a}`);
      else revs.push(a);
    }
    const res = (s) => {
      const r = resolveRev(repo, s || 'HEAD');
      if (!r) throw fail(`fatal: ambiguous argument '${s}': unknown revision or path not in the working tree.\n` +
        "Use '--' to separate paths from revisions, like this:\n'git <command> [<revision>...] -- [<file>...]'");
      return r.id;
    };
    const include = [], exclude = [];
    for (const r of revs) {
      if (r.includes('..')) { const [x, y] = r.split(/\.\.\.?/); exclude.push(res(x)); include.push(res(y)); }
      else if (r.startsWith('^')) exclude.push(res(r.slice(1)));
      else include.push(res(r));
    }
    if (all) include.push(...Object.values(repo.branches), ...Object.values(repo.remoteRefs), headId(repo));
    if (!include.filter(Boolean).length) {
      const h = headId(repo);
      if (!h) throw fail(`fatal: your current branch '${repo.head.name}' does not have any commits yet`);
      include.push(h);
    }
    const set = new Set();
    include.filter(Boolean).forEach((id) => ancestors(repo, id).forEach((x) => set.add(x)));
    exclude.forEach((id) => ancestors(repo, id).forEach((x) => set.delete(x)));
    [...set].map((id) => repo.commits[id]).sort((a, b) => b.time - a.time).slice(0, limit)
      .forEach((c) => printLogEntry(ctx, c, oneline, graph));
  };

  GIT.show = (ctx, args) => {
    const { repo } = ctx;
    const rev = args.find((a) => !a.startsWith('-')) || 'HEAD';
    const r = resolveRev(repo, rev);
    if (!r) throw fail(`fatal: ambiguous argument '${rev}': unknown revision or path not in the working tree.`);
    const c = repo.commits[r.id];
    printLogEntry(ctx, c, false, false);
    if (c.parents.length <= 1) printTreeDiff(ctx, treeOf(repo, c.parents[0]), c.tree);
  };

  GIT.diff = (ctx, args) => {
    const { repo, dir } = ctx;
    let staged = false, stat = false, nameOnly = false;
    const pos = [], paths = [];
    let afterDD = false;
    for (const a of args) {
      if (afterDD) paths.push(a);
      else if (a === '--') afterDD = true;
      else if (a === '--staged' || a === '--cached') staged = true;
      else if (a === '--stat') stat = true;
      else if (a === '--name-only') nameOnly = true;
      else if (a.startsWith('-')) throw fail(`error: invalid option: ${a}`);
      else pos.push(a);
    }
    const revs = [];
    for (const a of pos) {
      if (a.includes('..')) a.split(/\.\.\.?/).forEach((x) => revs.push(x || 'HEAD'));
      else if (resolveRev(repo, a)) revs.push(a);
      else paths.push(a);
    }
    const tree = (s) => {
      const r = resolveRev(repo, s);
      if (!r) throw fail(`fatal: ambiguous argument '${s}': unknown revision or path not in the working tree.`);
      return treeOf(repo, r.id);
    };
    let A, B;
    const tracked = (t) => Object.fromEntries(Object.entries(dir.files).filter(([p]) => p in t || p in repo.index));
    if (revs.length >= 2) { A = tree(revs[0]); B = tree(revs[1]); }
    else if (revs.length === 1) { A = tree(revs[0]); B = staged ? repo.index : tracked(A); }
    else if (staged) { A = treeOf(repo, headId(repo)); B = repo.index; }
    else { A = repo.index; B = tracked({}); }
    const only = paths.length ? keys(A, B).filter((p) => paths.some((s) => matchSpec(p, s))) : null;
    if (stat) {
      const pick = (t) => (only ? Object.fromEntries(Object.entries(t).filter(([p]) => only.includes(p))) : t);
      printDiffstat(ctx, pick(A), pick(B), false);
    } else if (nameOnly) {
      keys(A, B).filter((p) => A[p] !== B[p] && (!only || only.includes(p))).forEach((p) => ctx.p(p));
    } else {
      printTreeDiff(ctx, A, B, only);
    }
  };

  GIT.branch = (ctx, args) => {
    const { repo, env } = ctx;
    const flags = new Set(), pos = [];
    let upstreamTo = null;
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === '-u') upstreamTo = args[++i];
      else if (a.startsWith('--set-upstream-to=')) upstreamTo = a.split('=')[1];
      else if (a === '--set-upstream-to') upstreamTo = args[++i];
      else if (a.startsWith('-')) flags.add(a);
      else pos.push(a);
    }
    const cur = repo.head.type === 'branch' ? repo.head.name : null;
    const hid = headId(repo);
    const has = (...f) => f.some((x) => flags.has(x));

    if (has('--show-current')) { if (cur) ctx.p(cur); return; }

    if (upstreamTo !== null) {
      const b = pos[0] || cur;
      if (!b || !repo.branches[b]) throw fail(`fatal: branch '${b}' does not exist`);
      if (!repo.remoteRefs[upstreamTo]) throw fail(`fatal: the requested upstream branch '${upstreamTo}' does not exist`);
      const [remote, ...rest] = upstreamTo.split('/');
      repo.upstream[b] = { remote, branch: rest.join('/') };
      ctx.p(`branch '${b}' set up to track '${upstreamTo}'.`);
      return;
    }
    if (has('--unset-upstream')) { delete repo.upstream[pos[0] || cur]; return; }

    if (has('-d', '-D', '--delete')) {
      const force = has('-D', '--force');
      if (!pos.length) throw fail('fatal: branch name required');
      let bad = false;
      for (const n of pos) {
        if (n === cur) { ctx.p(`error: cannot delete branch '${n}' used by worktree at '${pwdOf(env)}'`, 'err'); bad = true; continue; }
        if (!repo.branches[n]) { ctx.p(`error: branch '${n}' not found.`, 'err'); bad = true; continue; }
        const up = repo.upstream[n];
        const target = (up && repo.remoteRefs[`${up.remote}/${up.branch}`]) || hid;
        if (!force && !isAncestor(repo, repo.branches[n], target)) {
          ctx.p(`error: the branch '${n}' is not fully merged.\nhint: If you are sure you want to delete it, run 'git branch -D ${n}'`, 'err');
          bad = true;
          continue;
        }
        ctx.p(`Deleted branch ${n} (was ${short(repo.branches[n])}).`);
        delete repo.branches[n];
        delete repo.upstream[n];
      }
      if (bad) throw failSilent();
      return;
    }

    if (has('-m', '-M', '--move')) {
      const [from, to] = pos.length === 1 ? [cur, pos[0]] : pos;
      if (!from || !to) throw fail('fatal: branch name required');
      if (INVALID_BRANCH.test(to)) throw fail(`fatal: '${to}' is not a valid branch name`);
      if (repo.branches[to] && !has('-M')) throw fail(`fatal: a branch named '${to}' already exists`);
      if (!repo.branches[from] && !(from === cur && !hid)) throw fail(`error: refname refs/heads/${from} not found\nfatal: branch rename failed`);
      if (repo.branches[from]) { repo.branches[to] = repo.branches[from]; delete repo.branches[from]; }
      if (repo.upstream[from]) { repo.upstream[to] = repo.upstream[from]; delete repo.upstream[from]; }
      if (cur === from) repo.head.name = to;
      return;
    }

    if (pos.length && !has('--list', '-a', '-r', '--all', '--remotes', '-v', '-vv')) {
      const [name, start] = pos;
      if (INVALID_BRANCH.test(name)) throw fail(`fatal: '${name}' is not a valid branch name`);
      if (repo.branches[name]) throw fail(`fatal: a branch named '${name}' already exists`);
      let id = hid;
      if (start) {
        const r = resolveRev(repo, start);
        if (!r) throw fail(`fatal: not a valid object name: '${start}'`);
        id = r.id;
        if (r.kind === 'remote') {
          const [remote, ...rest] = r.name.split('/');
          repo.upstream[name] = { remote, branch: rest.join('/') };
          ctx.p(`branch '${name}' set up to track '${r.name}'.`);
        }
      }
      if (!id) throw fail(`fatal: not a valid object name: '${cur || 'HEAD'}'`);
      repo.branches[name] = id;
      return;
    }

    const verbose = has('-v', '-vv', '--verbose');
    const vv = has('-vv');
    const showLocal = !has('-r', '--remotes');
    const showRemote = has('-a', '--all', '-r', '--remotes');
    const names = Object.keys(repo.branches).sort();
    const width = Math.max(0, ...names.map((n) => n.length), ...(showRemote ? Object.keys(repo.remoteRefs).map((n) => n.length + (showLocal ? 8 : 0)) : []));
    const detail = (id, b) => {
      if (!verbose) return [];
      const segs = [{ t: ' ' + short(id), c: 'hash' }, { t: ' ' }];
      const up = b && repo.upstream[b];
      if (vv && up) {
        const ref = `${up.remote}/${up.branch}`;
        let info = ref;
        if (repo.remoteRefs[ref]) {
          const { ahead, behind } = aheadBehind(repo, id, repo.remoteRefs[ref]);
          const parts = [ahead && `ahead ${ahead}`, behind && `behind ${behind}`].filter(Boolean);
          if (parts.length) info += ': ' + parts.join(', ');
        } else info += ': gone';
        segs.push({ t: '[' }, { t: info, c: 'info' }, { t: '] ' });
      }
      segs.push({ t: firstLine(repo.commits[id].message) });
      return segs;
    };
    if (showLocal) {
      if (!cur && hid) ctx.seg([{ t: '* ' }, { t: `(HEAD detached at ${short(hid)})`, c: 'branch' }, ...detail(hid)]);
      for (const n of names) {
        const me = n === cur;
        ctx.seg([{ t: me ? '* ' : '  ' }, { t: verbose ? n.padEnd(width) : n, c: me ? 'branch' : undefined }, ...detail(repo.branches[n], n)]);
      }
    }
    if (showRemote) {
      for (const r of Object.keys(repo.remoteRefs).sort()) {
        const label = (showLocal ? 'remotes/' : '') + r;
        ctx.seg([{ t: '  ' }, { t: verbose ? label.padEnd(width) : label, c: 'remote' }, ...detail(repo.remoteRefs[r])]);
      }
    }
  };

  function checkoutPaths(ctx, rev, specs) {
    const { repo, dir } = ctx;
    if (rev) {
      const r = resolveRev(repo, rev);
      if (!r) throw fail(`fatal: invalid reference: ${rev}`);
      const T = treeOf(repo, r.id);
      const paths = expandSpecs(Object.keys(T), specs, (s) => `error: pathspec '${s}' did not match any file(s) known to git`);
      paths.forEach((p) => { repo.index[p] = dir.files[p] = T[p]; });
      ctx.p(`Updated ${plural(paths.length, 'path')} from ${short(r.id)}`);
      return;
    }
    const conflicts = repo.merge ? repo.merge.conflicts : [];
    const paths = expandSpecs(keys(repo.index, Object.fromEntries(conflicts.map((c) => [c, 1]))), specs,
      (s) => `error: pathspec '${s}' did not match any file(s) known to git`);
    const blocked = paths.filter((p) => conflicts.includes(p));
    if (blocked.length) throw fail(blocked.map((p) => `error: path '${p}' is unmerged`).join('\n'));
    let n = 0;
    paths.forEach((p) => { if (dir.files[p] !== repo.index[p]) n++; dir.files[p] = repo.index[p]; });
    ctx.p(`Updated ${plural(n, 'path')} from the index`);
  }

  function switchPrevious(ctx) {
    const { repo } = ctx;
    if (!repo.prev) throw fail('fatal: invalid reference: @{-1}');
    if (repo.branches[repo.prev]) return switchToBranch(ctx, repo.prev);
    return detachAt(ctx, repo.prev, short(repo.prev));
  }

  GIT.checkout = (ctx, args) => {
    const { repo, dir } = ctx;
    const dd = args.indexOf('--');
    const opts = dd >= 0 ? args.slice(0, dd) : args;
    const paths = dd >= 0 ? args.slice(dd + 1) : [];
    let newBranch = null;
    const pos = [];
    for (let i = 0; i < opts.length; i++) {
      const a = opts[i];
      if (a === '-b' || a === '-B') {
        newBranch = opts[++i];
        if (!newBranch) throw fail("error: switch `b' requires a value");
      } else if (a === '-') pos.push(a);
      else if (a === '-f' || a === '--force' || a === '-q') continue;
      else if (a.startsWith('-')) throw fail(`error: unknown switch \`${a.replace(/^-+/, '')}'`);
      else pos.push(a);
    }
    if (newBranch) return createAndSwitch(ctx, newBranch, pos[0]);
    if (dd >= 0) {
      if (!paths.length) throw fail('fatal: you must specify path(s) to restore');
      return checkoutPaths(ctx, pos[0], paths);
    }
    if (!pos.length) return;
    const target = pos[0];
    if (target === '-') return switchPrevious(ctx);
    if (pos.length > 1) {
      if (resolveRev(repo, target)) return checkoutPaths(ctx, target, pos.slice(1));
      return checkoutPaths(ctx, null, pos);
    }
    if (repo.branches[target]) return switchToBranch(ctx, target);
    if (repo.head.type === 'branch' && repo.head.name === target && !headId(repo)) {
      throw fail(`error: pathspec '${target}' did not match any file(s) known to git`);
    }
    const dwim = remoteDwim(repo, target);
    if (dwim) return createAndSwitch(ctx, target, dwim);
    const r = resolveRev(repo, target);
    if (r) return detachAt(ctx, r.id, target);
    if (Object.keys(repo.index).some((p) => matchSpec(p, target)) || (repo.merge && repo.merge.conflicts.includes(target))) {
      return checkoutPaths(ctx, null, [target]);
    }
    if (target in dir.files) throw fail(`error: pathspec '${target}' did not match any file(s) known to git`);
    throw fail(`error: pathspec '${target}' did not match any file(s) known to git`);
  };

  GIT.switch = (ctx, args) => {
    const { repo } = ctx;
    let create = null, detach = false;
    const pos = [];
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === '-c' || a === '-C' || a === '--create') {
        create = args[++i];
        if (!create) throw fail("error: switch `c' requires a value");
      } else if (a === '-d' || a === '--detach') detach = true;
      else if (a === '-') pos.push(a);
      else if (a.startsWith('-')) throw fail(`error: unknown switch \`${a.replace(/^-+/, '')}'`);
      else pos.push(a);
    }
    if (create) return createAndSwitch(ctx, create, pos[0]);
    const target = pos[0];
    if (!target) throw fail('fatal: missing branch or commit argument');
    if (target === '-') return switchPrevious(ctx);
    if (detach) {
      const r = resolveRev(repo, target);
      if (!r) throw fail(`fatal: invalid reference: ${target}`);
      return detachAt(ctx, r.id, target);
    }
    if (repo.branches[target]) return switchToBranch(ctx, target);
    const dwim = remoteDwim(repo, target);
    if (dwim) return createAndSwitch(ctx, target, dwim);
    if (resolveRev(repo, target)) {
      throw fail(`fatal: a branch is expected, got ${repo.remoteRefs[target] ? 'remote branch' : 'commit'} '${target}'\n` +
        'hint: If you want to detach HEAD at the commit, try again with the --detach option.');
    }
    throw fail(`fatal: invalid reference: ${target}`);
  };

  GIT.restore = (ctx, args) => {
    const { repo, dir } = ctx;
    let staged = false, worktree = false, source = null;
    const specs = [];
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === '--staged' || a === '-S') staged = true;
      else if (a === '--worktree' || a === '-W') worktree = true;
      else if (a === '-s' || a === '--source') source = args[++i];
      else if (a.startsWith('--source=')) source = a.slice(9);
      else if (a === '--') continue;
      else if (a.startsWith('-')) throw fail(`error: unknown option \`${a.replace(/^-+/, '')}'`);
      else specs.push(a);
    }
    if (!specs.length) throw fail('fatal: you must specify path(s) to restore');
    if (!staged) worktree = true;
    const head = treeOf(repo, headId(repo));
    let src = null;
    if (source) {
      const r = resolveRev(repo, source);
      if (!r) throw fail(`fatal: could not resolve ${source}`);
      src = treeOf(repo, r.id);
    }
    const miss = (s) => `error: pathspec '${s}' did not match any file(s) known to git`;
    if (staged) {
      const from = src || head;
      const paths = expandSpecs(keys(from, repo.index), specs, miss);
      paths.forEach((p) => {
        if (p in from) repo.index[p] = from[p]; else delete repo.index[p];
        if (repo.merge) repo.merge.conflicts = repo.merge.conflicts.filter((x) => x !== p);
      });
    }
    if (worktree) {
      const from = src || (staged ? head : repo.index);
      const conflicts = repo.merge ? repo.merge.conflicts : [];
      const paths = expandSpecs(keys(from, src ? dir.files : {}), specs, miss);
      const blocked = paths.filter((p) => conflicts.includes(p) && !staged);
      if (blocked.length) throw fail(blocked.map((p) => `error: path '${p}' is unmerged`).join('\n'));
      paths.forEach((p) => { if (p in from) dir.files[p] = from[p]; else delete dir.files[p]; });
    }
  };

  GIT.reset = (ctx, args) => {
    const { repo, dir } = ctx;
    let mode = null;
    const rest = [];
    let afterDD = false;
    for (const a of args) {
      if (afterDD) rest.push(a);
      else if (a === '--soft' || a === '--mixed' || a === '--hard') mode = a.slice(2);
      else if (a === '--') afterDD = true;
      else if (a === '-q') continue;
      else if (a.startsWith('-')) throw fail(`error: unknown option '${a.replace(/^-+/, '')}'`);
      else rest.push(a);
    }
    let target = 'HEAD';
    const isPathLike = (s) => s in dir.files || s in repo.index;
    if (rest.length && resolveRev(repo, rest[0]) && !isPathLike(rest[0])) target = rest.shift();
    else if (rest.length && /^(HEAD|@)([~^]\d*)*$/.test(rest[0])) target = rest.shift();
    const r = resolveRev(repo, target);
    if (rest.length) {
      if (mode && mode !== 'mixed') throw fail(`fatal: Cannot do ${mode} reset with paths.`);
      const T = r ? treeOf(repo, r.id) : {};
      const paths = expandSpecs(keys(T, repo.index), rest, (s) =>
        `fatal: ambiguous argument '${s}': unknown revision or path not in the working tree.`);
      paths.forEach((p) => { if (p in T) repo.index[p] = T[p]; else delete repo.index[p]; });
      printUnstaged(ctx);
      return;
    }
    if (!r) {
      if (!headId(repo) && target === 'HEAD') { repo.index = {}; return; }
      throw fail(`fatal: ambiguous argument '${target}': unknown revision or path not in the working tree.\n` +
        "Use '--' to separate paths from revisions, like this:\n'git <command> [<revision>...] -- [<file>...]'");
    }
    mode = mode || 'mixed';
    const T = treeOf(repo, r.id), H = treeOf(repo, headId(repo));
    if (mode === 'soft' && repo.merge) throw fail('fatal: Cannot do a soft reset in the middle of a merge.');
    setHead(repo, r.id);
    if (mode === 'hard') {
      for (const p of keys(H, repo.index, T)) {
        if (p in T) repo.index[p] = dir.files[p] = T[p];
        else { delete repo.index[p]; delete dir.files[p]; }
      }
      repo.merge = null;
      ctx.p(`HEAD is now at ${short(r.id)} ${firstLine(repo.commits[r.id].message)}`);
    } else if (mode === 'mixed') {
      repo.index = clone(T);
      repo.merge = null;
      printUnstaged(ctx);
    }
  };

  function printUnstaged(ctx) {
    const st = computeStatus(ctx.dir);
    if (!st.unstaged.length) return;
    ctx.p('Unstaged changes after reset:');
    st.unstaged.forEach((e) => ctx.p(`${e.k === 'deleted' ? 'D' : 'M'}\t${e.p}`));
  }

  GIT.merge = (ctx, args) => {
    const { repo } = ctx;
    let noFF = false, ffOnly = false, msg = null;
    const pos = [];
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === '--abort') {
        if (!repo.merge) throw fail('fatal: There is no merge to abort (MERGE_HEAD missing).');
        repo.index = repo.merge.saved.index;
        ctx.dir.files = repo.merge.saved.files;
        repo.merge = null;
        return;
      }
      if (a === '--continue') return GIT.commit(ctx, []);
      if (a === '--no-ff') noFF = true;
      else if (a === '--ff-only') ffOnly = true;
      else if (a === '--ff' || a === '--no-edit') continue;
      else if (a === '-m') msg = args[++i];
      else if (a.startsWith('-')) throw fail(`error: unknown option \`${a.replace(/^-+/, '')}'`);
      else pos.push(a);
    }
    if (repo.merge) {
      if (repo.merge.conflicts.length) {
        throw fail('error: Merging is not possible because you have unmerged files.\n' +
          "hint: Fix them up in the work tree, and then use 'git add/rm <file>'\n" +
          'hint: as appropriate to mark resolution and make a commit.\nfatal: Exiting because of an unresolved conflict.');
      }
      throw fail('fatal: You have not concluded your merge (MERGE_HEAD exists).\nPlease, commit your changes before you merge.');
    }
    let name = pos[0];
    if (!name) {
      const up = repo.head.type === 'branch' && repo.upstream[repo.head.name];
      if (!up) throw fail('fatal: No remote for the current branch.');
      name = `${up.remote}/${up.branch}`;
    }
    const r = resolveRev(repo, name);
    if (!r) throw fail(`merge: ${name} - not something we can merge`);
    doMerge(ctx, r.id, name, msg || mergeMessage(repo, name, r.kind), { noFF, ffOnly });
  };

  GIT.remote = (ctx, args) => {
    const { repo } = ctx;
    const verbose = args[0] === '-v' || args[0] === '--verbose';
    if (!args.length || verbose) {
      for (const [n, r] of Object.entries(repo.remotes)) {
        if (verbose) { ctx.p(`${n}\t${r.url} (fetch)`); ctx.p(`${n}\t${r.url} (push)`); }
        else ctx.p(n);
      }
      return;
    }
    const [sub, name, url] = args;
    switch (sub) {
      case 'add':
        if (!name || !url) throw fail('usage: git remote add [<options>] <name> <url>');
        if (repo.remotes[name]) throw fail(`error: remote ${name} already exists.`);
        repo.remotes[name] = { url: canonUrl(url) };
        return;
      case 'remove': case 'rm':
        if (!repo.remotes[name]) throw fail(`error: No such remote: '${name}'`);
        delete repo.remotes[name];
        Object.keys(repo.remoteRefs).filter((r) => r.startsWith(name + '/')).forEach((r) => delete repo.remoteRefs[r]);
        Object.keys(repo.upstream).filter((b) => repo.upstream[b].remote === name).forEach((b) => delete repo.upstream[b]);
        return;
      case 'set-url':
        if (!repo.remotes[name]) throw fail(`error: No such remote '${name}'`);
        repo.remotes[name].url = canonUrl(url);
        return;
      case 'get-url':
        if (!repo.remotes[name]) throw fail(`error: No such remote '${name}'`);
        ctx.p(repo.remotes[name].url);
        return;
      default:
        throw fail(`error: unknown subcommand: \`${sub}'`);
    }
  };

  GIT.clone = (ctx, args) => {
    const { env } = ctx;
    const pos = args.filter((a) => !a.startsWith('-'));
    const url = pos[0];
    if (!url) throw fail('fatal: You must specify a repository to clone.\n\nusage: git clone [<options>] [--] <repo> [<dir>]');
    if (env.cwd !== '') {
      ctx.tip('In this lab, projects live directly in your home folder. Run `cd ~` first, then clone.');
      throw failSilent();
    }
    const name = normPath(pos[1] || canonUrl(url).split('/').pop().replace(/\.git$/, ''));
    if ((env.dirs[name] && (env.dirs[name].repo || Object.keys(env.dirs[name].files).length)) || name in env.dirs[''].files) {
      throw fail(`fatal: destination path '${name}' already exists and is not an empty directory.`);
    }
    ctx.p(`Cloning into '${name}'...`);
    const key = findServer(env, url);
    if (!key) throw fail(`remote: Repository not found.\nfatal: repository '${url.replace(/\/$/, '')}/' not found`);
    const server = env.server[key];
    const repo = newRepo(server.head.name);
    repo.remotes.origin = { url: key };
    Object.assign(repo.commits, server.commits);
    Object.entries(server.branches).forEach(([b, id]) => { repo.remoteRefs[`origin/${b}`] = id; });
    const dir = newDir();
    dir.repo = repo;
    env.dirs[name] = dir;
    const tip = server.branches[server.head.name];
    if (!tip) { ctx.p('warning: You appear to have cloned an empty repository.', 'warn'); return; }
    repo.branches[server.head.name] = tip;
    repo.upstream[server.head.name] = { remote: 'origin', branch: server.head.name };
    repo.index = clone(treeOf(repo, tip));
    dir.files = clone(treeOf(repo, tip));
    const n = Object.keys(server.commits).length * 3;
    ctx.p(`remote: Enumerating objects: ${n}, done.\nremote: Counting objects: 100% (${n}/${n}), done.\n` +
      `remote: Total ${n} (delta 0), reused ${n} (delta 0), pack-reused 0\nReceiving objects: 100% (${n}/${n}), done.`);
  };

  GIT.fetch = (ctx, args) => {
    const { repo } = ctx;
    const pos = args.filter((a) => !a.startsWith('-'));
    const all = args.includes('--all');
    const names = all ? Object.keys(repo.remotes) : [pos[0] || upstreamRemote(repo)];
    if (!names[0]) throw fail(NO_REMOTE('origin'));
    names.forEach((n) => fetchRemote(ctx, n));
  };

  function upstreamRemote(repo) {
    const up = repo.head.type === 'branch' && repo.upstream[repo.head.name];
    if (up) return up.remote;
    return repo.remotes.origin ? 'origin' : Object.keys(repo.remotes)[0];
  }

  GIT.pull = (ctx, args) => {
    const { repo } = ctx;
    let ffOnly = false;
    const pos = [];
    for (const a of args) {
      if (a === '--rebase' || a === '-r') {
        ctx.tip('`git pull --rebase` is not available in this lab yet — use a plain `git pull` (merge).');
        throw failSilent();
      }
      if (a === '--ff-only') ffOnly = true;
      else if (a === '--no-rebase' || a === '--ff' || a === '--no-edit') continue;
      else if (a.startsWith('-')) throw fail(`error: unknown option \`${a.replace(/^-+/, '')}'`);
      else pos.push(a);
    }
    if (repo.merge) {
      throw fail('error: Pulling is not possible because you have unmerged files.\n' +
        "hint: Fix them up in the work tree, and then use 'git add/rm <file>'\n" +
        'hint: as appropriate to mark resolution and make a commit.\nfatal: Exiting because of an unresolved conflict.');
    }
    const cur = repo.head.type === 'branch' ? repo.head.name : null;
    const up = cur && repo.upstream[cur];
    if (!pos.length && !Object.keys(repo.remotes).length) {
      throw fail('fatal: No remote repository specified.  Please, specify either a URL or a\nremote name from which new revisions should be fetched.');
    }
    const remote = pos[0] || (up ? up.remote : upstreamRemote(repo));
    fetchRemote(ctx, remote);
    let branch = pos[1] || (up && up.remote === remote ? up.branch : null);
    if (!branch) {
      if (!cur) {
        throw fail('You are not currently on a branch.\nPlease specify which branch you want to merge with.\n' +
          "See git-pull(1) for details.\n\n    git pull <remote> <branch>\n");
      }
      throw fail('There is no tracking information for the current branch.\n' +
        'Please specify which branch you want to merge with.\nSee git-pull(1) for details.\n\n' +
        '    git pull <remote> <branch>\n\nIf you wish to set tracking information for this branch you can do so with:\n\n' +
        `    git branch --set-upstream-to=${remote}/<branch> ${cur}\n`);
    }
    const ref = `${remote}/${branch}`;
    const id = repo.remoteRefs[ref];
    if (!id) throw fail(`fatal: couldn't find remote ref ${branch}`);
    doMerge(ctx, id, short(id), `Merge branch '${branch}' of ${repo.remotes[remote].url.replace(/\.git$/, '')}`, { ffOnly });
  };

  GIT.push = (ctx, args) => {
    const { repo } = ctx;
    let setUp = false, force = false, del = false;
    const pos = [];
    for (const a of args) {
      if (a === '-u' || a === '--set-upstream') setUp = true;
      else if (a === '-f' || a === '--force' || a === '--force-with-lease') force = true;
      else if (a === '-d' || a === '--delete') del = true;
      else if (a.startsWith('-')) throw fail(`error: unknown option \`${a.replace(/^-+/, '')}'`);
      else pos.push(a);
    }
    const cur = repo.head.type === 'branch' ? repo.head.name : null;
    const noUpstream = () => fail(`fatal: The current branch ${cur} has no upstream branch.\n` +
      'To push the current branch and set the remote as upstream, use\n\n' +
      `    git push --set-upstream ${upstreamRemote(repo) || 'origin'} ${cur}\n`);
    const detached = () => fail('fatal: You are not currently on a branch.\nTo push the history leading to the current (detached HEAD)\n' +
      'state now, use\n\n    git push origin HEAD:<name-of-remote-branch>\n');
    let remoteName = pos[0], spec = pos[1];
    if (!remoteName) {
      if (!Object.keys(repo.remotes).length) {
        throw fail('fatal: No configured push destination.\nEither specify the URL from the command-line or configure a remote repository using\n\n' +
          '    git remote add <name> <url>\n\nand then push using the remote name\n\n    git push <name>\n');
      }
      if (!cur) throw detached();
      const up = repo.upstream[cur];
      if (!up) throw noUpstream();
      remoteName = up.remote;
      spec = `${cur}:${up.branch}`;
    } else if (!spec) {
      if (!cur) throw detached();
      const up = repo.upstream[cur];
      if (up && up.remote === remoteName) spec = `${cur}:${up.branch}`;
      else if (setUp) spec = cur;
      else throw noUpstream();
    }
    const { url, server } = serverFor(ctx, remoteName);
    let [src, dst] = spec.includes(':') ? spec.split(':') : [spec, spec];
    if (src === 'HEAD') src = cur || 'HEAD';
    if (!dst) dst = src;
    if (del || src === '') {
      const target = del ? src : dst;
      if (!server.branches[target]) throw fail(`error: unable to delete '${target}': remote ref does not exist\nerror: failed to push some refs to '${url}'`);
      delete server.branches[target];
      delete repo.remoteRefs[`${remoteName}/${target}`];
      ctx.p(`To ${url}\n - [deleted]         ${target}`);
      return;
    }
    const r = resolveRev(repo, src);
    const localId = repo.branches[src] || (r && r.id);
    if (!localId) throw fail(`error: src refspec ${src} does not match any\nerror: failed to push some refs to '${url}'`);
    const remoteId = server.branches[dst];
    const doUpstream = () => {
      if (setUp && repo.branches[src]) {
        repo.upstream[src] = { remote: remoteName, branch: dst };
        ctx.p(`branch '${src}' set up to track '${remoteName}/${dst}'.`);
      }
    };
    if (remoteId === localId) { ctx.p('Everything up-to-date'); doUpstream(); return; }
    const ff = !remoteId || isAncestor(repo, remoteId, localId);
    if (!ff && !force) {
      const known = !!repo.commits[remoteId];
      ctx.p(`To ${url}`);
      ctx.p(` ! [rejected]        ${src} -> ${dst} (${known ? 'non-fast-forward' : 'fetch first'})`, 'err');
      ctx.p(`error: failed to push some refs to '${url}'`, 'err');
      ctx.p(known
        ? 'hint: Updates were rejected because the tip of your current branch is behind\nhint: its remote counterpart. If you want to integrate the remote changes,\nhint: use \'git pull\' before pushing again.\nhint: See the \'Note about fast-forwards\' in \'git push --help\' for details.'
        : 'hint: Updates were rejected because the remote contains work that you do not\nhint: have locally. This is usually caused by another repository pushing to\nhint: the same ref. If you want to integrate the remote changes, use\nhint: \'git pull\' before pushing again.\nhint: See the \'Note about fast-forwards\' in \'git push --help\' for details.', 'warn');
      throw failSilent();
    }
    const fresh = [...ancestors(repo, localId)].filter((id) => !server.commits[id]);
    fresh.forEach((id) => { server.commits[id] = repo.commits[id]; });
    server.branches[dst] = localId;
    repo.remoteRefs[`${remoteName}/${dst}`] = localId;
    const n = Math.max(1, fresh.length * 3);
    ctx.p(`Enumerating objects: ${n}, done.\nCounting objects: 100% (${n}/${n}), done.\n` +
      `Writing objects: 100% (${n}/${n}), ${n * 97} bytes | ${n * 97}.00 KiB/s, done.\n` +
      `Total ${n} (delta 0), reused 0 (delta 0), pack-reused 0`);
    if (!remoteId && /github\.com/.test(url)) {
      ctx.p(`remote:\nremote: Create a pull request for '${dst}' on GitHub by visiting:\n` +
        `remote:      ${url.replace(/\.git$/, '')}/pull/new/${dst}\nremote:`);
    }
    ctx.p(`To ${url}`);
    if (!remoteId) ctx.p(` * [new branch]      ${src} -> ${dst}`);
    else if (!ff) ctx.p(` + ${short(remoteId)}...${short(localId)} ${src} -> ${dst} (forced update)`);
    else ctx.p(`   ${short(remoteId)}..${short(localId)}  ${src} -> ${dst}`);
    doUpstream();
  };

  GIT.stash = (ctx, args) => {
    const { repo, dir } = ctx;
    const sub = args[0] && !args[0].startsWith('-') ? args[0] : 'push';
    const rest = args[0] === sub ? args.slice(1) : args;
    const idxArg = () => {
      const a = rest.find((x) => !x.startsWith('-'));
      if (!a) return 0;
      const m = /^(?:stash@\{)?(\d+)\}?$/.exec(a);
      if (!m) throw fail(`error: ${a} is not a valid reference`);
      return +m[1];
    };
    const getEntry = (n) => {
      if (!repo.stash.length) throw fail('No stash entries found.');
      if (!repo.stash[n]) throw fail(`error: stash@{${n}} is not a valid reference`);
      return repo.stash[n];
    };
    switch (sub) {
      case 'push': case 'save': {
        const head = headId(repo);
        if (!head) throw fail('You do not have the initial commit yet');
        requireNoMerge(repo);
        const H = treeOf(repo, head);
        const tracked = keys(H, repo.index);
        const changed = tracked.some((p) => H[p] !== repo.index[p] || (p in repo.index && repo.index[p] !== dir.files[p]));
        if (!changed) { ctx.p('No local changes to save'); return; }
        const mIdx = rest.indexOf('-m');
        const custom = mIdx >= 0 ? rest[mIdx + 1] : sub === 'save' ? rest.join(' ') : '';
        const bname = repo.head.type === 'branch' ? repo.head.name : '(no branch)';
        const entry = {
          base: head,
          message: custom ? `On ${bname}: ${custom}` : `WIP on ${bname}: ${short(head)} ${firstLine(repo.commits[head].message)}`,
          index: clone(repo.index), files: {},
        };
        tracked.forEach((p) => { entry.files[p] = p in dir.files ? dir.files[p] : null; });
        repo.stash.unshift(entry);
        repo.index = clone(H);
        tracked.forEach((p) => { if (p in H) dir.files[p] = H[p]; else delete dir.files[p]; });
        ctx.p(`Saved working directory and index state ${entry.message}`);
        return;
      }
      case 'list':
        repo.stash.forEach((s, i) => ctx.p(`stash@{${i}}: ${s.message}`));
        return;
      case 'show': {
        const s = getEntry(idxArg());
        const after = {};
        Object.entries(s.files).forEach(([p, v]) => { if (v !== null) after[p] = v; });
        const B = treeOf(repo, s.base);
        const full = { ...B };
        Object.keys(s.files).forEach((p) => { if (s.files[p] === null) delete full[p]; else full[p] = s.files[p]; });
        printDiffstat(ctx, B, full, false);
        return;
      }
      case 'pop': case 'apply': {
        const n = idxArg();
        const s = getEntry(n);
        requireNoMerge(repo);
        const B = treeOf(repo, s.base), H = treeOf(repo, headId(repo));
        const changed = keys(B, s.files).filter((p) => (s.files[p] === null ? undefined : s.files[p]) !== B[p] || s.index[p] !== B[p]);
        const dirty = changed.filter((p) => repo.index[p] !== H[p] || (p in repo.index && dir.files[p] !== repo.index[p]));
        if (dirty.length) {
          throw fail('error: Your local changes to the following files would be overwritten by merge:\n' +
            dirty.map((p) => '\t' + p).join('\n') + '\nPlease commit your changes or stash them before you merge.\nAborting');
        }
        changed.forEach((p) => {
          const v = s.files[p];
          if (v === null || v === undefined) { delete dir.files[p]; if (p in repo.index && !(p in s.index)) delete repo.index[p]; }
          else dir.files[p] = v;
          if (!(p in B) && p in s.index) repo.index[p] = s.index[p];
        });
        GIT.status(ctx, []);
        if (sub === 'pop') {
          repo.stash.splice(n, 1);
          ctx.p(`Dropped refs/stash@{${n}} (${randomHash()})`);
        }
        return;
      }
      case 'drop': {
        const n = idxArg();
        getEntry(n);
        repo.stash.splice(n, 1);
        ctx.p(`Dropped refs/stash@{${n}} (${randomHash()})`);
        return;
      }
      case 'clear':
        repo.stash = [];
        return;
      default:
        throw fail(`error: unknown subcommand: ${sub}`);
    }
  };

  GIT.config = (ctx, args) => {
    const { env } = ctx;
    const a = args.filter((x) => !['--global', '--local', '--system'].includes(x));
    if (a[0] === '--list' || a[0] === '-l') {
      Object.entries(env.config).forEach(([k, v]) => ctx.p(`${k}=${v}`));
      return;
    }
    if (a[0] === '--get') a.shift();
    if (a[0] === '--unset') { delete env.config[a[1]]; return; }
    const [k, ...v] = a;
    if (!k) throw fail('usage: git config [<options>]');
    if (!/^[\w-]+(\.[\w-]+)+$/.test(k)) throw fail(`error: key does not contain a section: ${k}`);
    if (!v.length) {
      if (k in env.config) ctx.p(env.config[k]);
      else throw failSilent();
      return;
    }
    env.config[k] = v.join(' ');
  };

  GIT.version = (ctx) => ctx.p(GIT_VERSION);

  GIT.help = (ctx) => {
    ctx.p(`usage: git [--version] [--help] <command> [<args>]

These are the git commands available in this practice lab:

start a working area
   clone      Clone a repository into a new directory
   init       Create an empty Git repository or reinitialize an existing one

work on the current change
   add        Add file contents to the index
   mv         Move or rename a file
   restore    Restore working tree files
   rm         Remove files from the working tree and from the index

examine the history and state
   diff       Show changes between commits, commit and working tree, etc
   log        Show commit logs
   show       Show a commit
   status     Show the working tree status

grow, mark and tweak your common history
   branch     List, create, or delete branches
   commit     Record changes to the repository
   merge      Join two or more development histories together
   reset      Reset current HEAD to the specified state
   stash      Stash the changes in a dirty working directory away
   switch     Switch branches
   checkout   Switch branches or restore working tree files

collaborate
   fetch      Download objects and refs from another repository
   pull       Fetch from and integrate with another repository or a local branch
   push       Update remote refs along with associated objects
   remote     Manage set of tracked repositories

settings
   config     Get and set repository or global options`);
  };

  const NEEDS_NO_REPO = new Set(['init', 'clone', 'config', 'help', 'version']);

  function runGit(ctx, args) {
    if (!args.length || args[0] === '--help' || args[0] === '-h') return GIT.help(ctx);
    if (args[0] === '--version' || args[0] === '-v') return GIT.version(ctx);
    const [sub, ...rest] = args;
    if (NOT_IN_LAB.includes(sub)) {
      ctx.tip(`\`git ${sub}\` is a real git command, but it isn't available in this practice lab.`);
      throw failSilent();
    }
    const fn = Object.prototype.hasOwnProperty.call(GIT, sub) && GIT[sub];
    if (!fn) {
      const best = GIT_COMMANDS.map((c) => [c, levenshtein(sub, c)]).sort((x, y) => x[1] - y[1])[0];
      let msg = `git: '${sub}' is not a git command. See 'git --help'.`;
      if (best && best[1] <= 2) msg += `\n\nThe most similar command is\n\t${best[0]}`;
      throw fail(msg);
    }
    if (rest.includes('--help') || rest.includes('-h')) {
      ctx.p(`Help pages are not available offline in this lab. Try the command, or see https://git-scm.com/docs/git-${sub}`, 'muted');
      return;
    }
    if (!NEEDS_NO_REPO.has(sub) && !ctx.repo) {
      ctx.p('fatal: not a git repository (or any of the parent directories): .git', 'err');
      if (ctx.env.cwd === '') ctx.tip('You are in your home folder (~). Use `ls` to see your folders and `cd <folder>` to enter a project.');
      else ctx.tip('This folder is not a repository yet. Run `git init` to create one.');
      throw failSilent();
    }
    return fn(ctx, rest);
  }

  // ───────────────────────── shell ─────────────────────────

  function tokenize(src) {
    const toks = [];
    let cur = null, glob = false, i = 0;
    const push = () => { if (cur !== null) { toks.push({ v: cur, glob }); cur = null; glob = false; } };
    while (i < src.length) {
      const ch = src[i];
      if (ch === ' ' || ch === '\t') { push(); i++; continue; }
      if (ch === '"' || ch === "'") {
        const q = ch;
        i++;
        cur = cur === null ? '' : cur;
        while (i < src.length && src[i] !== q) {
          if (q === '"' && src[i] === '\\' && i + 1 < src.length && '"\\$`'.includes(src[i + 1])) { cur += src[i + 1]; i += 2; continue; }
          cur += src[i++];
        }
        if (i >= src.length) throw fail(`bash: unexpected EOF while looking for matching \`${q}'`);
        i++;
        continue;
      }
      if (src.startsWith('&&', i)) { push(); toks.push({ op: '&&' }); i += 2; continue; }
      if (src.startsWith('||', i)) { push(); toks.push({ op: '||' }); i += 2; continue; }
      if (src.startsWith('>>', i)) { push(); toks.push({ op: '>>' }); i += 2; continue; }
      if (ch === '>' || ch === ';' || ch === '|' || ch === '<') { push(); toks.push({ op: ch }); i++; continue; }
      if (ch === '\\' && i + 1 < src.length) { cur = (cur === null ? '' : cur) + src[i + 1]; i += 2; continue; }
      if (ch === '#' && cur === null) break;
      if (ch === '*' || ch === '?') glob = true;
      cur = (cur === null ? '' : cur) + ch;
      i++;
    }
    push();
    return toks;
  }

  function parseCommands(toks) {
    const cmds = [];
    let cur = { argv: [], redirect: null, sep: null };
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (t.op === '&&' || t.op === ';' || t.op === '||') {
        if (!cur.argv.length) throw fail(`bash: syntax error near unexpected token \`${t.op}'`);
        cur.sep = t.op;
        cmds.push(cur);
        cur = { argv: [], redirect: null, sep: null };
      } else if (t.op === '>' || t.op === '>>') {
        const f = toks[i + 1];
        if (!f || f.op) throw fail("bash: syntax error near unexpected token `newline'");
        cur.redirect = { op: t.op, file: f.v };
        i++;
      } else if (t.op === '|' || t.op === '<') {
        throw fail(`lab: pipes and input redirection (${t.op}) are not supported in this practice terminal.`);
      } else cur.argv.push(t);
    }
    if (cur.argv.length) cmds.push(cur);
    return cmds;
  }

  function dirEntries(env) {
    const dir = env.dirs[env.cwd];
    if (env.cwd === '') return [...Object.keys(env.dirs).filter(Boolean), ...Object.keys(dir.files)];
    return Object.keys(dir.files);
  }

  function expandGlobs(env, argv) {
    const out = [];
    for (const t of argv) {
      if (!t.glob) { out.push(t.v); continue; }
      const re = globToRegex(t.v);
      const hits = dirEntries(env).filter((p) => re.test(p)).sort();
      if (hits.length) out.push(...hits); else out.push(t.v);
    }
    return out;
  }

  function listing(dir, prefix) {
    const set = new Set();
    for (const p of [...Object.keys(dir.files), ...dir.folders.map((f) => f + '/')]) {
      if (!p.startsWith(prefix)) continue;
      const rest = p.slice(prefix.length);
      if (!rest) continue;
      set.add(rest.includes('/') ? rest.split('/')[0] + '/' : rest);
    }
    return [...set].sort();
  }

  function checkLocalPath(p) {
    if (p.startsWith('/') || p.startsWith('~') || p.startsWith('../')) {
      throw fail('lab: this practice terminal works with files inside the current folder only.');
    }
    return normPath(p);
  }

  function writeFile(ctx, path, content, append) {
    const { env } = ctx;
    const p = checkLocalPath(path);
    if (env.cwd === '' && env.dirs[p]) throw fail(`bash: ${path}: Is a directory`);
    if (ctx.dir.folders.includes(p)) throw fail(`bash: ${path}: Is a directory`);
    const files = ctx.dir.files;
    files[p] = append ? (files[p] || '') + content : content;
  }

  const SHELL = {
    help(ctx) {
      ctx.p(`Shell commands available in this lab:
  ls [-a]            list files            cd <folder>      change folder (cd .. / cd ~)
  pwd                print current folder  mkdir <name>     create a folder
  cat <file>         show a file           touch <file>     create an empty file
  echo "text" > f    write text to a file  echo "x" >> f    append a line to a file
  nano <file>        edit a file in the built-in editor (also: vim, code)
  rm <file>          delete a file         rm -rf <folder>  delete a folder
  clear              clear the screen      help             show this help

Git: type ${'`git help`'} to see the supported git commands.
Keys: ↑/↓ = command history, Tab = autocomplete.`);
    },
    clear(ctx) { ctx.actions.push({ type: 'clear' }); },
    pwd(ctx) { ctx.p(pwdOf(ctx.env)); },
    whoami(ctx) { ctx.p('student'); },
    ls(ctx, args) {
      const { env } = ctx;
      const showAll = args.some((a) => /^-[a-zA-Z]*a/.test(a));
      const target = args.find((a) => !a.startsWith('-'));
      let dir = ctx.dir, prefix = '', names;
      if (target) {
        const t = normPath(target.replace(/^~\//, ''));
        if (env.cwd === '' && env.dirs[t]) dir = env.dirs[t];
        else if (t === '..' && env.cwd) dir = env.dirs[''];
        else if (t in dir.files) { ctx.p(t); return; }
        else if (dir.folders.includes(t) || Object.keys(dir.files).some((p) => p.startsWith(t + '/'))) prefix = t + '/';
        else throw fail(`ls: cannot access '${target}': No such file or directory`);
      }
      if (dir === env.dirs['']) {
        names = [...Object.keys(env.dirs).filter(Boolean).map((d) => d + '/'), ...listing(dir, '')].sort();
      } else names = listing(dir, prefix);
      if (!showAll) names = names.filter((n) => !n.startsWith('.'));
      else if (dir.repo && !prefix) names.unshift('.git/');
      if (showAll) names.unshift('./', '../');
      if (!names.length) return;
      const segs = [];
      names.forEach((n, i) => {
        if (i) segs.push({ t: '  ' });
        segs.push({ t: n.replace(/\/$/, ''), c: n.endsWith('/') ? 'dir' : undefined });
      });
      ctx.seg(segs);
    },
    cd(ctx, args) {
      const { env } = ctx;
      const raw = args[0];
      if (!raw || raw === '~' || raw === '~/' || raw === HOME || raw === HOME + '/') { env.cwd = ''; return; }
      if (raw === '.' || raw === './') return;
      if (raw === '..' || raw === '../') { env.cwd = ''; return; }
      let t = raw, absolute = false;
      if (t.startsWith('~/')) { t = t.slice(2); absolute = true; }
      else if (t.startsWith(HOME + '/')) { t = t.slice(HOME.length + 1); absolute = true; }
      else if (t.startsWith('../') && env.cwd) { t = t.slice(3); absolute = true; }
      t = normPath(t);
      if ((absolute || env.cwd === '') && env.dirs[t] && t !== '') { env.cwd = t; return; }
      if (env.cwd !== '' && (ctx.dir.folders.includes(t) || Object.keys(ctx.dir.files).some((p) => p.startsWith(t + '/')))) {
        ctx.tip(`'${t}' is a sub-folder. This lab keeps you at the project's top level — use paths like ${t}/file.txt instead.`);
        throw failSilent();
      }
      if ((env.cwd === '' && t in ctx.dir.files) || (env.cwd !== '' && t in ctx.dir.files)) throw fail(`bash: cd: ${raw}: Not a directory`);
      throw fail(`bash: cd: ${raw}: No such file or directory`);
    },
    mkdir(ctx, args) {
      const { env } = ctx;
      const names = args.filter((a) => !a.startsWith('-'));
      if (!names.length) throw fail('mkdir: missing operand');
      for (const n of names) {
        const p = checkLocalPath(n);
        if (env.cwd === '') {
          if (env.dirs[p] || p in ctx.dir.files) throw fail(`mkdir: cannot create directory '${n}': File exists`);
          if (p.includes('/')) throw fail('lab: create one folder at a time in your home folder.');
          env.dirs[p] = newDir();
        } else {
          if (ctx.dir.folders.includes(p) || p in ctx.dir.files) throw fail(`mkdir: cannot create directory '${n}': File exists`);
          ctx.dir.folders.push(p);
        }
      }
    },
    touch(ctx, args) {
      const names = args.filter((a) => !a.startsWith('-'));
      if (!names.length) throw fail('touch: missing file operand');
      for (const n of names) {
        const p = checkLocalPath(n);
        if (ctx.env.cwd === '' && ctx.env.dirs[p]) continue;
        if (!(p in ctx.dir.files)) ctx.dir.files[p] = '';
      }
    },
    echo(ctx, args) {
      const noNl = args[0] === '-n';
      const words = args.filter((a, i) => !(i === 0 && (a === '-n' || a === '-e')));
      if (noNl) ctx.out.noNewline = true;
      ctx.p(words.join(' '));
    },
    cat(ctx, args) {
      const names = args.filter((a) => !a.startsWith('-'));
      if (!names.length) { ctx.tip('cat needs a file name, e.g. `cat README.md`'); throw failSilent(); }
      let bad = false;
      for (const n of names) {
        const p = normPath(n);
        if (ctx.env.cwd === '' && ctx.env.dirs[p]) { ctx.p(`cat: ${n}: Is a directory`, 'err'); bad = true; continue; }
        if (!(p in ctx.dir.files)) { ctx.p(`cat: ${n}: No such file or directory`, 'err'); bad = true; continue; }
        splitLines(ctx.dir.files[p]).forEach((l) => {
          const marker = /^(<<<<<<<|=======|>>>>>>>)/.test(l);
          ctx.p(l, marker ? 'warn' : undefined);
        });
      }
      if (bad) throw failSilent();
    },
    rm(ctx, args) {
      const { env } = ctx;
      const flags = args.filter((a) => a.startsWith('-')).join('');
      const recursive = /r|R/.test(flags), force = /f/.test(flags);
      const names = args.filter((a) => !a.startsWith('-'));
      if (!names.length) throw fail('rm: missing operand');
      for (const n of names) {
        const p = normPath(n);
        if (p === '.git' && ctx.dir.repo) {
          if (!recursive) throw fail(`rm: cannot remove '${n}': Is a directory`);
          ctx.dir.repo = null;
          continue;
        }
        if (env.cwd === '' && env.dirs[p] && p) {
          if (!recursive) throw fail(`rm: cannot remove '${n}': Is a directory`);
          delete env.dirs[p];
          continue;
        }
        const under = Object.keys(ctx.dir.files).filter((f) => f.startsWith(p + '/'));
        if (ctx.dir.folders.includes(p) || under.length) {
          if (!recursive) throw fail(`rm: cannot remove '${n}': Is a directory`);
          under.forEach((f) => delete ctx.dir.files[f]);
          ctx.dir.folders = ctx.dir.folders.filter((f) => f !== p && !f.startsWith(p + '/'));
          continue;
        }
        if (p in ctx.dir.files) { delete ctx.dir.files[p]; continue; }
        if (!force) throw fail(`rm: cannot remove '${n}': No such file or directory`);
      }
    },
    edit(ctx, args) {
      const n = args.find((a) => !a.startsWith('-'));
      if (!n) { ctx.tip('Give the editor a file name, e.g. `nano README.md`'); throw failSilent(); }
      const p = checkLocalPath(n);
      if (ctx.env.cwd === '' && ctx.env.dirs[p]) throw fail(`lab: ${n} is a folder`);
      ctx.actions.push({ type: 'edit', dir: ctx.env.cwd, path: p });
      ctx.p(`Opening ${p} in the editor…`, 'muted');
    },
  };
  ['nano', 'vim', 'vi', 'code', 'notepad'].forEach((a) => { SHELL[a] = SHELL.edit; });
  SHELL.dir = SHELL.ls;
  SHELL.cls = SHELL.clear;
  SHELL.type = SHELL.cat;

  function runOne(ctx, cmd) {
    const argv = expandGlobs(ctx.env, cmd.argv);
    const [name, ...args] = argv;
    if (cmd.redirect) {
      const captured = [];
      const sub = makeCtx(ctx.env, captured, ctx.actions);
      try {
        execute(sub, name, args);
      } finally {
        // like bash, the file is written even when the command fails
        const text = captured.map((segs) => segs.map((s) => s.t).join('')).join('\n');
        const content = captured.length ? text + (captured.noNewline ? '' : '\n') : '';
        writeFile(ctx, cmd.redirect.file, content, cmd.redirect.op === '>>');
      }
      return;
    }
    execute(ctx, name, args);
  }

  function execute(ctx, name, args) {
    if (name === 'git') return runGit(ctx, args);
    if (Object.prototype.hasOwnProperty.call(SHELL, name)) return SHELL[name](ctx, args);
    if (GIT_COMMANDS.includes(name)) {
      ctx.p(`bash: ${name}: command not found`, 'err');
      ctx.tip(`Did you mean \`git ${[name, ...args].join(' ')}\`? Git commands always start with "git".`);
      throw failSilent();
    }
    if (['gti', 'got', 'gi', 'igt', 'gut', 'gitt', 'Git', 'GIT'].includes(name)) {
      ctx.p(`bash: ${name}: command not found`, 'err');
      ctx.tip('Typo? The command is `git` (all lowercase).');
      throw failSilent();
    }
    throw fail(`bash: ${name}: command not found`);
  }

  function run(env, input) {
    const out = [];
    const actions = [];
    const ctx = makeCtx(env, out, actions);
    let cmds;
    try {
      cmds = parseCommands(tokenize(input));
    } catch (e) {
      if (!e.gitFail) throw e;
      ctx.p(e.message, 'err');
      return { lines: out, actions, ok: false };
    }
    let ok = true;
    for (let i = 0; i < cmds.length; i++) {
      const prevSep = i ? cmds[i - 1].sep : null;
      if (prevSep === '&&' && !ok) continue;
      if (prevSep === '||' && ok) continue;
      try {
        runOne(ctx, cmds[i]);
        ok = true;
      } catch (e) {
        ok = false;
        if (e.gitFail) { if (!e.silent) ctx.p(e.message, 'err'); }
        else { ctx.p('lab: internal error — ' + e.message, 'err'); if (typeof console !== 'undefined') console.error(e); }
      }
    }
    return { lines: out, actions, ok };
  }

  // ───────────────────────── tab completion ─────────────────────────

  function complete(env, line) {
    const m = /(\S*)$/.exec(line);
    const word = m[1];
    const before = line.slice(0, line.length - word.length);
    const parts = before.trim().split(/\s+/).filter(Boolean);
    let cands;
    const dir = env.dirs[env.cwd];
    if (!parts.length) cands = ['git', ...Object.keys(SHELL)];
    else if (parts[0] === 'git' && parts.length === 1) cands = GIT_COMMANDS;
    else if (parts[0] === 'git' && ['checkout', 'switch', 'merge', 'branch', 'rebase', 'log', 'diff', 'reset', 'push', 'pull', 'fetch', 'show'].includes(parts[1]) && dir.repo) {
      const repo = dir.repo;
      cands = [...Object.keys(repo.branches), ...Object.keys(repo.remoteRefs), ...Object.keys(repo.remotes), ...Object.keys(dir.files)];
      if (['checkout', 'switch'].includes(parts[1])) cands.push(...Object.keys(repo.remoteRefs).map((r) => r.split('/').slice(1).join('/')));
    } else if (parts[0] === 'cd') cands = Object.keys(env.dirs).filter(Boolean);
    else cands = env.cwd === '' ? [...Object.keys(env.dirs).filter(Boolean), ...Object.keys(dir.files)] : Object.keys(dir.files);
    const hits = [...new Set(cands)].filter((c) => c.startsWith(word)).sort();
    if (!hits.length) return { line, options: [] };
    if (hits.length === 1) return { line: before + hits[0] + ' ', options: [] };
    let pre = hits[0];
    for (const h of hits) while (!h.startsWith(pre)) pre = pre.slice(0, -1);
    return { line: before + pre, options: hits };
  }

  // ───────────────────────── server / scenario helpers ─────────────────────────

  function serverCreate(env, url, opts) {
    opts = opts || {};
    const key = canonUrl(url);
    const repo = newRepo(opts.branch || 'main');
    env.server[key] = repo;
    for (const c of opts.commits || []) serverCommit(env, key, c.branch || repo.head.name, c.files, c.message, c.author);
    return key;
  }

  // Simulates another developer pushing to the shared repository.
  function serverCommit(env, url, branch, changes, message, by) {
    const repo = env.server[canonUrl(url)];
    const parent = repo.branches[branch] || repo.branches[repo.head.name];
    const tree = clone(treeOf(repo, parent));
    Object.entries(changes || {}).forEach(([p, v]) => { if (v === null) delete tree[p]; else tree[p] = v; });
    const c = makeCommit(env, repo, tree, [parent], message, by || 'Maya Cohen <maya@team.dev>');
    repo.branches[branch] = c.id;
    return c;
  }

  function prompt(env) {
    const dir = env.dirs[env.cwd];
    let branch = null;
    if (dir && dir.repo) {
      const r = dir.repo;
      branch = r.head.type === 'branch' ? r.head.name : short(r.head.id) + '...';
      if (r.merge) branch += '|MERGING';
    }
    return { path: env.cwd ? `~/${env.cwd}` : '~', branch };
  }

  const API = {
    createEnv, run, complete, prompt, computeStatus, headId, treeOf, resolveRev, isAncestor, ancestors,
    aheadBehind, serverCreate, serverCommit, canonUrl, merge3, diffLines, short, firstLine, HOME,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.GitLab = API;
})(typeof window !== 'undefined' ? window : globalThis);
