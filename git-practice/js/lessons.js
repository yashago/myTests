/*
 * Guided lessons. Each step has a `check(env, ctx)` that runs after every command;
 * when it returns true the step is marked done and the next one starts.
 *   ctx = { last: the command line just typed, ok: whether it succeeded, mem: per-lesson scratch data }
 * `onEnter` may change the world (e.g. a teammate pushes) and returns a note to show the student.
 */
(function (root) {
  'use strict';
  const G = root.GitLab;

  const TEAM_URL = 'https://github.com/git-lab/team-project.git';

  const dirOf = (env, name) => env.dirs[name];
  const repoOf = (env, name) => (env.dirs[name] ? env.dirs[name].repo : null);
  const ran = (ctx, re) => ctx.ok && re.test(ctx.last);
  const head = (repo) => repo && G.headId(repo);
  const headTree = (repo) => (repo ? G.treeOf(repo, head(repo)) : {});
  const commitCount = (repo) => (repo && head(repo) ? G.ancestors(repo, head(repo)).size : 0);
  const clean = (env, name) => {
    const d = dirOf(env, name);
    if (!d || !d.repo) return false;
    const s = G.computeStatus(d);
    return !s.staged.length && !s.unstaged.length && !s.untracked.length && !s.conflicts.length;
  };
  const onBranch = (repo, b) => repo && repo.head.type === 'branch' && repo.head.name === b;

  function silent(env, cmd) {
    const r = G.run(env, cmd);
    if (!r.ok) throw new Error('Lesson setup failed: ' + cmd);
  }

  function teamServer(env) {
    G.serverCreate(env, TEAM_URL, {
      commits: [
        { files: { 'README.md': '# Team Project\n\nA small website built by our team.\n' }, message: 'Initial commit', author: 'Maya Cohen <maya@team.dev>' },
        { files: { 'index.html': '<h1>Welcome to our team site</h1>\n<p>We build things together.</p>\n' }, message: 'Add home page', author: 'Daniel Levi <daniel@team.dev>' },
        { files: { 'about.md': '# About us\n\nOur team was founded in 2020.\nWe love clean code.\n' }, message: 'Add about page', author: 'Maya Cohen <maya@team.dev>' },
      ],
    });
  }

  const LESSONS = [
    {
      id: 'first-commit',
      title: 'Your first commit',
      summary: 'init · status · add · commit · log',
      intro: 'A repository is a folder that git watches. You will turn a plain folder into a repository and save a first snapshot (a <b>commit</b>) of your work.',
      setup(env) {
        silent(env, 'mkdir my-website');
        env.dirs['my-website'].files['index.html'] = '<h1>Hello, world!</h1>\n';
      },
      steps: [
        { text: 'Tell git who you are. Commits are signed with this name.', hint: 'git config --global user.name "Your Name"',
          check: (env, c) => ran(c, /git config .*user\.name\s+\S/) },
        { text: 'Enter the project folder <code>my-website</code>.', hint: 'cd my-website',
          check: (env) => env.cwd === 'my-website' },
        { text: 'Turn this folder into a git repository.', hint: 'git init',
          check: (env) => !!repoOf(env, 'my-website') },
        { text: 'Ask git what it sees. Notice that <code>index.html</code> is <em>untracked</em>.', hint: 'git status',
          check: (env, c) => ran(c, /git status/) },
        { text: 'Stage <code>index.html</code> — put it in the staging area so it goes into the next commit.', hint: 'git add index.html',
          check: (env) => { const r = repoOf(env, 'my-website'); return !!r && 'index.html' in r.index; } },
        { text: 'Save the snapshot with a commit and a short message.', hint: 'git commit -m "Add home page"',
          check: (env) => commitCount(repoOf(env, 'my-website')) >= 1 },
        { text: 'Create a second file <code>style.css</code> with some content, then stage and commit it.',
          hint: 'echo "h1 { color: navy; }" > style.css && git add style.css && git commit -m "Add styles"',
          check: (env) => 'style.css' in headTree(repoOf(env, 'my-website')) && commitCount(repoOf(env, 'my-website')) >= 2 },
        { text: 'Look at your history in compact form.', hint: 'git log --oneline',
          check: (env, c) => ran(c, /git log/) },
      ],
    },
    {
      id: 'branches',
      title: 'Branches',
      summary: 'branch · checkout -b · checkout · merge',
      intro: 'A branch is a separate line of work. You can experiment on a branch without touching <code>main</code>, and merge it back when it is ready.',
      setup(env) {
        silent(env, 'git init recipes && cd recipes');
        silent(env, 'echo "# Family recipes" > README.md && git add . && git commit -m "Initial commit"');
        silent(env, 'echo "Eggs, sugar, flour" > cake.md && git add cake.md && git commit -m "Add cake recipe"');
      },
      steps: [
        { text: 'List the branches. The <code>*</code> marks the branch you are on.', hint: 'git branch',
          check: (env, c) => ran(c, /git branch\s*$/) || ran(c, /git branch -(a|v)/) },
        { text: 'Create a branch called <code>add-pancakes</code> and switch to it in one command.', hint: 'git checkout -b add-pancakes',
          check: (env) => onBranch(repoOf(env, 'recipes'), 'add-pancakes') },
        { text: 'Create <code>pancakes.md</code> and commit it <em>on this branch</em>.',
          hint: 'echo "Milk, eggs, flour" > pancakes.md && git add pancakes.md && git commit -m "Add pancakes"',
          check: (env) => { const r = repoOf(env, 'recipes'); return !!r.branches['add-pancakes'] && 'pancakes.md' in G.treeOf(r, r.branches['add-pancakes']); } },
        { text: 'Switch back to <code>main</code>. Run <code>ls</code> afterwards — where did <code>pancakes.md</code> go?', hint: 'git checkout main',
          check: (env) => onBranch(repoOf(env, 'recipes'), 'main') },
        { text: 'Merge the branch into <code>main</code>.', hint: 'git merge add-pancakes',
          check: (env) => { const r = repoOf(env, 'recipes'); return onBranch(r, 'main') && 'pancakes.md' in headTree(r); } },
        { text: 'The branch is merged, so delete it.', hint: 'git branch -d add-pancakes',
          check: (env) => !repoOf(env, 'recipes').branches['add-pancakes'] },
      ],
    },
    {
      id: 'clone-pull',
      title: 'Clone, fetch & pull',
      summary: 'clone · remote · fetch · pull',
      intro: 'Teams share a repository on a server such as GitHub. You <b>clone</b> it once, then <b>fetch</b>/<b>pull</b> to get your teammates’ new commits.',
      setup(env) { teamServer(env); },
      steps: [
        { text: 'Download the team repository to your computer.', hint: `git clone ${TEAM_URL}`,
          check: (env) => !!repoOf(env, 'team-project') },
        { text: 'Enter the new folder.', hint: 'cd team-project',
          check: (env) => env.cwd === 'team-project' },
        { text: 'See where the remote called <code>origin</code> points.', hint: 'git remote -v',
          check: (env, c) => ran(c, /git remote/) },
        { text: 'Download the new commits — <code>fetch</code> updates <code>origin/main</code> but does not touch your files yet.', hint: 'git fetch',
          onEnter(env) {
            G.serverCommit(env, TEAM_URL, 'main', { 'contact.md': '# Contact\n\nEmail: team@team.dev\n' }, 'Add contact page', 'Maya Cohen <maya@team.dev>');
            return '📣 Your teammate Maya just pushed a new commit to GitHub. Look at the "Remote" panel.';
          },
          check: (env) => { const r = repoOf(env, 'team-project'); return r.remoteRefs['origin/main'] === env.server[TEAM_URL].branches.main; } },
        { text: 'Check the status: your branch is now <em>behind</em> <code>origin/main</code>.', hint: 'git status',
          check: (env, c) => ran(c, /git status/) },
        { text: 'See which commits you are missing.', hint: 'git log --oneline main..origin/main',
          check: (env, c) => ran(c, /git log/) },
        { text: 'Bring them into your branch.', hint: 'git pull',
          check: (env) => { const r = repoOf(env, 'team-project'); return head(r) === env.server[TEAM_URL].branches.main; } },
      ],
    },
    {
      id: 'push',
      title: 'Push your work',
      summary: 'switch -c · commit · push -u · branch -a',
      intro: 'You will build a feature on your own branch and publish it to GitHub with <b>push</b> so your teammates can review it.',
      setup(env) { teamServer(env); silent(env, `git clone ${TEAM_URL} && cd team-project`); },
      steps: [
        { text: 'Create and switch to a branch called <code>feature/contact-form</code>.', hint: 'git switch -c feature/contact-form',
          check: (env) => onBranch(repoOf(env, 'team-project'), 'feature/contact-form') },
        { text: 'Create <code>contact.html</code> and commit it.',
          hint: 'echo "<form>Email: <input></form>" > contact.html && git add . && git commit -m "Add contact form"',
          check: (env) => 'contact.html' in headTree(repoOf(env, 'team-project')) && onBranch(repoOf(env, 'team-project'), 'feature/contact-form') },
        { text: 'Try a plain <code>git push</code>. Read the error carefully — it tells you exactly what to do.', hint: 'git push',
          check: (env, c) => /git push/.test(c.last) },
        { text: 'Push the branch and set its upstream (the remote branch it tracks).', hint: 'git push -u origin feature/contact-form',
          check: (env) => { const r = repoOf(env, 'team-project'); return env.server[TEAM_URL].branches['feature/contact-form'] === head(r) && !!r.upstream['feature/contact-form']; } },
        { text: 'Check the status — your branch is up to date with its remote.', hint: 'git status',
          check: (env, c) => ran(c, /git status/) },
        { text: 'List local <em>and</em> remote-tracking branches.', hint: 'git branch -a',
          check: (env, c) => ran(c, /git branch (-a|--all)/) },
      ],
    },
    {
      id: 'conflict',
      title: 'Merge conflicts',
      summary: 'rejected push · pull · resolve · add · commit',
      intro: 'You and a teammate changed the <em>same line</em>. Git cannot decide which version wins, so you will resolve the conflict yourself.',
      setup(env) {
        teamServer(env);
        silent(env, `git clone ${TEAM_URL} && cd team-project`);
        G.serverCommit(env, TEAM_URL, 'main', { 'about.md': '# About us\n\nOur team was founded in 2019.\nWe love clean code.\n' }, 'Fix founding year', 'Daniel Levi <daniel@team.dev>');
      },
      steps: [
        { text: 'Open <code>about.md</code> (click it in the Files panel or run <code>nano about.md</code>), change the line <em>"Our team was founded in 2020."</em> to something else, save, then commit.',
          hint: 'nano about.md   →   then: git commit -am "Update about page"',
          check: (env) => { const r = repoOf(env, 'team-project'); const t = headTree(r)['about.md'] || ''; return commitCount(r) > 3 && !/founded in 2020\./.test(t); } },
        { text: 'Push your commit. It will be <b>rejected</b> — a teammate pushed first.', hint: 'git push',
          check: (env, c) => /git push/.test(c.last) && !c.ok },
        { text: 'Pull the remote changes. Git will report a <b>CONFLICT</b>.', hint: 'git pull',
          check: (env) => { const r = repoOf(env, 'team-project'); return !!(r.merge && r.merge.conflicts.length) || (r.commits[head(r)].parents.length > 1); } },
        { text: 'Look at the file. The part between <code>&lt;&lt;&lt;&lt;&lt;&lt;&lt;</code> and <code>&gt;&gt;&gt;&gt;&gt;&gt;&gt;</code> shows both versions.', hint: 'cat about.md',
          check: (env, c) => ran(c, /cat about\.md|git diff|git status/) },
        { text: 'Edit <code>about.md</code>: keep the text you want and delete <b>all</b> the marker lines (<code>&lt;&lt;&lt;&lt;&lt;&lt;&lt;</code>, <code>=======</code>, <code>&gt;&gt;&gt;&gt;&gt;&gt;&gt;</code>).', hint: 'nano about.md',
          check: (env) => { const t = dirOf(env, 'team-project').files['about.md'] || ''; return !/^(<<<<<<<|=======|>>>>>>>)/m.test(t); } },
        { text: 'Mark the conflict as resolved by staging the file.', hint: 'git add about.md',
          check: (env) => { const r = repoOf(env, 'team-project'); return !r.merge || !r.merge.conflicts.length; } },
        { text: 'Finish the merge with a commit.', hint: 'git commit -m "Merge remote changes"',
          check: (env) => { const r = repoOf(env, 'team-project'); return !r.merge && r.commits[head(r)].parents.length > 1; } },
        { text: 'Now the push will succeed.', hint: 'git push',
          check: (env) => env.server[TEAM_URL].branches.main === head(repoOf(env, 'team-project')) },
      ],
    },
    {
      id: 'undo',
      title: 'Oops! Undoing things',
      summary: 'restore · restore --staged · .gitignore · reset',
      intro: 'Everyone makes mistakes. Git gives you ways to throw away edits, unstage files, ignore secrets and even undo a commit.',
      setup(env) {
        silent(env, 'git init notes && cd notes');
        silent(env, 'echo "Buy milk" > notes.txt && git add . && git commit -m "Add notes"');
        silent(env, 'echo "Call grandma" >> notes.txt && git commit -am "Add a reminder"');
      },
      steps: [
        { text: 'Look at your notes.', hint: 'cat notes.txt',
          check: (env, c) => ran(c, /cat notes\.txt/) },
        { text: 'Oops — overwrite the file by accident (a single <code>&gt;</code> replaces everything).', hint: 'echo "oops" > notes.txt',
          check: (env) => { const d = dirOf(env, 'notes'); return d.files['notes.txt'] !== d.repo.index['notes.txt']; } },
        { text: 'Throw away the change and get the committed version back.', hint: 'git restore notes.txt',
          check: (env) => { const d = dirOf(env, 'notes'); return d.files['notes.txt'] === d.repo.index['notes.txt']; } },
        { text: 'Create a file with a password and stage it (by mistake!).', hint: 'echo "password=123" > secret.txt && git add secret.txt',
          check: (env) => 'secret.txt' in repoOf(env, 'notes').index },
        { text: 'Unstage it — the file stays on disk but leaves the staging area.', hint: 'git restore --staged secret.txt',
          check: (env) => !('secret.txt' in repoOf(env, 'notes').index) && 'secret.txt' in dirOf(env, 'notes').files },
        { text: 'Tell git to ignore it forever with a <code>.gitignore</code> file, and commit that file.',
          hint: 'echo "secret.txt" > .gitignore && git add .gitignore && git commit -m "Ignore secrets"',
          check: (env) => '.gitignore' in headTree(repoOf(env, 'notes')) },
        { text: 'Undo that last commit but keep its changes staged.', hint: 'git reset --soft HEAD~1',
          onEnter(env, mem) { mem.head = head(repoOf(env, 'notes')); },
          check: (env, c) => { const r = repoOf(env, 'notes'); return !!c.mem.head && head(r) === r.commits[c.mem.head].parents[0] && '.gitignore' in r.index; } },
        { text: 'Run <code>git status</code> to see the change is still staged, then commit it again with a better message.',
          hint: 'git commit -m "Add .gitignore for secrets"',
          check: (env) => '.gitignore' in headTree(repoOf(env, 'notes')) && clean(env, 'notes') },
      ],
    },
  ];

  const FREE_PLAY = {
    id: 'free',
    title: 'Free play',
    intro: 'A sandbox with a team repository and an empty one on GitHub. Try anything! Use the <b>Teammate pushes</b> button to simulate a colleague.',
    ideas: [
      `git clone ${TEAM_URL}`,
      'git checkout -b my-feature',
      'git push -u origin my-feature',
      'git init my-app, then git remote add origin https://github.com/student/my-app.git',
      'git stash / git stash pop',
    ],
    setup(env) {
      teamServer(env);
      G.serverCommit(env, TEAM_URL, 'develop', { 'blog.md': '# Blog\n\nComing soon.\n' }, 'Start blog (draft)', 'Daniel Levi <daniel@team.dev>');
      G.serverCreate(env, 'https://github.com/student/my-app.git');
    },
  };

  const TEAMMATE_EDITS = [
    (n) => ({ files: { 'TEAM_NOTES.md': null }, append: 'TEAM_NOTES.md', line: `- Note #${n} from the team`, msg: `Add team note #${n}` }),
    () => ({ append: 'README.md', line: 'Updated the readme with more details.', msg: 'Update README' }),
    () => ({ append: 'index.html', line: '<footer>© Team</footer>', msg: 'Add footer to home page' }),
  ];
  const TEAMMATES = ['Maya Cohen <maya@team.dev>', 'Daniel Levi <daniel@team.dev>', 'Noa Katz <noa@team.dev>'];

  // Free-play helper: a random teammate pushes to the remote of the current project.
  function teammatePush(env) {
    const dir = env.dirs[env.cwd];
    let url = dir && dir.repo && dir.repo.remotes.origin && dir.repo.remotes.origin.url;
    if (!url || !env.server[url]) url = TEAM_URL;
    const server = env.server[url];
    const branch = server.head.name;
    const n = Object.keys(server.commits).length + 1;
    const edit = TEAMMATE_EDITS[n % TEAMMATE_EDITS.length](n);
    const tree = server.branches[branch] ? G.treeOf(server, server.branches[branch]) : {};
    const prev = tree[edit.append] || '';
    const who = TEAMMATES[n % TEAMMATES.length];
    G.serverCommit(env, url, branch, { [edit.append]: prev + edit.line + '\n' }, edit.msg, who);
    return `📣 ${who.split(' <')[0]} pushed "${edit.msg}" to ${branch} on ${url.replace('https://', '')}`;
  }

  root.GitLessons = { LESSONS, FREE_PLAY, teammatePush, TEAM_URL };
})(window);
