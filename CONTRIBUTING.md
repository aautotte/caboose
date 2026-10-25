# Contributing

Thanks for helping. Bug reports, fixes and features are all welcome.

## Getting set up

```bash
nvm use
npm ci
npm run dev
```

You need Git 2.30 or newer. `npm run seed` creates the demo repositories the tests and screenshots use, under
`.seed/` (ignored by git).

## Before you open a pull request

```bash
npm run typecheck
npm run e2e
```

- **Add or update an end-to-end test** for what you changed (`tests/e2e/`). Use roles and labels as selectors
  (`getByRole('button', { name: 'Stage all' })`), not CSS classes, so the tests check what a user can see.
- **Bug fixes start with a failing test.** Write the test, watch it fail, fix, watch it pass, and keep the test.
- **Keep a pull request to one change.** It's easier to review and to revert.

## How the code fits together

- **Everything git does goes through `GitRunner`** (`src/main/git/runner.ts`). It takes an argument list (never a
  shell string), queues writes per repository, and logs every command. Add new git operations to `RepoOps`
  (`src/main/git/ops.ts`).
- **The window talks to the main process through typed IPC channels.** Add a channel to `src/shared/api.ts` and a
  handler with a zod schema in `src/main/ipc/index.ts`.
- **Undo:** an action that changes history or discards work should be undoable. See `src/main/undo.ts`.

## Design rules

- **No raw colours or pixel values in components.** Use the tokens: Tailwind classes such as `bg-surface`,
  `text-muted` or `border-border`, or `var(--gc-…)`. A missing value goes into `design/tokens.json` and
  `tokens.light.json` first. Then run:

  ```bash
  npm run tokens     # regenerates the CSS
  npm run contrast   # every text and background pair must pass WCAG AA
  ```

- **Keyboard and screen readers count.** Every control needs a label and must be reachable by keyboard. The test
  suite runs an accessibility scan on each screen.
- **Writing:** plain words, git's own terms (commit, rebase, stash), and say what will happen. Light jokes are fine
  in empty states; errors, conflicts and anything destructive stay calm and clear.

## The icon

A friendly purple caboose whose cupola windows are its eyes, on rails that fork into commit dots, in the colours of
`design/tokens.json`, on a transparent background. `resources/icon.svg` is the master for 64 px and up,
`icon-small.svg` a close-up that fills the canvas for 48 px and below (the Windows taskbar's sizes), and `icon-macos.svg` the same artwork on Apple's rounded
tile, used only for the macOS `.icns`. After editing any of them, run
`npm run icons` to regenerate the PNG, ICO and ICNS files.

## License

By contributing, you agree that your contributions are released under the [MIT License](LICENSE).
