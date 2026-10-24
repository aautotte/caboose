# Security

Mergatroid runs git on your repositories and passes credential prompts (HTTPS passwords, SSH passphrases) from git
to its window. A bug there could expose a secret or run something it shouldn't. Please report it privately.

## Reporting

Use GitHub's private reporting: the repository's **Security** tab, then **Report a vulnerability**. Please don't open
a public issue for it.

Include what you did, what happened, and the version or commit you were on. I'll reply as soon as I can.

## What Mergatroid does with secrets

- **It never stores a credential.** Saving passwords and tokens is left to git's own credential helper (for example
  Git Credential Manager) and to ssh-agent.
- **Prompts are passed straight through.** When git asks for a password or passphrase, the app shows the question.
  Your answer goes back to the waiting git process through a local pipe the app opens for its own helper. It isn't
  written to disk or logged.
- **The activity log never holds an answer.** It records each command's arguments and the end of its error output.
- **Commands run without a shell.** Git always gets an argument list, so repository paths, branch names and
  messages are never read as shell syntax.
- **Profiles store no secrets.** A profile's SSH key setting is a file name in `~/.ssh`, not the key itself.
