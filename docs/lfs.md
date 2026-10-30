# Git LFS

[Git LFS](https://git-lfs.com) keeps large files (images, videos, datasets) outside the repository's history. The
repository stores a small pointer file; LFS downloads the real content when you check out.

Caboose uses the `git lfs` installed with your git. It doesn't bundle one.

## If LFS isn't set up

When a repository keeps files in LFS but your git can't run it, a notice under the toolbar says so. Without LFS,
large files show up as small pointer files, and new ones would be committed whole.

- If LFS is installed but not turned on, **Turn on Git LFS** runs `git lfs install` (for all your repositories),
  then `git lfs pull` in this one.
- If it isn't installed, install it from [git-lfs.com](https://git-lfs.com) (or your package manager), then click
  **Check again**.

## Seeing LFS files

- Files stored in LFS have an **LFS** badge in the file lists.
- Their diff says how the file changed instead of showing the pointer text: for example `1.2 MB → 1.4 MB`, a new
  file of a given size, or a deleted one.

## Tracking files

Right-click a file in the changes list:

- **Track with Git LFS**: just this file, or all files with its extension (`*.psd`). Caboose adds the rule to
  `.gitattributes`.
- **Stop tracking *rule* with Git LFS**: removes the rule from `.gitattributes`.

If a file is tracked by a rule in another `.gitattributes` (in a subfolder, say), the menu says so instead.

Commit `.gitattributes` along with the files, so everyone who clones gets the same rules.
