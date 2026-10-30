# Submodules

A submodule is another repository inside yours, pinned to one commit. Your repository records which commit: that's
the submodule's **pointer**.

Submodule handling is on by default. Turn off **Handle submodules** in [Settings](settings.md#submodules) to
leave them to git, as the `git` command does; Caboose then doesn't list them.

## The Submodules section

When the checked-out commit has submodules, the branches panel lists them. Each one is in one of these states:

| | |
| --- | --- |
| not set up | the folder is empty: its files haven't been downloaded |
| up to date | at the commit your repository expects |
| out of step | at another commit, for example after you pulled or switched branches |
| changes | it has uncommitted changes of its own |

Hover a submodule to see its path, the commit it's at, the commit it should be at and its mode.

**Set up** downloads a submodule; the button on the section header sets up all of them (once they're all set up,
it adds one). Right-click the header for **Add a submodule…**, **Set up all**, **Update all to the expected
commits**, **Submodule settings…** and **Remove all local copies…**.

A submodule's own menu has **Open** (in a new tab, as a repository of its own), **Update to the expected commit**,
**Mode**, **Show in folder**, **Change URL…**, **Copy path**, **Remove local copy…** and **Remove from the
repository…**. Removing the local copy empties the folder; it's refused while the submodule has uncommitted changes.

## Add, change or remove a submodule

Each of these changes `.gitmodules` and the pointer, and stages them: commit to share the change with others.

- **Add a submodule…**, in the section header's menu or the command palette (the only place while there are
  none): the repository's URL, the folder to put it in (filled in from the URL) and, if you like, a branch to follow. Caboose
  clones it there.
- **Change URL…**: where the submodule is cloned from, for example after the repository moved. If it's set up here,
  its own remote changes too.
- **Remove from the repository…**: deletes the submodule's folder and takes it out of `.gitmodules`; removing the
  last one removes `.gitmodules` too. It's refused while the submodule has uncommitted changes. Its history stays in
  `.git/modules`, since older commits still point at it, so adding a submodule in the same folder later gives it a
  name of its own.

## Modes

Each submodule has a mode. **Default mode** in Settings sets it for all of them; a submodule's **Mode** menu
overrides it.

| Mode | What it does |
| --- | --- |
| **Follow** | keeps it at the commit the branch expects: after a pull or a checkout, it moves there |
| **Manual** | only moves when you ask, with **Update to the expected commit** |
| **Working in it** | never moves it while it has changes or commits that aren't pushed, so your work there is safe |

## Pointer changes

When a submodule is at another commit than your repository records, it shows up in your changes like a file. Its
diff lists the commits the pointer moves by, and whether the submodule also has uncommitted changes
inside. If the submodule isn't set up, or doesn't have both commits yet, the diff says so: fetch inside it to see
them.

Committing a pointer that moves back to an older commit usually undoes someone else's update after a pull, so
Caboose asks first (**Warn about pointers moving back**).

Committing inside a submodule that isn't on a branch (a detached HEAD) is easy to lose: the next update moves it
away from those commits. Caboose asks first and offers to create a branch.

## Pushing

**Before pushing** in Settings decides what happens when your push points at submodule commits:

- **Check**: makes sure those commits are on the submodules' remotes, so others can set them up. If not, the push
  stops and says which.
- **Push submodules first**: pushes those submodules before your repository, when each is on a branch that tracks a remote.
- **Don't check**.

## Other settings

- **Set up as shallow copies**: downloads only the commit each submodule needs (`--depth 1`). Much smaller for big
  submodules, but without their history. The menus also offer the other choice for one setup.
- **Include nested submodules**: setting up or updating a submodule does the same for the submodules inside it.
- **Tidy up on checkout**: when the branch you switch to doesn't have a submodule, removes the folder git leaves
  behind, if nothing in it is uncommitted.
- **At once**: how many submodules are set up or updated at the same time (`submodule.fetchJobs`).
