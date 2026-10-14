import http from 'node:http';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const children = [
  spawn(process.execPath, ['dist/main.js'], { cwd: resolve(root, 'apps/api'), env: { ...process.env, API_HOST: '127.0.0.1', API_PORT: '4000', TRUST_PROXY_HOPS: '1' }, stdio: 'inherit' }),
  spawn(process.execPath, ['dist/server.js'], { cwd: resolve(root, 'apps/collaboration'), env: { ...process.env, COLLABORATION_HOST: '127.0.0.1', COLLABORATION_PORT: '1234' }, stdio: 'inherit' }),
];
let stopping = false;
const gateway = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/ready') {
    Promise.all([4000, 1234].map(port => fetch(`http://127.0.0.1:${port}/ready`, { signal: AbortSignal.timeout(15000) })))
      .then(results => { res.writeHead(results.every(r => r.ok) ? 200 : 503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify({ status: results.every(r => r.ok) ? 'ok' : 'unavailable' })); })
      .catch(() => { res.writeHead(503); res.end('Unavailable'); });
    return;
  }
  if (!url.pathname.startsWith('/api/')) { res.writeHead(404); res.end('Not found'); return; }
  const headers = { ...req.headers, 'x-forwarded-for': req.socket.remoteAddress, 'x-forwarded-proto': 'https' };
  const upstream = http.request({ hostname: '127.0.0.1', port: 4000, path: req.url.slice(4), method: req.method, headers }, response => {
    res.writeHead(response.statusCode, response.headers); response.pipe(res);
  });
  upstream.setTimeout(45000, () => upstream.destroy());
  upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end('Backend unavailable'); });
  req.on('aborted', () => upstream.destroy());
  req.pipe(upstream);
});
gateway.on('upgrade', (req, socket, head) => {
  if (new URL(req.url, 'http://localhost').pathname !== '/sync' || req.headers.origin !== process.env.APP_ORIGIN) {
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return;
  }
  const upstream = http.request({ hostname: '127.0.0.1', port: 1234, path: req.url, method: 'GET', headers: req.headers });
  upstream.on('upgrade', (response, remote, remoteHead) => {
    socket.write(`HTTP/1.1 ${response.statusCode} ${response.statusMessage}\r\n`);
    for (const [name, value] of Object.entries(response.headers)) socket.write(`${name}: ${value}\r\n`);
    socket.write('\r\n'); if (remoteHead.length) socket.write(remoteHead); if (head.length) remote.write(head);
    socket.pipe(remote); remote.pipe(socket);
    socket.on('error', () => remote.destroy()); remote.on('error', () => socket.destroy());
    socket.on('close', () => remote.destroy()); remote.on('close', () => socket.destroy());
  });
  upstream.on('response', response => { socket.end(`HTTP/1.1 ${response.statusCode} Rejected\r\nConnection: close\r\n\r\n`); response.resume(); });
  upstream.on('error', () => socket.destroy()); upstream.end();
});
gateway.listen(Number(process.env.PORT ?? 10000), '0.0.0.0');
function stop(code = 0) {
  if (stopping) return; stopping = true;
  gateway.close(); for (const child of children) child.kill('SIGTERM');
  Promise.all(children.map(child => child.exitCode !== null ? Promise.resolve() : new Promise(resolve => child.once('exit', resolve)))).then(() => process.exit(code));
  setTimeout(() => process.exit(code), 55000).unref();
}
for (const child of children) { child.on('error', () => stop(1)); child.on('exit', () => { if (!stopping) stop(1); }); }
process.on('SIGTERM', () => stop()); process.on('SIGINT', () => stop());
