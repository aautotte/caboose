# Worktrees

A worktree is a second folder for the same repository, with its own branch checked out. Both share one history, so
a commit made in one shows up in the other straight away. Use one to fix something on another branch without
stashing or switching away from what you're doing.

## Create one

- **New worktree…** in the command palette, or the **+** on the Worktrees section;
- **New worktree here…** in a commit's menu;
- **Check out in a new worktree…** in a branch's menu.

Pick what to check out (an existing branch, or a new branch from a commit) and the folder: a new, empty folder,
which Caboose creates. **Open it in a new tab** opens it straight away.

A branch can only be checked out in one worktree at a time. In the branch's menu, **Open its worktree** goes to the
one that has it.

## The Worktrees section

The branches panel lists every worktree once there's more than the main one. Each one's menu has:

| | |
| --- | --- |
| Open | in a new tab, as a repository of its own |
| Show in folder, Open in terminal, Copy path | |
| Lock (keep it from being removed) / Unlock | useful for a worktree on a removable drive |
| Remove… | deletes the folder, after asking; the branch and its commits stay. If it has uncommitted changes, Caboose asks again |

You can't remove the worktree of the tab you're in: open it from another tab.

If a worktree's folder was deleted outside Caboose, it's marked as missing. **Forget missing worktrees**, in the
section header's menu, tidies them up (`git worktree prune`). Locked ones are kept.
