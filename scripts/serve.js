#!/usr/bin/env node
/* Local static server for Arkham Grimoire. No dependencies.
   The page can't run from file://: CSS masks (every icon) are fetched in CORS
   mode, and file:// gives each file an opaque origin, so they never load.

   Usage: node scripts/serve.js [port]   (default 8777, next free port if taken)
   Set NO_OPEN=1 to skip opening the browser. */
'use strict';

var http = require('http');
var fs = require('fs');
var path = require('path');
var spawn = require('child_process').spawn;

var ROOT = path.resolve(__dirname, '..');
var START_PORT = parseInt(process.argv[2] || process.env.PORT || '8777', 10);
var HOST = '127.0.0.1';

var TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.txt': 'text/plain; charset=utf-8'
};

function send(res, status, body, type) {
  res.writeHead(status, { 'Content-Type': type || 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

var server = http.createServer(function (req, res) {
  var urlPath;
  try {
    urlPath = decodeURIComponent(req.url.split('?')[0].split('#')[0]);
  } catch (e) {
    return send(res, 400, 'Bad request');
  }

  var file = path.join(ROOT, urlPath);
  if (file !== ROOT && file.indexOf(ROOT + path.sep) !== 0) return send(res, 403, 'Forbidden');

  fs.stat(file, function (err, stat) {
    if (!err && stat.isDirectory()) file = path.join(file, 'index.html');
    // Same as the vercel.json rewrite: extensionless paths fall back to the app shell.
    else if (err && !path.extname(urlPath)) file = path.join(ROOT, 'index.html');

    fs.readFile(file, function (err2, data) {
      if (err2) return send(res, 404, 'Not found');
      send(res, 200, data, TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream');
    });
  });
});

function openBrowser(url) {
  if (process.env.NO_OPEN) return;
  var cmd, args;
  if (process.platform === 'win32') { cmd = 'cmd'; args = ['/c', 'start', '""', url]; }
  else if (process.platform === 'darwin') { cmd = 'open'; args = [url]; }
  else { cmd = 'xdg-open'; args = [url]; }
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true, windowsVerbatimArguments: true }).unref();
  } catch (e) { /* no browser launcher; the URL is printed anyway */ }
}

function listen(port, triesLeft) {
  server.once('error', function (err) {
    if (err.code === 'EADDRINUSE' && triesLeft > 0) return listen(port + 1, triesLeft - 1);
    console.error(err.message);
    process.exit(1);
  });
  server.listen(port, HOST, function () {
    var url = 'http://' + HOST + ':' + port + '/';
    console.log('Arkham Grimoire running at ' + url);
    console.log('Press Ctrl+C to stop.');
    openBrowser(url);
  });
}

listen(START_PORT, 20);
