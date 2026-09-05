# sudo-ssh MCP server

One tool, `ssh_sudo_exec`: run a single command under `sudo` on a remote host.
The password is asked for **locally**, through [`../askpass`](../askpass), in a
dialog that names the server, the login, the target user and the exact command
that will run. It then goes into the stdin of the remote `sudo -S`. It is never
an argument and never an environment variable.

See the [main README](../README.md) for the dialog, the config snippet and the
`.env` format.

## Read this before you wire it up

This gives whatever drives the MCP client a path to **root on every machine in
your server list**. The only thing standing between a request and that root
shell is a person reading a dialog and deciding.

That is a real decision, not a formality:

* The destructive-command banner is a short pattern list. It is a hint, not a
  gate, and it is trivially avoided.
* Approving a command you did not read is the same as having no dialog at all.
* If the client's input can be influenced by anything untrusted — a web page, a
  file in a repository, a message — then the dialog is the last line, and it is
  the line that depends on your attention.

Use it on machines where you would be comfortable handing over a root shell, and
read the command every time. If that sounds like too much, do not install it —
that is a reasonable answer.

## Behaviour

* The ssh port is probed before the dialog opens, so an unreachable host fails in
  ten seconds instead of costing a password prompt.
* Askpass exit codes are turned into distinct errors: declined, timed out, or
  nowhere to ask.
* The result always carries the remote exit code.

## Check it

```sh
npm install
node index.js --check
```
