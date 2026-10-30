# Getting started

## Before you start

Caboose needs **git 2.30 or newer** on your `PATH`. It uses your git, with your config, SSH setup, credential
manager and hooks, so anything that works in your terminal works here.

If git doesn't know your name and email yet, Settings says so: commits fail until you fill them in. See
[Settings and profiles](settings.md#your-name-and-email).

## The Repositories tab

The house icon at the far left of the tab bar (Ctrl+T) is the Repositories tab. From there:

- **Open**: a folder on this computer that already uses git (Alt+O from anywhere). The folder picker starts where
  you last picked a folder.
- **Clone**: copy a repository from a URL.
- **New**: start an empty repository.

Below the cards is the **Recent** list. Click a repository to open it.

- The star adds it to **Favourites**, which are listed first.
- **New group** makes a named group. Right-click a repository and choose **Move to group** to file it there.
  Deleting a group keeps its repositories.
- **Remove from this list** forgets a repository. The folder on disk isn't touched.

## Clone a repository

- **Repository URL**: HTTPS or SSH, for example `https://host/team/project.git` or `git@host:team/project.git`.
- **Put it in**: the parent folder. **Folder name** is filled in from the URL; change it if you like.
- **Shallow clone (recent history only)**: fetches only the last N commits, optionally of one branch. Much faster
  for big histories.
- **Only some folders (sparse checkout)**: lists the folders you want, like `src docs`. Files at the top level
  always come along.

The progress shows git's own numbers, for example `Receiving objects 45% (58234/129384)`. If the remote asks for
a password, Caboose asks you and passes it straight to git; it doesn't save it. A credential manager can
remember it for you.

## Start a new repository

Pick a parent folder, a name and the first branch's name. You can add an ignore file (General, Node.js, Python
or .NET) and an MIT licence. Caboose makes the first commit with a README and the files you picked.

## Tabs

Each repository opens in its own tab.

| | |
| --- | --- |
| Close the tab | Ctrl+W, or the × on the tab |
| Go to tab 1 to 9 | Ctrl+1 … Ctrl+9 |
| Next / previous tab | Ctrl+Tab / Ctrl+Shift+Tab |
| Reorder | drag a tab |

Your open tabs come back, in the same order, when you restart. Each [profile](settings.md#profile) has its own.

## The repository window

- **Toolbar** (top): undo and redo, pull, push, new branch, stash and pop. On the right: commit search, open the
  repository in another app, the command palette and Settings.
- **Branches panel** (left): local branches, remotes, tags, stashes, and submodules and worktrees when there are
  some.
- **Commit graph** (middle). See [The commit graph](graph.md).
- **Details panel** (right): the uncommitted changes and the commit box, or the selected commit.
- **Status bar** (bottom): the current branch, how far ahead or behind its upstream it is, **Fetch now**, and the
  **Git log**.

## Changes made outside Caboose

Caboose watches the repository. Work you do in a terminal or another tool (a commit, a new branch, a checkout)
shows up when you come back to the window.

## Open in another app

The arrow button in the toolbar opens the repository in your **terminal**, **editor** or **file manager**. Which
terminal and editor is up to you: see [External tools](settings.md#external-tools). **Browser** opens its page on
the git host: see [On the web](syncing.md#on-the-web).
