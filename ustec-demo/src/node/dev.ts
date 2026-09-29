import { spawn, type ChildProcess } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

type Service = {
  child: ChildProcess;
  name: string;
};

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const services: Service[] = [];
let shuttingDown = false;

function start(name: string, command: string, args: string[]): void {
  const child = spawn(command, args, {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
  });

  services.push({ child, name });

  child.on('error', (err) => {
    console.error(`[dev] ${name} failed to start: ${err.message}`);
    shutdown(1);
  });

  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    console.error(`[dev] ${name} exited${signal != null ? ` by ${signal}` : ` with ${code ?? 0}`}`);
    shutdown(code == null ? 1 : code);
  });
}

function shutdown(code: number): void {
  if (shuttingDown) return;
  shuttingDown = true;
  process.exitCode = code;

  for (const { child } of services) {
    if (child.exitCode == null && child.signalCode == null) child.kill('SIGTERM');
  }

  setTimeout(() => {
    for (const { child } of services) {
      if (child.exitCode == null && child.signalCode == null) child.kill('SIGKILL');
    }
  }, 2000).unref();
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

start('api', process.execPath, ['--import', 'tsx', 'src/node/serve.ts']);
start('vite', process.execPath, ['node_modules/vite/bin/vite.js']);
