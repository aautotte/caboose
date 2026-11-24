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

Signed in to GitHub, a pull request for a repository there is [made in Caboose](#creating-a-pull-request) instead.

A commit or the repository goes by the remote the checked-out branch tracks, else `origin`, else the first remote.

## Pull requests on GitHub

For a repository on github.com, a **Pull requests** section in the branches panel lists its open pull requests,
newest activity first. Each shows its number and title, **draft**, **approved** or **changes** (requested), and
its checks: passed, failed or running. The branch a pull request is from shows its number in the graph, like
`#12`, next to the branch's label.

- Click one to pick its newest commit in the graph, if it's loaded.
- Double-click it (or **Check out** in its menu) to work on it. One from this repository checks out its branch,
  making it if needed or bringing it up to the remote one, as double-clicking a remote branch does. One from a
  fork is fetched from GitHub into a branch called `pr/<number>`, which only ever moves forward: commits you make
  on it are kept.
- **Open on GitHub** and **Copy link** are in its menu too.

The list is read when the repository opens, after each fetch, and when you click the refresh button on the
section. While Caboose is in front, it's read again every few minutes, and when you come back to Caboose after a
minute or more away. It needs you to be [signed in to GitHub](settings.md#github): until then, the section says so
and offers to sign in. The repository is found from `origin` (or the first remote) on github.com, by its fetch or
push URL, as written or as `url.<base>.insteadOf` rewrites it.

### Creating a pull request

**Create a pull request…** is in a local branch's menu, in the branches panel and on the graph, when the branch
isn't the repository's default branch and has no open pull request yet. After you push a branch, the toast offers
**Create pull request** too, and the **Pull requests** section offers it for the checked-out branch while it has
none. The command palette has **Create a pull request for *branch*…**.

The dialog asks:

- **Into** which branch: the repository's default branch to begin with, or any other branch on the remote.
- A **title** and a **description** (Markdown). A branch with one commit starts with that commit's message.
  With several, the title comes from the branch's name (`feature/search-box` gives *Search box*) and the
  description lists their subjects. Picking another base fills them in again, until you change them yourself.
- **Create it as a draft**, for one that isn't ready for review yet.

Under them, it says how many commits the pull request has and what happens to the branch first. One that isn't on
the remote yet is pushed there and set to track it, and one with commits still to push has them pushed. A branch
with no commits that the base doesn't have can't be sent. If GitHub turns it down (say, someone opened one for
that branch in the meantime), the dialog says why and keeps what you typed. Once it's made, a toast offers to
**Open on GitHub**, and it shows in the list.

Not signed in, or on another host, **Create a pull request** opens the host's page for a new one instead.

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
