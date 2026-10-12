const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const host = '127.0.0.1';
const port = Number(process.env.PORT || 4173);
const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, `http://${host}:${port}`).pathname);
  } catch {
    res.writeHead(400).end('Bad request');
    return;
  }

  const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const filePath = path.resolve(root, relativePath);
  if (filePath !== root && !filePath.startsWith(root + path.sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  fs.stat(filePath, (statError, stats) => {
    const resolvedPath = !statError && stats.isDirectory()
      ? path.join(filePath, 'index.html')
      : filePath;

    fs.readFile(resolvedPath, (readError, content) => {
      if (readError) {
        res.writeHead(readError.code === 'ENOENT' ? 404 : 500, {
          'Content-Type': 'text/plain; charset=utf-8',
        }).end(readError.code === 'ENOENT' ? 'Not found' : 'Server error');
        return;
      }

      res.writeHead(200, {
        'Content-Type': mimeTypes[path.extname(resolvedPath).toLowerCase()] || 'application/octet-stream',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(content);
    });
  });
}).listen(port, host, () => {
  console.log(`GCC Location Decision Brief running at http://${host}:${port}`);
  console.log('Press Ctrl+C to stop the local server.');
});
