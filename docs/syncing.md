# Syncing with remotes

## Fetch

**Fetch now** in the status bar, or Ctrl+L, fetches every remote. It updates the remote branches and the ahead /
behind counts, and never touches your files.

**Fetch in the background** ([Settings](settings.md#general)) does the same every minute, 5 minutes, 15 minutes
or hour. It never asks for a password: if signing in fails, it stops and waits for you to fetch by hand.

## Pull

**Pull** in the toolbar fetches and brings the current branch up to date. What it does is a setting:

| Mode | What happens | git |
| --- | --- | --- |
| Fast-forward when possible | fast-forwards, or makes a merge commit when both sides have new commits | `git pull --ff --no-rebase` |
| Fast-forward only | fast-forwards, or stops if both sides have new commits | `git pull --ff-only` |
| Rebase | puts your new commits on top of the remote's | `git pull --rebase` |

The arrow next to **Pull** offers every mode, whatever the setting.

If your uncommitted changes are in the way, Caboose says so and offers to **stash them and pull** (they're put back
after) or **discard them and pull**. If the pull stops on conflicts, see [Conflicts](conflicts.md).

A pull can be [undone](undo.md).

### Pull another branch

**Pull** in a branch's menu, on a branch that isn't checked out, fetches it and fast-forwards it without switching
to it. **Fast-forward my local branch** on a remote branch does the same from the other side.

## Push

**Push** in the toolbar pushes the current branch to the remote it tracks.

- A branch that isn't on a remote yet: Caboose asks which remote to **publish** it to, then links it so that pull
  and push know where to go.
- With several remotes, the arrow next to **Push** pushes to another remote. In a branch's menu, **Push to** lists
  each remote and marks the one it tracks. Pushing elsewhere leaves the tracking as it was.
- You can push any local branch from its menu, not only the checked-out one.
- **Push after committing**, under the commit message, pushes as soon as you commit.

### When a push is rejected

If the remote has commits you don't have, the push is rejected. Caboose explains why and offers to **force push**.
It uses `--force-with-lease`: the remote branch is replaced with yours, unless someone pushed to it since your last
fetch, in which case it stops and offers to fetch.

Pull first if you're not sure. A force push can't be [undone](undo.md).

## Upstreams

**Set upstream…** (or **Change upstream…**) in a local branch's menu picks the remote branch it pulls from and
pushes to.

## On the web

Caboose knows the web pages of repositories on **GitHub**, **GitLab**, **Bitbucket** and **Azure DevOps**, from the
remote's URL alone (nothing is fetched, and no account is needed).

- **On the web** in a branch's menu (in the branches panel or on a graph row): **Open the branch in the browser**,
  **Create a pull request** (a merge request on GitLab: the host's page for a new one, with the branch filled in),
  and **Copy link**. A local branch goes by the branch it tracks, so it has to be pushed first; a branch that isn't
  on a remote has no entry.
- **On the web** in a commit's menu: open the commit's page, or copy a link to it. It has to be on the remote
  already.
- **Browser**, under the arrow button in the toolbar, opens the repository's page. The command palette has it too,
  and **Create a pull request for *branch*** for the checked-out one.

A commit or the repository goes by the remote the checked-out branch tracks, else `origin`, else the first remote.

### A server of your own

Caboose guesses the site from the server's name (one with *github*, *gitlab* or *bitbucket* in it, or Azure DevOps'
own). For a server whose name doesn't say, tell it which kind it is, once per repository:

```bash
git config caboose.hosting gitlab
```

`github`, `gitlab`, `bitbucket` and `azure` work. Add `--global` to set it for every repository.

## Signing in

Caboose uses your git's credential setup: a credential manager, SSH keys and your SSH config all work as in a
terminal. If git needs a username or password that nothing provides, Caboose asks, passes it to git for that one
request and doesn't keep it.

Each [profile](settings.md#profile) can use its own SSH key, for example a work key for work repositories.

## Progress

Long operations (clone, fetch, pull, push, a big checkout) show git's own progress in the toolbar: the phase, the
percentage and the count, for example `Receiving objects 45% (58234/129384)`.
