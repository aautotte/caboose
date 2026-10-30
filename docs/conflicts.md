# Conflicts and the merge tool

A merge, rebase, cherry-pick, revert, pull or stash pop can stop when both sides changed the same lines. Caboose
then shows a banner over the uncommitted changes: what's paused, how many files are still conflicted, and the
buttons to finish.

| | |
| --- | --- |
| **Continue** | once every conflicted file is resolved and staged |
| **Skip this commit** | during a rebase: leave out the commit that conflicts and go on |
| **Abort** | put everything back as it was before the operation started |

Conflicted files are marked **U** in the file list. Click one to open it in the merge tool.

## The merge tool

![The merge tool, with yours, the common ancestor and theirs side by side](images/merge.png)

The top shows **yours** (the branch you're on) and **theirs** (what's coming in) side by side, with the **base**
(their common ancestor) in between when **Show the base** is on. The bottom is the **merged result**.

- For each conflict, pick the lines to use from either side: **Use this line** or **Use these lines**. Picks from
  both sides go in the order you pick them.
- **Previous conflict** and **Next conflict** jump between them.
- **Keep yours** or **Keep theirs** resolves the whole file one way.
- You can type in the merged result directly. **Rebuild from picks** drops your edits and starts again from the
  picks.
- **Save result** writes the file and stages it. It's enabled once no conflict is left open.

Some conflicts aren't about lines:

- **Deleted on one side, changed on the other**: **Keep the edited file** or **Delete it**.
- **Binary files**: **Keep yours** or **Keep theirs**.

## Your own merge tool

**Merge tool** in the merge tool's header, or **Open in merge tool** in a conflicted file's menu, runs the tool set
in git's `merge.tool` (for example meld, kdiff3 or Beyond Compare). Set it in
[Settings](settings.md#external-tools).

## Undo

A merge, rebase or pull that stopped on conflicts is recorded once it finishes. **Undo** then puts the branch back
where it was before it started. See [Undo](undo.md).
