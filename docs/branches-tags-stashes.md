# Branches, tags and stashes

The branches panel on the left has a section each for **Local branches**, **Remotes**, **Tags** and **Stashes**,
plus [Submodules](submodules.md) and [Worktrees](worktrees.md) when the repository has some.

- A `/` in a branch name becomes a folder: `feature/login` sits in a `feature` folder.
- Right-click a section header for **Collapse all folders** / **Expand all folders**, or **Collapse all sections**
  / **Expand all sections**.
- **Filter** (Ctrl+Alt+F) narrows every section as you type.
- **Ctrl+J** collapses the whole panel to a thin rail, and back.

Next to a local branch, `↑2 ↓1` means it's 2 commits ahead of the branch it tracks and 1 behind.

## Branches

### Create

**Branch** in the toolbar (Ctrl+B) creates a branch at the current commit. **Create branch here…** in a commit's
menu, or **New branch from here…** in a branch's or tag's menu, starts it somewhere else. Tick **Switch to it now**
to check it out straight away.

### Check out

Double-click a branch, or choose **Check out** from its menu.

- Double-clicking a **remote** branch checks out the local branch that tracks it, creating it if needed, and
  fast-forwards it to the remote. If the local branch has commits of its own and can't fast-forward, Caboose offers
  to reset it instead.
- If your uncommitted changes are in the way, Caboose says so and offers to stash them first.
- A branch checked out in another worktree shows **Open its worktree** instead.

### Branch menu

| | |
| --- | --- |
| Check out, Check out in a new worktree… | |
| Merge into *current branch* | |
| Rebase *current branch* onto this | |
| Interactive rebase *current branch* onto this… | see [Rewriting history](rewriting-history.md#interactive-rebase) |
| Pull | the current branch pulls as the toolbar does; any other branch is fetched and fast-forwarded without switching to it |
| Push / Push to | with several remotes, pick one; the one it tracks is marked |
| Fast-forward my local branch | on a remote branch |
| Reset to *remote branch* | on a remote branch: moves the local branch to it |
| New branch from here…, Rename…, Set upstream… | |
| Delete… | also offers to delete the branch on its remote |
| Delete *remote*/*branch*… | deletes it on the remote only |
| Pin to the left of the graph, Hide from the graph, Show only this | see [The commit graph](graph.md#seeing-less) |
| Copy name | |

### Merge and rebase

Use the branch menu, or drag one branch label onto another in the graph. If there are conflicts, Caboose stops
and shows them. See [Conflicts](conflicts.md).

### Delete

**Delete…** asks first. When the branch is also on a remote, the dialog has **Also delete it on *origin***, off by
default. [Undo](undo.md) brings back the local branch only: what's deleted on the remote stays deleted, and
everyone who uses that remote loses it too. The dialog says so under the checkbox.

## Several at once

Ctrl+click or Shift+click branches, tags, remote branches or stashes in the panel to pick several, then right-click:

- local branches: **Push**, **Delete** (and on the remote too);
- remote branches: **Delete from the remote**;
- tags: **Push**, **Delete**;
- stashes: **Delete**.

**Clear the pick** (or Esc) ends it.

## Tags

**Create tag here…** in a commit's menu, or **Tag the current commit…** in the command palette. With a
**Message**, it's an annotated tag that records who made it and when. Tick **Push it to the remote too** to push it
straight away.

A tag's menu has **Push tag** (with several remotes: **Push tag to** one of them, or **All remotes**), **Delete
from the remote…**, **Check out (detached)**, **New branch from here…**, **Delete tag…**, **Hide from the graph**
and **Copy name**.

## Stashes

**Stash** in the toolbar puts your uncommitted changes aside. You can give it a **Name**, and stash **Only staged
changes**. Whether new (untracked) files go too is a [setting](settings.md#commits-and-stashes).

**Pop** in the toolbar applies the newest stash and deletes it. A stash's own menu has:

- **Pop (apply and delete)**;
- **Apply (keep the stash)**;
- **Rename…**, which moves it to the top of the list;
- **Delete stash…**, which can be [undone](undo.md).

If a stash conflicts with your files, Caboose says so: resolve the conflicted files, then stage them. A pop that
conflicts keeps the stash, as git does, so delete it yourself once you're done.

### Stashing part of your work

To put only some files aside, pick them in **Not staged** or **Staged** (Ctrl+click or Shift+click for several),
right-click, and choose **Stash this file…** or **Stash 3 files…**. Their staged and unstaged changes go, and new
files too, since you picked them. Everything else stays as it is, and the stash holds only those files.

To put aside one block of a file, or a few lines, open the file from **Not staged** and use the block's **Stash
block…** button. To stash some lines, click their line numbers first; the button then reads **Stash 2 lines…**
(for example). The lines leave the file, and the rest of your changes stay.

Stashing part of a file works for a file that has nothing staged and was already in the last commit. For a new file,
or one with staged changes, stash the whole file from its menu, or unstage it first.

Git won't apply a stash to files that have other uncommitted changes, which is always the case after stashing some
lines of a file. **Pop** and **Apply** then merge the stash into those files, as long as it only changed lines in
files that were already there, and none of its lines clash with yours. When they clash, nothing changes and the stash
stays: commit or stash the clashing changes first.

## Remotes

The **+** on the Remotes header adds a remote: a name (like `origin` or `upstream`) and a URL (HTTPS, SSH or a
folder path). Tick **Fetch its branches now** to see them straight away. A remote's menu has **Remove *name*…**,
which [Undo](undo.md) can bring back.
