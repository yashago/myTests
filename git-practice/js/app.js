/* UI glue: terminal, lesson guide, state panels, editor and persistence. */
(function () {
  'use strict';
  const G = window.GitLab, L = window.GitLessons, GG = window.GitGraph;
  const esc = GG.esc;
  const STORE = 'git-lab-state-v1';
  const $ = (id) => document.getElementById(id);

  const out = $('term-out'), input = $('term-in'), body = $('term-body');

  let state = null;           // { mode, lesson, step, mem, done, env, note, hintShown }
  const history = [];
  let hIdx = 0;

  // ───────── persistence ─────────
  function save() {
    try { localStorage.setItem(STORE, JSON.stringify({ ...state, history: history.slice(-100) })); } catch (e) { /* storage unavailable */ }
  }
  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(STORE));
      if (s && s.env && s.mode) { history.push(...(s.history || [])); delete s.history; return s; }
    } catch (e) { /* ignore */ }
    return null;
  }

  // ───────── terminal output ─────────
  function line(segs, cls) {
    const div = document.createElement('div');
    if (cls) div.className = cls;
    segs.forEach((s) => {
      const span = document.createElement('span');
      if (s.c) span.className = 'c-' + s.c;
      span.textContent = s.t;
      div.appendChild(span);
    });
    out.appendChild(div);
  }
  const print = (text, cls) => String(text).split('\n').forEach((t) => line([{ t }], cls ? 'c-' + cls : ''));

  function promptHtml() {
    const p = G.prompt(state.env);
    let html = `<span class="p-user">student@git-lab</span>:<span class="p-path">${esc(p.path)}</span>`;
    if (p.branch) {
      const merging = p.branch.endsWith('|MERGING');
      html += ` <span class="${merging ? 'p-merge' : 'p-branch'}">(${esc(p.branch)})</span>`;
    }
    return html + '$ ';
  }

  function echoCommand(cmd) {
    const div = document.createElement('div');
    div.innerHTML = promptHtml();
    const span = document.createElement('span');
    span.textContent = cmd;
    div.appendChild(span);
    out.appendChild(div);
  }

  function updatePrompt() {
    $('prompt').innerHTML = promptHtml();
    const p = G.prompt(state.env);
    $('term-title').textContent = `student@git-lab: ${p.path}`;
  }

  const scrollDown = () => { body.scrollTop = body.scrollHeight; };

  function welcome() {
    out.innerHTML = '';
    if (state.mode === 'free') {
      print('Free play — a safe sandbox. Nothing you type here touches your real computer.', 'welcome');
    } else {
      const l = L.LESSONS[state.lesson];
      print(`Lesson ${state.lesson + 1}: ${l.title}`, 'welcome');
      print('Follow the steps on the left. Type commands below and press Enter.', 'welcome');
    }
    print('Type `help` for shell commands or `git help` for git commands.', 'welcome');
    print('');
  }

  // ───────── command handling ─────────
  function submit(cmd) {
    echoCommand(cmd);
    if (cmd.trim()) {
      if (history[history.length - 1] !== cmd) history.push(cmd);
      hIdx = history.length;
      const res = G.run(state.env, cmd);
      res.lines.forEach((segs) => line(segs));
      for (const a of res.actions) {
        if (a.type === 'clear') out.innerHTML = '';
        if (a.type === 'edit') openEditor(a.dir, a.path);
      }
      afterChange(cmd, res.ok);
    }
    render();
    scrollDown();
  }

  function afterChange(last, ok) {
    if (state.mode !== 'lesson') { save(); return; }
    const lesson = L.LESSONS[state.lesson];
    let ctx = { last, ok, mem: state.mem };
    while (state.step < lesson.steps.length) {
      let passed = false;
      try { passed = !!lesson.steps[state.step].check(state.env, ctx); } catch (e) { console.error(e); }
      if (!passed) break;
      state.step++;
      state.hintShown = false;
      // later steps must be earned by their own command, not the one just typed
      ctx = { last: '', ok: false, mem: state.mem };
      enterStep();
    }
    if (state.step >= lesson.steps.length) state.done[lesson.id] = true;
    save();
  }

  function enterStep() {
    const lesson = L.LESSONS[state.lesson];
    const step = lesson.steps[state.step];
    state.note = null;
    if (step && step.onEnter) {
      const note = step.onEnter(state.env, state.mem);
      if (note) { state.note = note; print(note, 'event'); }
    }
  }

  // ───────── modes & lessons ─────────
  function startLesson(i) {
    state = { ...state, mode: 'lesson', lesson: i, step: 0, mem: {}, note: null, hintShown: false, env: G.createEnv() };
    L.LESSONS[i].setup(state.env);
    welcome();
    enterStep();
    save();
    render();
    input.focus();
  }

  function startFree() {
    state = { ...state, mode: 'free', step: 0, mem: {}, note: null, env: G.createEnv() };
    L.FREE_PLAY.setup(state.env);
    welcome();
    save();
    render();
    input.focus();
  }

  // ───────── rendering ─────────
  function render() {
    document.querySelectorAll('.mode-btn').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === state.mode)));
    renderGuide();
    renderState();
    updatePrompt();
  }

  function renderGuide() {
    const g = $('guide');
    if (state.mode === 'free') { g.innerHTML = freeHtml(); return; }
    const lesson = L.LESSONS[state.lesson];
    const total = lesson.steps.length;
    const list = L.LESSONS.map((l, i) => `<li><button type="button" data-lesson="${i}" class="${state.done[l.id] ? 'done' : ''}"` +
      ` aria-current="${i === state.lesson}"><span class="num">${state.done[l.id] ? '✓' : i + 1}</span>` +
      `<span class="t">${esc(l.title)}</span><span class="s">${esc(l.summary)}</span></button></li>`).join('');
    const steps = lesson.steps.map((s, i) => {
      const cls = i < state.step ? 'done' : i === state.step ? 'current' : 'todo';
      let extra = '';
      if (i === state.step) {
        extra = state.hintShown
          ? `<button type="button" class="hint" data-hint="${esc(s.hint)}">${esc(s.hint)}<small>Click to paste into the terminal</small></button>`
          : '<button type="button" class="hint-btn" data-show-hint>Show hint</button>';
      }
      return `<li class="step ${cls}" data-n="${i + 1}">${s.text}${extra}</li>`;
    }).join('');
    const finished = state.step >= total;
    const next = L.LESSONS[state.lesson + 1];
    g.innerHTML = `<ul class="lesson-list">${list}</ul>
      <div class="lesson-head">
        <h2>${esc(lesson.title)}</h2>
        <p>${lesson.intro}</p>
        <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${Math.min(state.step, total)}">
          <span style="width:${(Math.min(state.step, total) / total) * 100}%"></span></div>
      </div>
      ${state.note && !finished ? `<div class="note">${esc(state.note)}</div>` : ''}
      <ol class="steps">${steps}</ol>
      ${finished ? `<div class="complete"><h3>🎉 Lesson complete!</h3><p>Keep experimenting in the terminal, or move on.</p>
        ${next ? `<button type="button" class="accent-btn" data-lesson="${state.lesson + 1}">Next: ${esc(next.title)} →</button>`
          : '<button type="button" class="accent-btn" data-mode="free">Try free play →</button>'}</div>` : ''}`;
  }

  const CHEATS = [
    ['git status', 'what changed?'], ['git add <file>', 'stage a file'], ['git add .', 'stage everything'],
    ['git commit -m "msg"', 'save a snapshot'], ['git log --oneline', 'history'], ['git diff', 'unstaged changes'],
    ['git branch', 'list branches'], ['git checkout -b <name>', 'new branch'], ['git checkout <name>', 'switch branch'],
    ['git switch <name>', 'switch (newer)'], ['git merge <branch>', 'merge into current'], ['git clone <url>', 'copy a repo'],
    ['git fetch', 'download, no merge'], ['git pull', 'fetch + merge'], ['git push', 'upload commits'],
    ['git push -u origin <b>', 'first push of a branch'], ['git restore <file>', 'discard changes'],
    ['git restore --staged <f>', 'unstage'], ['git stash', 'shelve changes'], ['git reset --soft HEAD~1', 'undo commit'],
  ];

  function freeHtml() {
    return `<div class="free">
      <h2 style="margin:0 0 6px;font-size:18px">Free play</h2>
      <p style="margin:0;color:var(--ink-soft)">${L.FREE_PLAY.intro}</p>
      <h3>Ideas to try</h3>
      <ol class="ideas">${L.FREE_PLAY.ideas.map((i) => `<li><code>${esc(i)}</code></li>`).join('')}</ol>
      <h3>Cheat sheet</h3>
      <div class="cheats">${CHEATS.map(([c, d]) => `<code>${esc(c)}</code><span>${esc(d)}</span>`).join('')}</div>
    </div>`;
  }

  function badge(kind, label) { return `<span class="badge b-${kind}">${esc(label || kind)}</span>`; }

  function renderState() {
    const env = state.env;
    const dir = env.dirs[env.cwd];
    const repo = dir.repo;
    $('cwd-label').textContent = env.cwd ? `~/${env.cwd}` : '~';

    // working directory
    let files = '';
    if (env.cwd === '') {
      const folders = Object.keys(env.dirs).filter(Boolean).sort();
      const items = folders.map((f) => `<li><span>${badge('folder', env.dirs[f].repo ? 'repo' : 'folder')}<span class="name">${esc(f)}/</span></span></li>`);
      Object.keys(dir.files).sort().forEach((f) => items.push(fileItem('', f, null)));
      files = items.length ? `<ul class="file-list">${items.join('')}</ul>` : '<p class="empty">Your home folder is empty.</p>';
    } else {
      const st = repo ? G.computeStatus(dir) : null;
      const names = Object.keys(dir.files).sort();
      const deleted = st ? st.unstaged.filter((e) => e.k === 'deleted').map((e) => e.p) : [];
      const items = [...names, ...deleted.filter((p) => !names.includes(p))].sort().map((f) => fileItem(env.cwd, f, st));
      if (repo) items.unshift(`<li><span>${badge('ignored', 'hidden')}<span class="name">.git/</span></span></li>`);
      files = items.length ? `<ul class="file-list">${items.join('')}</ul>` : '<p class="empty">This folder is empty.</p>';
      if (!repo) files = '<p class="empty" style="margin-bottom:6px">Not a git repository (no .git folder).</p>' + files;
    }
    $('files').innerHTML = files;

    // staging area
    if (!repo) $('staging').innerHTML = '<p class="empty">No repository here.</p>';
    else {
      const st = G.computeStatus(dir);
      const rows = st.staged.map((e) => `<li><span>${badge(e.k === 'new file' ? 'new' : e.k === 'deleted' ? 'deleted' : 'staged', e.k)}<span class="name">${esc(e.p)}</span></span></li>`);
      st.conflicts.forEach((p) => rows.push(`<li><span>${badge('conflict')}<span class="name">${esc(p)}</span></span></li>`));
      $('staging').innerHTML = rows.length ? `<ul class="file-list">${rows.join('')}</ul>` : '<p class="empty">Nothing staged. Use <code>git add</code>.</p>';
    }

    // local repository
    if (!repo) {
      $('local-sub').textContent = '';
      $('local-graph').innerHTML = '<p class="empty">Run <code>git init</code> or <code>git clone</code> to create one.</p>';
    } else {
      $('local-sub').textContent = repo.head.type === 'branch' ? `HEAD → ${repo.head.name}` : `HEAD detached at ${G.short(repo.head.id)}`;
      const banner = repo.merge ? `<div class="banner">Merge in progress${repo.merge.conflicts.length ? ` — ${repo.merge.conflicts.length} conflict(s) to resolve` : ' — run git commit to finish'}</div>` : '';
      $('local-graph').innerHTML = banner + GG.render(repo.commits, GG.localRefs(repo), { empty: 'No commits yet' });
    }

    // remote
    let url = repo && repo.remotes.origin ? repo.remotes.origin.url : null;
    if (!url) url = Object.keys(env.server)[0] || null;
    const server = url && env.server[url];
    $('remote-sub').textContent = repo && repo.remotes.origin ? '(origin)' : url ? '(GitHub)' : '';
    if (!server) $('remote-graph').innerHTML = '<p class="empty">No remote repository in this exercise.</p>';
    else {
      $('remote-graph').innerHTML = `<p class="remote-url">${esc(url)}</p>` +
        GG.render(server.commits, GG.serverRefs(server), { empty: 'Empty repository — push to it!' });
    }
    $('teammate-btn').hidden = state.mode !== 'free' || !server;
  }

  function fileItem(dirKey, f, st) {
    let b = '';
    if (st) {
      if (st.conflicts.includes(f)) b = badge('conflict');
      else if (st.untracked.includes(f)) b = badge('untracked');
      else if (st.ignored.includes(f)) b = badge('ignored');
      else if (st.unstaged.some((e) => e.p === f && e.k === 'deleted')) b = badge('deleted');
      else if (st.unstaged.some((e) => e.p === f)) b = badge('modified');
      else if (st.staged.some((e) => e.p === f)) b = badge('staged');
      else b = badge('clean', '✓ committed');
    }
    const deleted = !(f in state.env.dirs[dirKey].files);
    if (deleted) return `<li><span>${b}<span class="name" style="text-decoration:line-through">${esc(f)}</span></span></li>`;
    return `<li><button type="button" data-edit="${esc(f)}" title="Click to edit">${b}<span class="name">${esc(f)}</span></button></li>`;
  }

  // ───────── editor ─────────
  const dlg = $('editor'), txt = $('editor-text');
  let editing = null;

  function openEditor(dirKey, path) {
    const files = state.env.dirs[dirKey].files;
    editing = { dirKey, path, existed: path in files };
    $('editor-title').textContent = path;
    txt.value = files[path] || '';
    dlg.showModal();
    txt.focus();
  }

  dlg.addEventListener('close', () => {
    if (!editing) return;
    const { dirKey, path } = editing;
    const dir = state.env.dirs[dirKey];
    if (dlg.returnValue === 'save' && dir) {
      let v = txt.value.replace(/\r\n/g, '\n');
      if (v && !v.endsWith('\n')) v += '\n';
      dir.files[path] = v;
      print(`Saved ${path}`, 'muted');
      afterChange('', true);
    }
    editing = null;
    dlg.returnValue = '';
    render();
    scrollDown();
    input.focus();
  });
  txt.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); dlg.close('save'); }
    if (e.key === 'Tab') {
      e.preventDefault();
      const s = txt.selectionStart;
      txt.setRangeText('    ', s, txt.selectionEnd, 'end');
    }
  });

  // ───────── events ─────────
  $('term-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const cmd = input.value;
    input.value = '';
    submit(cmd);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (hIdx > 0) { hIdx--; input.value = history[hIdx]; }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (hIdx < history.length - 1) { hIdx++; input.value = history[hIdx]; } else { hIdx = history.length; input.value = ''; }
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const r = G.complete(state.env, input.value);
      if (r.options.length > 1) { echoCommand(input.value); print(r.options.join('  ')); scrollDown(); }
      input.value = r.line;
    } else if (e.key.toLowerCase() === 'l' && e.ctrlKey) {
      e.preventDefault();
      out.innerHTML = '';
    } else if (e.key.toLowerCase() === 'c' && e.ctrlKey && !window.getSelection().toString()) {
      e.preventDefault();
      echoCommand(input.value + '^C');
      input.value = '';
      scrollDown();
    }
  });

  body.addEventListener('mouseup', () => { if (!window.getSelection().toString()) input.focus(); });

  document.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.mode) {
      if (t.dataset.mode === state.mode) return;
      if (t.dataset.mode === 'free') startFree(); else startLesson(state.lesson || 0);
    } else if (t.dataset.lesson !== undefined) {
      startLesson(+t.dataset.lesson);
    } else if (t.hasAttribute('data-show-hint')) {
      state.hintShown = true;
      renderGuide();
    } else if (t.dataset.hint) {
      input.value = t.dataset.hint;
      input.focus();
    } else if (t.dataset.edit) {
      openEditor(state.env.cwd, t.dataset.edit);
    }
  });

  $('reset-btn').addEventListener('click', () => {
    if (!confirm('Restart from the beginning? Your work in this exercise will be lost.')) return;
    if (state.mode === 'free') startFree(); else startLesson(state.lesson);
  });

  $('teammate-btn').addEventListener('click', () => {
    const note = L.teammatePush(state.env);
    print(note, 'event');
    save();
    render();
    scrollDown();
  });

  // ───────── boot ─────────
  const saved = load();
  if (saved) {
    state = saved;
    hIdx = history.length;
    welcome();
    print('(Welcome back — your previous session was restored. Use ↺ Restart to begin again.)', 'muted');
    if (state.note) print(state.note, 'event');
    render();
  } else {
    state = { done: {} };
    startLesson(0);
  }
  input.focus();
})();
