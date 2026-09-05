#!/usr/bin/env node
// Run one command under sudo on a remote host. The password is asked for
// locally through askpass-context, which is told what it is being asked for,
// and reaches the remote sudo through stdin only.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { spawn } from 'child_process';
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ASKPASS = process.env.SUDO_ASKPASS ?? join(HERE, '..', 'askpass-context');
const SSH_MANAGER_ENV = process.env.SSH_MANAGER_ENV ?? `${homedir()}/.ssh-manager/.env`;
const CONNECT_TIMEOUT = 10;

const ASKPASS_ERRORS = {
  1: 'declined by user',
  2: 'no way to ask for the password (no display, no tty)',
  5: 'password prompt timed out',
};

if (process.argv[2] === '--check') {
  console.log('askpass:', ASKPASS);
  console.log('servers:', Object.keys(loadSshManagerServers()).join(', ') || '(none)');
  process.exit(0);
}

function loadSshManagerServers() {
  try {
    const env = {};
    for (const line of readFileSync(SSH_MANAGER_ENV, 'utf8').split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) env[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
    }
    const servers = {};
    for (const key of Object.keys(env)) {
      const m = key.match(/^SSH_SERVER_([A-Z0-9_]+)_HOST$/);
      if (!m) continue;
      servers[m[1].toLowerCase()] = {
        host: env[`SSH_SERVER_${m[1]}_HOST`],
        user: env[`SSH_SERVER_${m[1]}_USER`],
        port: parseInt(env[`SSH_SERVER_${m[1]}_PORT`] ?? '22', 10),
        keyPath: env[`SSH_SERVER_${m[1]}_KEYPATH`],
        description: env[`SSH_SERVER_${m[1]}_DESCRIPTION`],
      };
    }
    return servers;
  } catch {
    return {};
  }
}

function askpass(prompt, context) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ASKPASS, [prompt], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ASKPASS_CONTEXT: JSON.stringify(context) },
    });
    let out = '';
    proc.stdout.on('data', d => (out += d));
    proc.on('error', reject);
    proc.on('close', code => {
      if (code === 0) return resolve(out.trimEnd());
      reject(new Error(ASKPASS_ERRORS[code] ?? `askpass failed (exit ${code})`));
    });
  });
}

function sshSudo({ server, description, host, user, port = 22, keyPath, command, sudoUser }) {
  const remote = sudoUser ? `sudo -S -u ${sudoUser} -- ${command}` : `sudo -S -- ${command}`;
  const args = [
    '-p', String(port),
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', 'PasswordAuthentication=no',
    '-o', `ConnectTimeout=${CONNECT_TIMEOUT}`,
    ...(keyPath ? ['-i', keyPath] : []),
    `${user}@${host}`,
    remote,
  ];

  const context = {
    kind: 'ssh',
    server, description, host, port,
    login: user,
    run_as: sudoUser || 'root',
    command: remote,
  };

  return askpass(`[sudo] password for ${user}@${host}: `, context).then(
    password =>
      new Promise((resolve, reject) => {
        const proc = spawn('ssh', args, { stdio: ['pipe', 'pipe', 'pipe'] });
        let stdout = '', stderr = '';
        proc.stdout.on('data', d => (stdout += d));
        proc.stderr.on('data', d => {
          const s = d.toString();
          if (!/\[sudo\]|password\s*:/i.test(s)) stderr += s;
        });
        proc.stdin.write(password + '\n');
        proc.stdin.end();
        proc.on('close', code => resolve({ code, stdout, stderr }));
        proc.on('error', reject);
      })
  );
}

const server = new McpServer({ name: 'sudo-ssh', version: '2.0.0' });

server.tool(
  'ssh_sudo_exec',
  'Execute a command with sudo on a remote host. Use `server` (name from ssh-manager config) OR explicit `host`+`user`. The password is asked for locally, in a dialog that names the host and the command, and never appears in tool arguments.',
  {
    server: z.string().optional().describe('Server name from ssh-manager config (e.g. "vps", "nanopi")'),
    host: z.string().optional().describe('SSH hostname or IP (if not using server name)'),
    user: z.string().optional().describe('SSH login user (if not using server name)'),
    command: z.string().describe('Command to run under sudo'),
    port: z.number().int().min(1).max(65535).optional().describe('SSH port override'),
    key_path: z.string().optional().describe('SSH private key path override'),
    sudo_user: z.string().optional().describe('Run as this user via sudo -u (default: root)'),
  },
  async ({ server: serverName, host, user, command, port, key_path, sudo_user }) => {
    try {
      let conn = { host, user, port, keyPath: key_path };

      if (serverName) {
        const servers = loadSshManagerServers();
        const srv = servers[serverName.toLowerCase()];
        if (!srv) {
          const known = Object.keys(servers).join(', ') || '(none loaded)';
          throw new Error(`Unknown server "${serverName}". Known: ${known}`);
        }
        conn = {
          ...srv,
          ...Object.fromEntries(
            Object.entries({ host, user, port, keyPath: key_path }).filter(([, v]) => v != null)
          ),
        };
      }

      if (!conn.host || !conn.user) throw new Error('Provide server name or both host and user');

      const { code, stdout, stderr } = await sshSudo({
        server: serverName, description: conn.description,
        host: conn.host, user: conn.user, port: conn.port,
        keyPath: conn.keyPath, command, sudoUser: sudo_user,
      });

      const parts = [stdout.trim(), stderr.trim() && `STDERR:\n${stderr.trim()}`, `exit code ${code}`];
      return { content: [{ type: 'text', text: parts.filter(Boolean).join('\n') }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

await server.connect(new StdioServerTransport());
