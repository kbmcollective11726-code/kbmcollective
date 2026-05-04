#!/usr/bin/env node
/**
 * Launcher for Firebase MCP so Cursor can find firebase-tools regardless of MCP cwd.
 * @see https://firebase.google.com/docs/ai-assistance/mcp-server
 */
const path = require('path');
const { spawn } = require('child_process');

const firebaseJs = path.join(__dirname, '..', 'node_modules', 'firebase-tools', 'lib', 'bin', 'firebase.js');
const child = spawn(process.execPath, [firebaseJs, 'mcp'], {
  stdio: 'inherit',
  windowsHide: true,
});
child.on('exit', (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});
