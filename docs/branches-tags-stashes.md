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
to check it out straight away. If your changes are in the way of the switch, the branch is still made, and the
notification says which files are in the way: commit or stash changed ones, move or delete untracked ones, then
switch to it.

### Check out

Double-click a branch, or choose **Check out** from its menu.

- Double-clicking a **remote** branch checks out the local branch that tracks it, creating it if needed, and
  fast-forwards it to the remote. If the local branch has commits of its own and can't fast-forward, Caboose offers
  to reset it instead.
- Clicking a **remote** branch's label in the graph (the one with a cloud) does the same, but when the local
  branch can't fast-forward, resetting it to the remote branch is what it offers first.
- If your uncommitted changes are in the way, Caboose says so and offers to stash them first.
- A branch checked out in another worktree shows **Open its worktree** instead.

### Recent branches

The branch name under the repository's name, in the toolbar, opens a menu of the branches you've been on lately:

- **Previous** (Ctrl+Shift+B) goes back to the branch you were on before this one, as `git checkout -` does.
  Pressed again, it comes back here. If you were on a commit rather than a branch (detached), it goes back to that
  commit.
- Below it, the other branches you checked out, most recent first.
- **Another branch…** (Ctrl+P) opens the command palette, which lists every branch, the recent ones first.

The list comes from git's own record of your switches (the reflog of `HEAD`), so it includes switches made in a
terminal, and branches deleted since are left out.

### Branch menu

| | |
| --- | --- |
| Check out, Check out in a new worktree… | |
| Merge into *current branch* | fast-forwards when it can |
| Merge into *current branch* with a merge commit | always a merge commit (`--no-ff`) |
| Squash into one commit on *current branch*… | see [Merge and rebase](#merge-and-rebase) |
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

A merge has three forms:

- **Merge**: when the current branch has nothing the other doesn't, it just moves forward (a fast-forward);
  otherwise a merge commit joins the two.
- **With a merge commit**: always a merge commit, even when it could move forward, so the branch's work stays
  grouped in the history.
- **Squash into one commit…**: everything the branch brings in becomes one new, ordinary commit. The message starts
  with the one commit's message, or a line per commit, for you to edit. The branch itself doesn't change and isn't
  marked merged, so delete it yourself when you're done. A squash that conflicts changes nothing: merge normally to
  sort the conflicts out, or rebase the branch first.

Undo takes any of them off again.

To move only some of a branch's commits onto another branch, see
[Move commits onto another branch](rewriting-history.md#move-commits-onto-another-branch).

### Delete

**Delete…** asks first. When the branch is also on a remote, the dialog has **Also delete it on *origin***, off by
default. [Undo](undo.md) brings back the local branch only: what's deleted on the remote stays deleted, and
everyone who uses that remote loses it too. The dialog says so under the checkbox.

### Git Flow

Git Flow keeps two long-lived branches, production (`main`) and `develop`, and short ones for each piece of work:

| | starts from | finishes into |
| --- | --- | --- |
| Feature (`feature/…`) | develop | develop |
| Release (`release/1.2.0`) | develop | production, tagged with its version, then develop |
| Hotfix (`hotfix/1.2.1`) | production | production, tagged, then develop |

**Set up Git Flow…**, in the **Local branches** header's right-click menu, names the production and develop
branches (develop is made from production if it isn't there), the prefixes, and a prefix for version tags (`v`
makes `v1.2.0`). It writes the same `gitflow.*` settings as the `git-flow` tool, so a repository set up with either
works with both, and nothing needs installing.

Once it's set up, a **Git Flow** block under the local branches has **Feature**, **Release** and **Hotfix** to
start one: it's made from the right branch and checked out. There's one release and one hotfix at a time.
**Finish…** (in that block when one is checked out, or on the branch's menu) lists what it will do, then merges
with a merge commit, tags a release or hotfix, deletes the branch unless you tick **Keep**, and checks out develop.
Commit or stash your changes first. The [command palette](everything-else.md#command-palette) has them all too: type `git flow`.

If a merge stops on [conflicts](conflicts.md), resolve them and commit the merge, then finish again: the steps
already done are skipped. [Undo](undo.md) doesn't cover a finish; each step is an ordinary merge or tag you can
undo by hand.

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

**Stash** in the toolbar puts your uncommitted changes aside. You can give it a **Name**, and pick what goes:

- **All changes**. Whether new (untracked) files go too is a [setting](settings.md#commits-and-stashes).
- **Staged only**: what you staged goes, the rest stays.
- **Some files**: tick them in the list. New files you tick go too, whatever the setting. **Stash this file…** in a
  file's menu (or **Stash *N* files…** with several picked) opens it with those files ticked. As git does, staged
  changes to the other files are copied into the stash too: they stay staged, and come back with the stash.

**Keep the staged changes in the folder too** (`--keep-index`) stashes them but leaves them staged, so you can test
or commit just those, with the rest put aside.

**Pop** in the toolbar applies the newest stash and deletes it. A stash's own menu has:

- **Pop (apply and delete)**;
- **Apply (keep the stash)**;
- **Rename…**, which moves it to the top of the list;
- **Create a branch from this stash…**: a new branch from the commit the stash was made on, so its changes apply
  without conflicts. You switch to it, the changes come back (staged ones staged), and the stash is deleted. Commit
  or stash your changes first;
- **Delete stash…**, which can be [undone](undo.md).

If a stash conflicts with your files, Caboose says so: resolve the conflicted files, then stage them. A pop that
conflicts keeps the stash, as git does, so delete it yourself once you're done.

## Remotes

The **+** on the Remotes header adds a remote: a name (like `origin` or `upstream`) and a URL (HTTPS, SSH or a
folder path). Tick **Fetch its branches now** to see them straight away.

A remote's menu (with a single remote, the menu of the **Remotes** header) has:

- **Fetch *name***, only that remote, and **Fetch all remotes**;
- **Edit *name*…**: rename it, change its URL, or give it a separate **Push URL** (to fetch from one place and push
  to another; leave it empty to push to the URL). Renaming moves its remote branches, and your branches keep
  tracking them under the new name;
- **Remove *name*…**.

[Undo](undo.md) takes back an edit or a removal.
