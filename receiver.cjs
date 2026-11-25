const http = require('http');
const fs = require('fs');

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  if (req.method === 'POST' && req.url === '/upload') {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const buf = Buffer.concat(chunks);
      const name = req.headers['x-name'] || 'upload.bin';
      fs.writeFileSync(name, buf);
      console.log('saved', name, buf.length);
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok ' + buf.length);
    });
    return;
  }
  res.writeHead(404);
  res.end('nope');
});

server.listen(3999, () => console.log('listening 3999'));
