#!/usr/bin/env node

import { createServer } from 'node:http';

const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 3001);
let nextId = 4;
let users = [
  {
    id: '1',
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    role: 'admin',
    status: 'active',
    createdAt: '2026-01-10T09:00:00.000Z',
  },
  {
    id: '2',
    name: 'Grace Hopper',
    email: 'grace@example.com',
    role: 'editor',
    status: 'active',
    createdAt: '2026-01-18T12:30:00.000Z',
  },
  {
    id: '3',
    name: 'Linus Torvalds',
    email: 'linus@example.com',
    role: 'viewer',
    status: 'suspended',
    createdAt: '2026-02-02T15:45:00.000Z',
  },
];

function writeJson(res, status, body) {
  res.writeHead(status, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Content-Type': 'application/json',
  });
  res.end(JSON.stringify(body));
}

function notFound(res) {
  writeJson(res, 404, { message: 'Not found' });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => {
      if (data.trim() === '') {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(data));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

const server = createServer(async (req, res) => {
  if (!req.url || !req.method) {
    notFound(res);
    return;
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    });
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${host}:${port}`);
  const userId = url.pathname.match(/^\/api\/users\/([^/]+)$/)?.[1];

  try {
    if (req.method === 'GET' && url.pathname === '/api/users') {
      writeJson(res, 200, users);
      return;
    }

    if (req.method === 'GET' && userId) {
      const user = users.find((entry) => entry.id === userId);
      if (!user) {
        notFound(res);
        return;
      }
      writeJson(res, 200, user);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/users') {
      const body = await readBody(req);
      const created = {
        id: String(nextId),
        status: 'active',
        createdAt: new Date().toISOString(),
        ...body,
      };
      nextId += 1;
      users = [...users, created];
      writeJson(res, 201, created);
      return;
    }

    if (req.method === 'PUT' && userId) {
      const existing = users.find((entry) => entry.id === userId);
      if (!existing) {
        notFound(res);
        return;
      }
      const body = await readBody(req);
      const updated = {
        ...existing,
        ...body,
        id: userId,
      };
      users = users.map((entry) => entry.id === userId ? updated : entry);
      writeJson(res, 200, updated);
      return;
    }

    if (req.method === 'DELETE' && userId) {
      users = users.filter((entry) => entry.id !== userId);
      writeJson(res, 204, {});
      return;
    }

    notFound(res);
  } catch (error) {
    writeJson(res, 500, {
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

server.listen(port, host, () => {
  console.log(`ReactDSL mock API listening on http://${host}:${port}`);
});
