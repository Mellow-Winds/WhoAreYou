import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const root = process.cwd(), port = Number(process.env.PORT || 5173);
const mime = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.mjs':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8' };
const server = http.createServer(async (req, res) => {
  try {
    const name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    let file;
    if (name === '/') file = path.join(root, 'index.html');
    else if (name === '/vendor/relationship.mjs') file = path.join(root, 'node_modules/relationship.js/dist/relationship.min.mjs');
    else if (name === '/vendor/three/three.module.js') file = path.join(root, 'node_modules/three/build/three.module.js');
    else if (name === '/vendor/three/three.core.js') file = path.join(root, 'node_modules/three/build/three.core.js');
    else if (name === '/vendor/three/addons/controls/OrbitControls.js') file = path.join(root, 'node_modules/three/examples/jsm/controls/OrbitControls.js');
    else if (/^\/src\/[a-zA-Z0-9_-]+\.(js|css)$/.test(name)) file = path.join(root, name);
    else { res.writeHead(404); res.end('Not found'); return; }
    const content = await readFile(file);
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)], 'Cache-Control':'no-store' }); res.end(content);
  } catch (error) {
    res.writeHead(error.code === 'ENOENT' ? 404 : 500); res.end('Could not read application asset');
  }
});
server.listen(port, '127.0.0.1', () => console.log('WhoAreYou: http://localhost:' + port));
