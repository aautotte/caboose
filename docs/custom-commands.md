# Your own commands

Git commands you run often, with a name, in the menus and the command palette. They can run on the commit,
branch or file you right-click, and ask for a value as they run.

## Adding one

**Settings › Your commands › New command…**:

| | |
| --- | --- |
| Name | as the menus and the palette show it |
| Git command | the command, without `git` (typing it is fine too). Quotes group words: `commit -m "Made by {?Who}"` |
| Show what it prints | opens a window with the output as it runs, and a **Stop it** button. Off, a notification says how it went |
| Show the command line before running it | shows exactly what will run, even when there's nothing to ask |

**Change** (the pencil) and **Delete** (the bin) are next to each command. A deleted command comes back with
**Put it back** on the notification, its shortcut too.

## What a command can use

| | |
| --- | --- |
| `{commit}` | the commit you right-clicked (its full SHA) |
| `{branch}` | the branch you right-clicked |
| `{file}` | the file you right-clicked, as a path in the repository |
| `{head}` | the checked-out branch |
| `{?Question}` | asks as it runs, in a field labelled Question |
| `{?Question=answer}` | the same, with an answer filled in |

Anything else in braces stays as typed, so `HEAD@{1}` and `@{upstream}` work.

## Where it shows

That depends on what it uses, and the editor says where as you type:

- With `{commit}`: on a commit's menu, under **Your commands**.
- With `{branch}`: on a branch's menu, in the branches panel.
- With `{file}`: on a changed file's menu, in the details panel (with `{commit}` too, on the files of a commit).
- Every command is in the command palette, under **Your commands**. From there, `{commit}` is the picked commit,
  `{file}` the open file and `{branch}` the checked-out branch; a command whose commit or file isn't there is
  left out until it is.

Any command can have a shortcut: see [Keyboard shortcuts](shortcuts.md#changing-a-shortcut).

## How it runs

- In the repository's folder, with the git on your computer, the way Caboose runs its own commands. It's in the
  [Git activity log](everything-else.md#git-activity-log).
- Without a shell: no pipes, `&&` or `*`. Write a git alias for those (`git config alias.x '!…'`) and run the
  alias.
- The command is split into arguments before the values go in, so a value is always one argument, spaces and
  all. A branch or file name can't add options of its own: a `{file}` starting with `-` is refused unless the
  command has `--` before it (`log -- {file}`).
- Nothing that waits for you to type works: no editor opens, and git doesn't ask for a password in the terminal
  (Caboose's sign-in window does).
- **Undo can't take back what your commands do.** The reflog can help: see
  [History](history-and-blame.md#the-reflog).
- Caboose reads the repository again after each one.

## Examples

| Name | Git command | Runs on |
| --- | --- | --- |
| Tag it | `tag {?Tag name} {commit}` | a commit |
| Who wrote this | `shortlog -sn HEAD -- {file}` | a file |
| What's not merged | `log --oneline {head}..{branch}` | a branch |
| Last week | `log --oneline --since="1 week ago"` | nothing: the palette |
| Prune remote branches | `remote prune {?Remote=origin}` | nothing: the palette |
