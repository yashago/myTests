# Git Practice Lab

A web page where beginners practise git commands in a terminal that behaves like real git, with no installation needed.
Everything runs in the browser. The file system, repositories, the "GitHub" server and the teammates who push to it are all simulated, so students can't break anything.

## Run it

Open `index.html` in a browser. There is no build step and no server, and it works offline.
To share it with students, host the folder on GitHub Pages or any static host.

## What students get

- **Terminal**: real git syntax and git-style output, `&&` chaining, `>`/`>>` redirection, ↑/↓ history, Tab completion, and a built-in editor (`nano file`).
- **6 guided lessons**, each checked step by step:
  1. Your first commit: `config`, `init`, `status`, `add`, `commit`, `log`
  2. Branches: `branch`, `checkout -b`, `checkout`, `merge`, `branch -d`
  3. Clone, fetch & pull: a teammate pushes partway through the lesson
  4. Push your work: `switch -c`, the "no upstream" error, `push -u`, `branch -a`
  5. Merge conflicts: a rejected push, `pull`, conflict markers, resolving them, `add`, `commit`, `push`
  6. Undoing things: `restore`, `restore --staged`, `.gitignore`, `reset --soft`
- **Free play**: a sandbox with a team repo, an empty GitHub repo, a cheat sheet, and a "Teammate pushes a commit" button.
- **Live panels**: the working directory, the staging area, a local commit graph and a remote commit graph.

Supported git commands: `init, clone, status, add, rm, mv, commit, log, show, diff, branch, checkout, switch, restore, reset, merge, fetch, pull, push, remote, stash, config`.
Not supported: `rebase`, `cherry-pick`, `revert`, `tag`, and some others. The lab says so if a student tries one.

## Tests

```
node --test git-practice/tests/engine.test.js
```

## Files

| File | Purpose |
|------|---------|
| `js/git-engine.js` | Simulated git and bash (no DOM, so it can be tested in Node) |
| `js/lessons.js` | Lesson definitions and step checks. Add new lessons here. |
| `js/graph.js` | Commit graph renderer |
| `js/app.js` | Terminal UI, panels, editor, saving to localStorage |
