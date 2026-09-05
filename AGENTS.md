# Working on askpass-context

Tier: 1

## What it is

A `SUDO_ASKPASS` helper that says what the password is for, and an MCP server
that runs one sudo command on a remote host through it. sudo hands an askpass
helper nothing but a prompt string, so the usual dialog can only say
"Password:". This one names the machine, the target user and the command, so
the person typing the password knows what they are approving.

## Running it

```
export SUDO_ASKPASS=/path/to/askpass-context
sudo -A pacman -Syu
```

The MCP server is registered as a stdio server running `mcp/index.js`.

## Checking it

```
python3 test/test_context.py          # parsing, escaping, danger patterns
python3 askpass-context --demo        # both dialogs, with sample data
node mcp/index.js --check             # askpass path and the servers it can see
```

## Rules

1. **The password never leaves stdout.** Not into a log line, not into an
   argument, not into an environment variable. Everything that is logged is
   built from the context, which never holds it.
2. The dialog text is Pango markup: escape anything that came from a command
   line before it reaches zenity.
3. The danger banner is a hint for the eye, not a security boundary. Do not
   grow it into a policy engine — the list stays short enough to read.
4. Nothing personal is committed. No hostnames, no keys, no `.env` contents.
   The repository ships examples only.

## Commits

One step, one commit. A single line of plain English describing what the code
now does. No tool names, no attribution trailers.
