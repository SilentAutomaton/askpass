#!/usr/bin/env python3
"""Self-check for askpass. No framework: run it, read the asserts."""

import importlib.machinery
import importlib.util
import json
import os
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
# The helper has no .py suffix, so the loader has to be named explicitly.
_loader = importlib.machinery.SourceFileLoader("askpass_context", str(ROOT / "askpass"))
_spec = importlib.util.spec_from_loader(_loader.name, _loader)
ac = importlib.util.module_from_spec(_spec)
_loader.exec_module(ac)


def test_sudo_argv():
    cases = [
        (["sudo", "-A", "pacman", "-Syu"], "root", "pacman -Syu"),
        (["sudo", "-A", "-u", "postgres", "--", "psql", "-c", "select 1"],
         "postgres", "psql -c select 1"),
        (["sudo", "-A", "--", "rm", "-rf", "/tmp/x"], "root", "rm -rf /tmp/x"),
        (["sudo", "-upostgres", "whoami"], "postgres", "whoami"),
        (["sudo", "--user=deploy", "id"], "deploy", "id"),
        (["sudo", "-A", "-p", "custom prompt", "id"], "root", "id"),
        (["sudo"], "root", ""),
    ]
    for argv, want_user, want_cmd in cases:
        user, cmd = ac.parse_sudo_argv(argv)
        assert user == want_user, f"{argv}: user {user!r} != {want_user!r}"
        assert cmd == want_cmd, f"{argv}: command {cmd!r} != {want_cmd!r}"


def test_danger():
    dangerous = [
        "rm -rf /",
        "rm -rf /etc/nginx",
        "rm -fr /usr/local/lib",
        "mkfs.ext4 /dev/sda1",
        "dd if=/dev/zero of=/dev/sda",
        "reboot",
        "systemctl stop nginx",
        "pacman -Rns firefox",
        "iptables -F",
        "wg-quick down wg0",
        "cat x > /dev/sda",
        # the ssh side wraps the command before it reaches the dialog
        "sudo -S -- rm -rf /overlay/upper/etc",
        "sudo -S -u root -- systemctl stop nginx",
    ]
    harmless = [
        "rm -rf ./build",
        "rm -rf /home/silent/proj/code/x/node_modules",
        "rm -rf /tmp/scratch",
        "grep rm -rf file",
        "pacman -Syu",
        "systemctl status nginx",
        "dd if=/dev/urandom of=./sample.bin",
        "whoami",
        "sudo -S -- systemctl status nginx",
        "",
    ]
    for command in dangerous:
        assert ac.is_dangerous(command), f"should warn: {command!r}"
    for command in harmless:
        assert not ac.is_dangerous(command), f"should stay quiet: {command!r}"


def test_markup_is_escaped():
    ctx = {"kind": "local", "run_as": "root", "command": "echo a > b && c <i>x</i>"}
    text = ac.body(ctx, "")
    for raw in ("<i>", "&&", "> b"):
        assert raw not in text, f"unescaped {raw!r} in dialog text"
    assert "&lt;i&gt;" in text and "&amp;&amp;" in text


def test_clip():
    long_command = "echo " + "x" * 500
    shown = ac.clip(long_command)
    assert len(shown) <= ac.COMMAND_LIMIT
    assert shown.endswith("…")
    assert ac.clip("a  b\n c") == "a b c"


def test_context_env_wins():
    payload = {"kind": "ssh", "server": "vps", "host": "203.0.113.5",
               "login": "deploy", "run_as": "root", "command": "id"}
    os.environ["ASKPASS_CONTEXT"] = json.dumps(payload)
    try:
        ctx = ac.context()
        assert ctx["server"] == "vps" and ctx["kind"] == "ssh"
        os.environ["ASKPASS_CONTEXT"] = "{not json"
        assert ac.context().get("server") is None
    finally:
        os.environ.pop("ASKPASS_CONTEXT", None)


def test_caller_in_the_first_line():
    named = {"kind": "local", "caller": "ansible-playbook", "run_as": "root", "command": "id"}
    assert "ansible-playbook is asking to run a command as root." in ac.body(named, "")
    anonymous = {"kind": "local", "run_as": "root", "command": "id"}
    assert "A command is about to run as root." in ac.body(anonymous, "")
    remote = {"kind": "ssh", "caller": "claude", "run_as": "root", "command": "id"}
    assert "claude is asking to run a remote command as root." in ac.body(remote, "")
    assert "Claude Code" not in ac.body(named, "")


def test_titles_and_rows():
    ssh = {"kind": "ssh", "server": "glinet", "description": "router in the hallway",
           "host": "192.168.8.1", "login": "root", "port": 2222,
           "run_as": "root", "command": "id"}
    assert ac.title(ssh) == "sudo — glinet (ssh)"
    labels = dict(ac.rows(ssh))
    assert "router in the hallway" in labels["Where"]
    assert labels["Host"] == "root@192.168.8.1:2222"
    assert labels["Run as"] == "root"

    local = {"kind": "local", "run_as": "postgres", "command": "psql", "cwd": "/srv"}
    assert ac.title(local) == "sudo — this machine"
    assert dict(ac.rows(local))["Directory"] == "/srv"


def test_summary_has_no_password_field():
    ctx = {"kind": "ssh", "server": "vps", "run_as": "root", "command": "id"}
    line = ac.summary(ctx, "")
    assert "vps" in line and "root" in line and "\n" not in line


def main() -> int:
    tests = [value for name, value in sorted(globals().items()) if name.startswith("test_")]
    for test in tests:
        test()
        print(f"ok   {test.__name__}")
    print(f"{len(tests)} checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
