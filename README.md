# askpass-context

A sudo password dialog that tells you what you are approving.

`sudo -A` hands its askpass helper one thing: a prompt string. So the dialog you
get says "Password:" and nothing else — not the command, not the target user,
not the machine. If an agent or a script is driving sudo on your behalf, you are
typing your password blind.

This helper works the rest out on its own.

```
┌ sudo — glinet (ssh) ─────────────────────────────────┐
│ ⚠ This command is destructive.                       │
│                                                      │
│ Claude Code is asking to run a remote command as root│
│                                                      │
│   Where     glinet · GL.iNet router in the hallway   │
│   Host      root@192.168.8.1                         │
│   Run as    root                                     │
│   Command   sudo -S -- rm -rf /overlay/upper/etc     │
│                                                      │
│ Password  [___________________]                      │
│                        [ Cancel ] [ Run anyway ]     │
└──────────────────────────────────────────────────────┘
```

## How it knows

* **Locally** it walks up `/proc` from its own process until it finds the `sudo`
  that spawned it, then reads that process's command line, target user and
  working directory. No cooperation from the caller is needed.
* **Over ssh** the bundled MCP server passes a JSON context in the
  `ASKPASS_CONTEXT` environment variable, so the dialog can name the server, its
  description, the login and the exact remote command.
* If neither works it shows the original prompt, exactly like before.

## Install

Python 3 and `zenity` for the graphical dialog; `systemd-ask-password` or a tty
are used as fallbacks. No third-party packages.

```
git clone <this repo> ~/askpass-context
export SUDO_ASKPASS=~/askpass-context/askpass-context   # in ~/.profile or ~/.zshenv
sudo -A id
```

To register the MCP server:

```json
"sudo-ssh": {
  "type": "stdio",
  "command": "node",
  "args": ["/path/to/askpass-context/mcp/index.js"],
  "env": { "SUDO_ASKPASS": "/path/to/askpass-context/askpass-context" }
}
```

`cd mcp && npm install` first. Server definitions are read from an
ssh-manager style `~/.ssh-manager/.env` (`SSH_SERVER_<NAME>_HOST`, `_USER`,
`_PORT`, `_KEYPATH`, `_DESCRIPTION`).

## Behaviour worth knowing

* The dialog times out after 300 seconds, so a forgotten prompt cannot wedge the
  caller. Cancel, timeout and "nowhere to ask" are distinct exit codes (1, 5, 2)
  rather than one generic failure. `ASKPASS_TIMEOUT` overrides the 300.
* The remote side checks that the host answers on its ssh port before the dialog
  opens, so a machine that is down or a typo in the name costs you an error
  after ten seconds instead of a password prompt.
* Every request is logged to the journal under the `claude-sudo` tag: what was
  asked, where, and whether you allowed it. The password is never part of that.
* Commands that are hard to undo get a banner and an OK button labelled `Run
  anyway`. The list is deliberately short — it is a hint for the eye, not a
  policy engine.
* The password goes to stdout for sudo and, for the remote case, into the stdin
  of `sudo -S`. It is never an argument and never an environment variable.

## Licence

MIT.
