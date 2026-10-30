# File history, blame, compare and the reflog

## File history

![The history of src/fetch.js: the commits on the left, the change in the selected one on the right](images/guide/file-history.png)

Every commit that changed one file, newest first, with what changed in each.

Open it from:

- **File history** in a file's menu, in the changes list or in a commit's file list;
- the history icon in a diff's header, or **Ctrl+Shift+H** from a diff or blame;
- the command palette, while a file is open.

Click a commit to see its change to the file. Above the diff, choose **Changes** (only the changed blocks),
**File** (the whole file at that commit) or **Split** (side by side). **Commit details** shows the whole commit in the
details panel. Drag the edge of the commit list to resize it.

## Blame

![Blame: each line with the commit that last changed it](images/guide/blame.png)

Each line of the file, with the commit, author and date that last changed it. Lines you haven't committed yet say
**Not committed yet**. Click a line's commit to show it in the details panel. **Show changes**, in the header,
opens the file's diff.

Open it from:

- **Blame** in a file's menu, or the blame icon in a diff's header: the current version;
- **Blame at this commit** in a commit's file list, or from a diff of a commit: the file as it was then;
- the command palette, while a file is open.

**Blame the current version** goes back to today's file from an older one. Ctrl+Shift+H goes to the file's history.

## Compare two branches or commits

What changed from one branch, tag or commit to another: the files that differ, each one's diff, and the commits only
one side has.

Open it from:

- **Compare with *branch*** in a branch's menu (in the branches panel or on a graph row): the checked-out branch,
  and for a local branch that tracks one, its upstream (how far it has drifted from the remote);
- **Compare with *branch*** in a commit's menu: that commit against the checked-out branch;
- **Compare these two** when two commits are picked in the graph (Ctrl-click): from the older to the newer;
- **Compare two branches or commits…** in the command palette, which asks for any two.

The line under the header says how many commits each side has that the other doesn't. **Files** lists what differs;
click one to see its diff. **Commits** lists the commits only on each side; click one to see it in the details panel.

Tick **Only what *branch* changed since they split** to compare from the point where the two split instead (`git
diff a...b`). Changes made on the other side since then drop out, so you see what a pull request of that branch would
show. The swap button turns the comparison around.

## The reflog

Git records every move of HEAD in this repository: each checkout, commit, amend, reset, rebase, merge and pull. The
reflog lists them, newest first, in git's own words (for example `checkout: moving from main to spike`), with the
commit each one went to.

Open it from **Reflog: where HEAD has been**, in the **Local branches** header's menu or the command palette.

Click a move to see its commit in the details panel. A commit marked **not on a branch** is one no branch, tag or
stash leads to any more, for example after deleting a branch, a hard reset or a rebase. The reflog is the only way
back to it. To keep one:

- **Create branch here…** gives it a branch;
- **Reset *branch* here…** moves the checked-out branch back to it (the usual reset choices, and it can be undone);
- right-click a move for **Check out this commit (detached)** and **Cherry-pick onto *branch*** too.

Git forgets reflog entries after a while (90 days by default, 30 for commits no branch has), so don't wait too long.
