<p align="center">
  <img src="resources/icon.png" width="112" alt="Caboose's icon: a determined purple caboose with a Git branch on its door, at a fork in the rails">
</p>

<h1 align="center">Caboose</h1>

<p align="center">A desktop Git client with a commit graph, built on the git you already have.</p>

![The commit graph, with branches on the left and uncommitted changes on the right](docs/images/graph.png)

Caboose runs **your installed git**, with your config, your SSH setup, your credential manager and your hooks.
Every command it runs is listed in the Git log view, ready to copy. There's no account and no subscription. It
works offline, and it doesn't phone home.

## What it does

- **Commit graph:**
  - branches, tags, stashes and remotes, laid out in lanes;
  - focus on one branch, hide the branches and tags you don't care about, pin one to the left;
  - search the whole history.
- **Staging:** stage files, blocks or single lines (mouse or keyboard); discard them too, with undo.
- **Commits:** amend, sign, edit any commit's message, squash several into one, move a commit up or down,
  revert, cherry-pick, reset.
- **Branches:**
  - create, rename, delete, also on the remote;
  - merge or rebase by dragging one branch onto another;
  - "/" in names becomes folders.
- **Interactive rebase:** keep, reword, squash, fixup, drop or reorder, for a whole branch or just the commits you
  select.
- **Conflicts:** a three-way merge tool, with yours, the common ancestor and theirs side by side; pick lines and save.
- **Sync:**
  - fetch, pull (merge, fast-forward or rebase), push, force push with lease;
  - with several remotes, push the current branch or a tag to whichever one you pick (tags to all of them too);
  - set upstreams, manage remotes;
  - background fetch that never asks for a password.
- **Undo:** most actions can be undone, even after a restart, and Caboose refuses safely if the repository
  changed in between.
- **Profiles:** separate tabs, settings and identity for work and personal projects, including the name, email,
  signing key and SSH key used.
- **Plus:** stashes, tags, blame, file history, a command palette, keyboard shortcuts, light and dark themes.

![A diff with block and line staging](docs/images/diff.png)

![The merge tool, with yours, the common ancestor and theirs side by side](docs/images/merge.png)

## Requirements

- **Git 2.30 or newer** on your `PATH` (tested with 2.47).
- **Node.js 24** to build it (`.nvmrc` has the version; `nvm use` picks it up).
- Windows, macOS or Linux. Day-to-day development happens on Windows; please report anything that breaks elsewhere.

## Run it from source

```bash
git clone https://github.com/aautotte/caboose.git
cd caboose
nvm use          # or install Node 24 another way
npm ci
npm run dev
```

## Build your own launcher

No prebuilt binaries are published. You build your own copy:

```bash
npm ci
npm run dist
```

That builds for the system you're on, into `dist/`:

| system | what you get |
| --- | --- |
| Windows | `Caboose-Setup-<version>.exe` (installer: Start menu entry, uninstaller, no admin rights needed) and `Caboose-<version>-portable.exe` (one file, no install) |
| macOS | a `.dmg` (build it on a Mac) |
| Linux | an `.AppImage` (build it on Linux) |

Your build isn't code-signed, so the first launch shows a warning:

- **Windows:** "Windows protected your PC". Click **More info**, then **Run anyway**.
- **macOS:** right-click the app, choose **Open**, then **Open** again.

Settings, profiles and the repository list live in your user data folder (for example `%APPDATA%\Caboose`). They
survive reinstalls, and a newer build picks them up. Git still has to be installed, since Caboose uses yours.

Caboose used to be called Mergatroid. On its first start, Caboose copies your Mergatroid folder (for example
`%APPDATA%\Mergatroid`) into its own and notes it in `data-move.log` there. The old folder is left as it was, so you
can delete it yourself once you're happy.

## Tests

```bash
npm run typecheck
npm run e2e         # builds, then runs the Playwright end-to-end suite against throwaway repositories
```

The end-to-end tests launch the real app against repositories they create under `.seed/`, with their own home
folder and git config, so they never touch yours. A full run takes about ten minutes.

## Project layout

```
src/main/        Electron main process: git runner, repository operations, undo, IPC, settings (SQLite)
src/preload/     the bridge the window uses to call the main process
src/renderer/    the React app: screens, store, design primitives
src/shared/      types and the IPC contract shared by both sides
design/          design tokens (colour roles, type, spacing) for dark and light
scripts/         seed repositories, screenshots, token and icon generators, contrast check
tests/e2e/       Playwright end-to-end tests
resources/       the app icon (SVG masters and generated PNG / ICO)
```

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md). For security problems, see
[SECURITY.md](SECURITY.md) instead of opening a public issue.

## License

[MIT](LICENSE). Use it, change it, share it.
