# Bisect

Something worked before and doesn't now. Bisect finds the first commit where it broke, by checking out commits
halfway between a good one and a bad one until only one is left. With 1,000 commits in between, that's about ten
tries.

## Start

Either:

- **Find the commit that broke something (bisect)…** in the command palette; or
- **Bisect: this commit is bad…** or **Bisect: this commit is good…** in a commit's menu.

Fill in:

- **Bad: has the problem**: a branch, tag or SHA. Usually where you are now.
- **Good: before the problem**: an older commit that worked, such as the last release's tag.
- **Test each step with a command (optional)**: see below.

Commit or stash your changes first: bisect checks out other commits.

## By hand

A bar under the toolbar shows the commit being tested and about how many steps are left. Build it, run it, try
it, then say how it was:

| | key |
| --- | --- |
| **Good** | G |
| **Bad** | B |
| **Skip**: can't test this one, for example it doesn't build | S |

You can also mark any commit from its menu in the graph: **Bisect: mark as good**, **mark as bad**, **skip it**.

## With a command

Give a command that exits with 0 when the commit is good and anything else when it's bad, for example `npm test`
or `./check.sh`. Git runs it on each step until it finds the first bad commit (`git bisect run`). **Show output**
shows what the command printed. **Cancel** stops it; the answers so far are kept.

You can also start by hand and switch to a command partway, with **Run a command…** in the bar.

## The result

When bisect finds the first bad commit, the bar names it. **Show it** selects it in the graph, **Copy SHA** copies
it, and **Back to *branch*** ends bisect and checks out the branch you started on. **Stop** does the same while
you're still testing.

A bisect started in a terminal shows up in Caboose too, with the same bar. If it uses other words than good and
bad (`git bisect start --term-old=… --term-new=…`), the buttons use them.
