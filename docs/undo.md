# Undo

**Undo** in the toolbar (Ctrl+Z) takes back the last action. **Redo** (Ctrl+Y) does it again. Hover either button
to see which action it is.

Each repository keeps its own list of the last 100 actions, and the list survives a restart.

## What can be undone

| Action | Undo puts back |
| --- | --- |
| Commit, amend | the branch as it was before; what you committed is staged again |
| Discard changes (files, blocks or lines, or everything) | the changes, from a copy Caboose kept |
| Check out a branch or commit | the branch you were on |
| Merge, rebase, pull | the branch where it was before |
| Edit message, squash, move a commit, interactive rebase | the commits as they were |
| Cherry-pick, revert | the branch where it was before |
| Reset (soft, mixed or hard) | the branch, and for a hard reset your files too |
| Reset a branch to a remote branch | where the branch pointed |
| Delete branches | the local branches |
| Delete tags | the local tags |
| Delete stashes | the stashes, in their places |
| Remove a remote | the remote, with its URLs |
| Ignore files | `.gitignore` as it was, and the files tracked again |

A merge, rebase or pull that stopped on conflicts is recorded once you finish it.

## What can't be undone

Anything that changes another computer:

- **Push, force push.** Once a remote has your commits, others may have them too.
- **Deleting a branch or tag on a remote.** Undo brings back the local one only. The delete dialog says so under
  **Also delete it on *origin***.

And a few things that are easy to reverse by hand: creating a branch, tag, stash or worktree, applying a stash,
fetching, and submodule and worktree housekeeping.

For anything older than the undo list, or done outside Caboose, the [reflog](history-and-blame.md#the-reflog) still
knows every commit HEAD has been on.

## When Caboose refuses

Before undoing, Caboose checks that the repository is still in the state the action left it in. If you've changed
it since, for example by committing in a terminal, it refuses rather than guess, and says so. Nothing is changed.

## Under the hood

Undo uses plain git: `reset`, `switch`, `update-ref`, `stash` and so on. Every command is in the
[Git activity log](everything-else.md#git-activity-log). Commits that are "undone" aren't deleted straight away:
Caboose keeps references to them (under `refs/caboose/undo/`) so that redo, and you, can find them.
