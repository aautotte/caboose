# Keyboard shortcuts

**Ctrl+/** shows this list in the app, with any you've changed. On macOS, Cmd works wherever Ctrl is written.
These are the keys out of the box: most can be [changed](#changing-a-shortcut).

## Repository

| | |
| --- | --- |
| Commit staged files | Ctrl+Enter |
| Stage all and commit | Ctrl+Shift+Enter |
| Stage all | Ctrl+Shift+S |
| Unstage all | Ctrl+Shift+U |
| Focus the commit summary | Ctrl+Shift+M |
| New branch | Ctrl+B |
| Switch to the previous branch | Ctrl+Shift+B |
| Fetch all | Ctrl+L |
| Undo | Ctrl+Z |
| Redo | Ctrl+Y |

## Moving around

| | |
| --- | --- |
| Next / previous commit | J / K, or ↓ / ↑ |
| First / last commit | Ctrl+Home / Ctrl+End |
| Pick a range of commits | Shift+↓ / Shift+↑ |
| Search commits | Ctrl+F (when no file is open) |
| Find in the open file | Ctrl+F (in a diff) |
| Filter branches | Ctrl+Alt+F |
| Filter the graph by path or author | Ctrl+Shift+F |
| Command palette | Ctrl+P |
| Collapse or expand the branches panel | Ctrl+J |
| Collapse or expand the details panel | Ctrl+K |
| File history (from a diff or blame) | Ctrl+Shift+H |
| Close the current view, clear a pick | Esc |

## Tabs

| | |
| --- | --- |
| Repositories tab | Ctrl+T |
| Close tab | Ctrl+W |
| Go to tab 1 to 9 | Ctrl+1 … Ctrl+9 |
| Next / previous tab | Ctrl+Tab / Ctrl+Shift+Tab |
| Open a folder | Alt+O |

## Branches panel

| | |
| --- | --- |
| Check out (or open) | Enter, or double-click |
| Hide from the graph, or show again | H |
| Delete | Delete |
| Pick several | Ctrl+click, Shift+click |

## In a diff

Focus a block of changes first (click it, or Tab to it).

| | |
| --- | --- |
| Move between changed lines | ↑ / ↓ |
| Pick lines as you move | Shift+↑ / Shift+↓ |
| Pick or unpick a line | Space |
| Stage (or unstage) the pick, or the whole block | Enter |
| Next / previous match, in Find | Enter / Shift+Enter |

## Interactive rebase

| | |
| --- | --- |
| Keep, Reword, Squash, Fixup, Drop | P, R, S, F, D |
| Move a commit up or down | Alt+↑ / Alt+↓ |

## Bisect

| | |
| --- | --- |
| Good, Bad, Skip | G, B, S |

## Changing a shortcut

**Settings › Keyboard shortcuts**, or **Change shortcuts…** under the list Ctrl+/ shows. Every command in the
Repository, Moving around and Tabs lists above can change, and so can these, which have no key to start with:
Pull, Pull (rebase), Push, Stash changes, Pop the newest stash, Apply a patch, Compare, Focus on this branch,
Reflog, Git activity log, Settings, Switch theme and Open in terminal, editor or file manager. So can
[your own commands](custom-commands.md).

1. Click **Change** next to it. It says **Press the keys**.
2. Press the new keys. **Esc** leaves it as it was.

The keys need Ctrl or Alt, or are one of F1 to F12: a key on its own is for typing and the lists. A few stay
as they are: Ctrl+C, Ctrl+V, Ctrl+X and Ctrl+A, Ctrl+Enter (commit), Ctrl+Tab, Ctrl+1 to Ctrl+9, Ctrl+Home and
Ctrl+End. A key another command has is offered with **Use it here instead**, which leaves the other one
without a shortcut.

Next to a shortcut, **×** takes it away and the arrow puts back the one it came with. **Put every shortcut
back** at the end of the list does that for all of them. Menus, tooltips and the command palette show the keys
as they are now.
