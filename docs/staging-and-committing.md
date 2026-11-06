# Staging and committing

Click **Uncommitted changes** at the top of the graph. The details panel shows two lists, **Not staged** and
**Staged**, with the commit box under them.

## The file lists

- The list icon on each header switches between a flat list and a **folder tree**. In the tree, right-click
  for **Collapse all** or **Expand all**.
- The eye on **Not staged** shows or hides untracked files (files git isn't tracking yet).
- **Stage all** (Ctrl+Shift+S) and **Unstage all** (Ctrl+Shift+U) are on the headers.
- Click a file to open its diff. Ctrl+click or Shift+click to pick several, then stage, unstage or discard them
  together.

Each file has a letter: **M** modified, **A** added, **D** deleted, **R** renamed, **C** copied, **U**
conflicted and **?** untracked. Files stored in [Git LFS](lfs.md) get an LFS badge.

### File menu

Right-click a file (or several):

| | |
| --- | --- |
| Stage / Unstage | |
| Discard changes… | asks first, and can be [undone](undo.md) |
| Ignore | the file only, all files with its extension, or its folder; also undoable. **On this computer only** does the same for new files without changing `.gitignore` |
| Track with Git LFS / Stop tracking | see [Git LFS](lfs.md) |
| Open in editor, Open in diff tool, Show in folder | your own tools, see [Settings](settings.md#external-tools) |
| Open in merge tool | for a conflicted file |
| File history, Blame | see [File history and blame](history-and-blame.md) |
| Copy path | |
| Copy as patch | the file's changes (or the picked files') as a diff, see [Patches](#patches) |

### Ignoring files on this computer only

**Ignore** adds lines to the repository's `.gitignore`, which you commit, so everyone ignores those files. For files
that only matter to you, like your own notes or an editor's settings, use **Ignore › On this computer only**
instead: the same choices (the file, its extension, a folder) go to `.git/info/exclude`, which git reads like
`.gitignore` but never commits. Undo takes them out again.

It's offered for new files only. Git keeps tracking a file it already has, whatever the ignore rules say, and
stopping that would be a change everyone gets.

## Diffs

![A diff with block and line staging](images/diff.png)

The header of a diff has:

- **Previous / next change**, to jump between blocks;
- **Find in file** (Ctrl+F): type to highlight every match, **Enter** for the next one, **Shift+Enter** for the
  previous one, **Esc** to close;
- **Diff layout**: inline or side by side;
- **Hide whitespace changes**;
- **Diff options**: **Wrap long lines**, and **Lines around changes**, how many unchanged lines show above and
  below each change, from 1 to 25 (3 by default). With more, changes close together join into one block. The
  whole-file layout shows every line, so it has none to set;
- **File history**, **Use the full width** and **Close** (Esc).

Your choices are remembered. The default layout, code size and tab width are in [Settings](settings.md#diffs-and-code).

Some files get a different view:

- **Binary files** say only that they changed.
- **Git LFS files** say how the stored file changed, not the pointer text.
- **Submodules** list the commits the pointer moves by. See [Submodules](submodules.md).
- **Large changes** wait for **Show anyway** before drawing thousands of lines.
- **Only whitespace changed** says so when whitespace is hidden.

## Staging blocks and lines

In a diff of a file that isn't staged, each block of changes has **Stage block** and **Discard block** buttons. In
a staged file, it has **Unstage block**.

To stage only some lines, click their line numbers to pick them (Shift+click picks a range), then use the block's
button, which now reads **Stage 2 lines** (for example): it acts on the picked lines only. **Clear** drops the pick.

With the keyboard: focus a block, then **↑ / ↓** move between changed lines, **Shift+↑ / ↓** picks as it moves,
**Space** picks or unpicks a line, and **Enter** stages (or unstages) the pick, or the whole block when nothing is
picked.

Lines can't be picked while whitespace changes are hidden, because the patch git applies has to match the file.
The blocks you stage are always the ones on screen, however many lines around changes you show.

When the open file is fully staged, the diff follows it to the Staged list, and back again when you unstage it.

## Committing

- **Summary** is required. The counter shows its length. **Description** is optional.
- **Ctrl+Enter** commits what's staged. **Ctrl+Shift+Enter** stages everything and commits.
- **Ctrl+Shift+M** jumps to the summary from anywhere.
- **Amend last commit** replaces the last commit with one that includes what's staged, and fills in its message
  for you to edit.
- **Push after committing** pushes as soon as the commit is made. Its default is a setting.
- **Skip hooks** runs `git commit --no-verify`.

Under the description:

- **Recent** lists the last messages on this branch (not merges or `fixup!` commits). Picking one fills in the
  summary and the description. If it replaces a message you'd written, **Put it back** in the notification
  undoes that.
- **Co-author** adds a `Co-authored-by: Name <email>` line to the description, for someone who worked on it with
  you. It lists the people in the history, most recent first; **Someone else…** takes any name and email. GitHub
  and GitLab show co-authors as authors too.
- **Wrap** wraps the description at 72 characters, the width `git log` shows best: paragraphs and list items are
  rewrapped, while code (indented or between ``` lines), quotes, tables and lines like `Co-authored-by:` at the
  end stay as typed. **Wrap the description when committing**, in [Settings](settings.md), does it every time.

The line under the button says who the commit will be from (name and email), and where that comes from when it
isn't your global git config: this repository's setting or your profile.

In a [submodule](submodules.md) that isn't on a branch, Caboose asks before committing and offers to create a
branch, because those commits are easy to lose.

A commit message template (`commit.template`) pre-fills the message. Commit signing is set in
[Settings](settings.md#commit-signing).

When a commit leaves nothing else to commit, you're taken back to the commit list.

## Discarding everything

The trash icon on **Uncommitted changes** (or **Discard all changes…** in the command palette) throws away every
change. Caboose keeps a copy first, so **Undo** brings it all back.

## Cleaning up the working tree

The eraser icon on **Uncommitted changes** opens **Clean up the working tree**. Tick what goes:

- **Changes to tracked files**: the folder goes back to the last commit, staged changes included (`git reset
  --hard`).
- **Untracked files**: new files that were never committed (`git clean`).
- **Ignored files**: what `.gitignore` leaves out, like build output and dependencies.

It lists what will be removed, and **Undo** brings it all back, staged changes staged again. Ignored files are copied
for undo too, which takes a while for a big folder like `node_modules`.

**Remove untracked files…** (in the command palette, or the menu of the **Uncommitted changes** row in the graph)
opens it with only the untracked files ticked. With conflicts, resolve them or abort first.

## Patches

A patch is a set of changes as text, to send to someone or to move between repositories.

### Copying and saving

- **Patch › Copy as patch**, in a commit's menu, copies it as `git format-patch` would: the changes with the
  commit's author, date and message. Pick several commits (Ctrl+click) for one patch of them all, oldest first.
- **Patch › Save as patch file…** saves the same to a file.
- **Copy as patch**, in a changed file's menu (or several picked files'), copies those changes as a plain diff:
  the staged ones from the Staged list, the others from Not staged, new files included.
- **Copy all changes as patch**, in the menu of **Uncommitted changes** in the graph or the command palette, copies
  everything not yet committed.

Merge commits can't be made into patches: `git format-patch` leaves them out.

### Applying

**Apply a patch…** (the menu of **Uncommitted changes**, or the command palette) opens with what's on the
clipboard if it's a patch. **Paste from the clipboard** fills it in again, and **Open a patch file…** reads a file.
As you go, it lists the commits in the patch and the files it changes, and says whether it applies.

Choose where it goes:

- **As commits**, for a patch from `git format-patch` or **Copy as patch** on commits: each becomes a commit with
  its author, date and message, on top of the checked-out branch (`git am`). Nothing can be staged for this.
- **To your working files**: the changes show up unstaged, to look over before you commit.
- **To your working files, staged**: the same, and staged (`git apply --index`).

If a part doesn't fit (the file has changed since the patch was made), it says which file and line, and nothing is
applied. **Undo** takes an applied patch back out, or the commits off the branch.

Line endings: Windows line endings (CRLF) in a patch are kept, so patches to files that use them work. Use **Paste
from the clipboard** rather than Ctrl+V into the box, which turns them into plain line ends. A patch that something
turned to CRLF throughout (an editor, a browser) is read as git wrote it.
