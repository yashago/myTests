// Run with:  node --test git-practice/tests
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../js/git-engine.js');

const URL = 'https://github.com/git-lab/team-project.git';

function text(res) {
  return res.lines.map((segs) => segs.map((s) => s.t).join('')).join('\n');
}

function sh(env, cmd) {
  const res = G.run(env, cmd);
  return { ...res, text: text(res) };
}

function envWithServer() {
  const env = G.createEnv();
  G.serverCreate(env, URL, {
    commits: [
      { files: { 'README.md': '# Team project\n' }, message: 'Initial commit' },
      { files: { 'about.md': 'Line 1\nOur team was founded in 2020.\nLine 3\n' }, message: 'Add about page' },
    ],
  });
  return env;
}

test('init, add, commit', () => {
  const env = G.createEnv();
  sh(env, 'mkdir site && cd site');
  assert.match(sh(env, 'git status').text, /not a git repository/);
  assert.match(sh(env, 'git init').text, /Initialized empty Git repository in \/home\/student\/site\/\.git\//);
  sh(env, 'echo "hello" > index.html');
  assert.match(sh(env, 'git status').text, /Untracked files:[\s\S]*index\.html/);
  sh(env, 'git add index.html');
  assert.match(sh(env, 'git status').text, /Changes to be committed:[\s\S]*new file:\s+index\.html/);
  const c = sh(env, 'git commit -m "First commit"');
  assert.match(c.text, /^\[main \(root-commit\) [0-9a-f]{7}\] First commit/);
  assert.match(c.text, /1 file changed, 1 insertion\(\+\)/);
  assert.match(sh(env, 'git status').text, /nothing to commit, working tree clean/);
  assert.match(sh(env, 'git log --oneline').text, /\(HEAD -> main\) First commit/);
});

test('commit without -m gives a helpful error and && stops', () => {
  const env = G.createEnv();
  sh(env, 'git init p && cd p && touch a && git add a');
  const r = sh(env, 'git commit && echo after');
  assert.equal(r.ok, false);
  assert.doesNotMatch(r.text, /after/);
});

test('branches, checkout -b, merge fast-forward and delete', () => {
  const env = G.createEnv();
  sh(env, 'git init r && cd r && echo a > a.txt && git add . && git commit -m one');
  assert.match(sh(env, 'git checkout -b feature').text, /Switched to a new branch 'feature'/);
  sh(env, 'echo b > b.txt && git add b.txt && git commit -m two');
  assert.match(sh(env, 'git checkout main').text, /Switched to branch 'main'/);
  assert.match(sh(env, 'ls').text, /^a\.txt$/);
  assert.match(sh(env, 'git merge feature').text, /Fast-forward/);
  assert.match(sh(env, 'git branch -d feature').text, /Deleted branch feature/);
});

test('unmerged branch cannot be deleted with -d', () => {
  const env = G.createEnv();
  sh(env, 'git init r && cd r && echo a > a.txt && git add . && git commit -m one');
  sh(env, 'git switch -c exp && echo x >> a.txt && git commit -am wip && git switch main');
  assert.match(sh(env, 'git branch -d exp').text, /not fully merged/);
  assert.match(sh(env, 'git branch -D exp').text, /Deleted branch exp/);
});

test('checkout refuses to overwrite local changes', () => {
  const env = G.createEnv();
  sh(env, 'git init r && cd r && echo a > f && git add . && git commit -m one');
  sh(env, 'git branch other && git switch other && echo b > f && git commit -am two && git switch main');
  sh(env, 'echo local > f');
  assert.match(sh(env, 'git checkout other').text, /would be overwritten by checkout/);
});

test('clone, fetch, status behind, pull', () => {
  const env = envWithServer();
  assert.match(sh(env, `git clone ${URL}`).text, /Cloning into 'team-project'/);
  sh(env, 'cd team-project');
  assert.match(sh(env, 'git status').text, /up to date with 'origin\/main'/);
  G.serverCommit(env, URL, 'main', { 'notes.md': 'hi\n' }, 'Add notes');
  assert.match(sh(env, 'git fetch').text, /main\s+-> origin\/main/);
  assert.match(sh(env, 'git status').text, /behind 'origin\/main' by 1 commit/);
  assert.match(sh(env, 'git pull').text, /Fast-forward/);
  assert.equal(env.dirs['team-project'].files['notes.md'], 'hi\n');
});

test('push new branch requires upstream, then -u works', () => {
  const env = envWithServer();
  sh(env, `git clone ${URL} && cd team-project && git checkout -b feature/x`);
  sh(env, 'echo c > contact.html && git add . && git commit -m contact');
  assert.match(sh(env, 'git push').text, /has no upstream branch/);
  const r = sh(env, 'git push -u origin feature/x');
  assert.match(r.text, /\* \[new branch\]\s+feature\/x -> feature\/x/);
  assert.match(r.text, /set up to track 'origin\/feature\/x'/);
  assert.ok(env.server[URL].branches['feature/x']);
});

test('rejected push, pull with conflict, resolve, push', () => {
  const env = envWithServer();
  sh(env, `git clone ${URL} && cd team-project`);
  G.serverCommit(env, URL, 'main', { 'about.md': 'Line 1\nOur team was founded in 2019.\nLine 3\n' }, 'Fix year');
  sh(env, 'echo "Line 1" > about.md && echo "Founded long ago." >> about.md && echo "Line 3" >> about.md');
  sh(env, 'git commit -am "Reword about"');
  assert.match(sh(env, 'git push').text, /\[rejected\][\s\S]*fetch first/);
  const pull = sh(env, 'git pull');
  assert.match(pull.text, /CONFLICT \(content\): Merge conflict in about\.md/);
  const file = env.dirs['team-project'].files['about.md'];
  assert.match(file, /<<<<<<< HEAD\nFounded long ago\.\n=======\nOur team was founded in 2019\.\n>>>>>>> /);
  assert.match(sh(env, 'git status').text, /both modified:\s+about\.md/);
  assert.match(sh(env, 'git commit -m x').text, /unmerged files/);
  sh(env, 'echo "Line 1" > about.md && echo "Founded in 2019." >> about.md && echo "Line 3" >> about.md');
  sh(env, 'git add about.md');
  const c = sh(env, 'git commit -m "Merge"');
  assert.equal(c.ok, true);
  const repo = env.dirs['team-project'].repo;
  assert.equal(repo.commits[G.headId(repo)].parents.length, 2);
  assert.match(sh(env, 'git push').text, /main -> main/);
});

test('non-overlapping edits to the same file merge cleanly', () => {
  const r = G.merge3('a\nb\nc\nd\ne\n', 'A\nb\nc\nd\ne\n', 'a\nb\nc\nd\nE\n', 'HEAD', 'x');
  assert.equal(r.conflict, false);
  assert.equal(r.text, 'A\nb\nc\nd\nE\n');
});

test('restore, restore --staged, reset --soft, gitignore', () => {
  const env = G.createEnv();
  sh(env, 'git init r && cd r && echo one > notes.txt && git add . && git commit -m one');
  sh(env, 'echo oops > notes.txt && git restore notes.txt');
  assert.equal(env.dirs.r.files['notes.txt'], 'one\n');
  sh(env, 'echo pw > secret.txt && git add secret.txt && git restore --staged secret.txt');
  assert.ok(!('secret.txt' in env.dirs.r.repo.index));
  sh(env, 'echo secret.txt > .gitignore');
  assert.doesNotMatch(sh(env, 'git status').text, /\tsecret\.txt/);
  assert.match(sh(env, 'git add secret.txt').text, /ignored by one of your \.gitignore/);
  sh(env, 'git add .gitignore && git commit -m ignore');
  sh(env, 'git reset --soft HEAD~1');
  assert.match(sh(env, 'git status').text, /new file:\s+\.gitignore/);
});

test('stash and pop', () => {
  const env = G.createEnv();
  sh(env, 'git init r && cd r && echo one > f && git add . && git commit -m one');
  sh(env, 'echo two > f');
  assert.match(sh(env, 'git stash').text, /Saved working directory and index state WIP on main/);
  assert.equal(env.dirs.r.files.f, 'one\n');
  sh(env, 'git stash pop');
  assert.equal(env.dirs.r.files.f, 'two\n');
});

test('typos get helpful messages', () => {
  const env = G.createEnv();
  assert.match(sh(env, 'git comit').text, /most similar command is\n\tcommit/);
  assert.match(sh(env, 'status').text, /Did you mean `git status`/);
});
