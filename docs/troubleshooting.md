# Troubleshooting

First, look at the [Git activity log](everything-else.md#git-activity-log): it has the exact command that failed
and git's own message. Running that command in a terminal usually tells you whether the problem is in Caboose or in
git.

## Something works in the terminal but not in Caboose

Caboose runs the first `git` on your `PATH`, as it was when Caboose started. If you installed or updated git since,
restart Caboose. Check that `git --version` prints 2.30 or newer.

## Push or fetch asks for a password every time

Caboose passes sign-in to git, so set up a credential manager (Git Credential Manager comes with Git for Windows)
or use SSH. For SSH, add your public key to your git host: [Settings → SSH keys](settings.md#ssh-keys) lists your
keys and can make one.

Background fetch never asks for a password. If signing in fails, it waits for you to fetch by hand.

## "The repository changed outside the app"

Undo refuses when the repository isn't in the state the action left it in, for example after a commit in a
terminal. Nothing was changed. See [Undo](undo.md#when-caboose-refuses).

## Large files show up as tiny text files

The repository uses Git LFS and your git can't run it. See [Git LFS](lfs.md#if-lfs-isnt-set-up).

## The window is blank, or the app crashes on start

Turn off **Graphics acceleration** in [Settings](settings.md#general). If Caboose crashed with it on, it already
starts without it the next time.

## Building from source

### `npm run dev` stops with "Error: Electron uninstall"

The `electron` package is installed, but its binary isn't. Electron downloads it in an install script that runs
during `npm ci`, and that script didn't run, usually because npm is set to skip install scripts
(`npm config get ignore-scripts` prints `true`), or because `npm ci` was stopped before it finished. Run the script
yourself:

```bash
node node_modules/electron/install.js
npm run dev
```

If it can't download (behind a proxy, or offline), set `ELECTRON_MIRROR` to a mirror you can reach and run it again.
With `ignore-scripts` on, you need that first line again after each `npm ci`.

## Still stuck?

[Open an issue](https://github.com/aautotte/caboose/issues) with what you did, what happened, and the failing
command and output from the Git activity log (the copy button copies both).
