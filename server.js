/**
 * Counter App - Built exclusively with Node.js built-in modules
 * No external dependencies, frameworks, or libraries.
 */

const http = require('http');
const fs = require('fs/promises');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');
const HTML_FILE = path.join(__dirname, 'public', 'index.html');

// Simple async queue / lock to guarantee safe sequential reads and writes
let fileLock = Promise.resolve();
function withLock(action) {
  const next = fileLock.then(action, action);
  fileLock = next.catch(() => {});
  return next;
}

/**
 * Reads the current counter value from data.json.
 * If the file does not exist, it initializes data.json with { "count": 0 }.
 * @returns {Promise<number>} Current count
 */
async function getCount() {
  return withLock(async () => {
    try {
      const data = await fs.readFile(DATA_FILE, 'utf-8');
      const parsed = JSON.parse(data);
      if (typeof parsed.count === 'number' && !Number.isNaN(parsed.count)) {
        return parsed.count;
      }
      // If corrupted or missing count field, reinitialize
      await fs.writeFile(DATA_FILE, JSON.stringify({ count: 0 }, null, 2), 'utf-8');
      return 0;
    } catch (err) {
      if (err.code === 'ENOENT') {
        // File does not exist yet; initialize with default count: 0
        await fs.writeFile(DATA_FILE, JSON.stringify({ count: 0 }, null, 2), 'utf-8');
        return 0;
      }
      throw err;
    }
  });
}

/**
 * Updates the counter value in data.json.
 * @param {number} newCount 
 * @returns {Promise<number>} Updated count
 */
async function setCount(newCount) {
  return withLock(async () => {
    await fs.writeFile(DATA_FILE, JSON.stringify({ count: newCount }, null, 2), 'utf-8');
    return newCount;
  });
}

/**
 * Helper utility to send JSON responses with appropriate headers
 * @param {http.ServerResponse} res 
 * @param {number} statusCode 
 * @param {object} payload 
 * @param {object} headers 
 */
function sendJson(res, statusCode, payload, headers = {}) {
  const jsonString = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(jsonString),
    ...headers
  });
  res.end(jsonString);
}

/**
 * Helper to safely parse optional JSON request bodies
 * @param {http.IncomingMessage} req 
 * @returns {Promise<object>}
 */
function parseJsonBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 50000) req.destroy(); // Limit payload size
    });
    req.on('end', () => {
      if (!body.trim()) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

/**
 * Main HTTP request handler
 */
const server = http.createServer(async (req, res) => {
  try {
    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    let pathname = parsedUrl.pathname;

    // Normalize path by stripping trailing slashes (except for root '/')
    if (pathname.length > 1 && pathname.endsWith('/')) {
      pathname = pathname.slice(0, -1);
    }

    const method = req.method.toUpperCase();

    // 1. Serve Front-end HTML
    if (pathname === '/') {
      if (method !== 'GET' && method !== 'HEAD') {
        return sendJson(res, 405, { error: 'Method Not Allowed' }, { Allow: 'GET, HEAD' });
      }

      try {
        const htmlContent = await fs.readFile(HTML_FILE, 'utf-8');
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Length': Buffer.byteLength(htmlContent)
        });
        return res.end(htmlContent);
      } catch (err) {
        return sendJson(res, 500, { error: 'Failed to load HTML file' });
      }
    }

    // 2. GET /count
    if (pathname === '/count') {
      if (method !== 'GET') {
        return sendJson(res, 405, { error: 'Method Not Allowed' }, { Allow: 'GET' });
      }
      const count = await getCount();
      return sendJson(res, 200, { count });
    }

    // 3. POST /increment (supports optional ?amount=X or JSON body { amount: X })
    if (pathname === '/increment') {
      if (method !== 'POST') {
        return sendJson(res, 405, { error: 'Method Not Allowed' }, { Allow: 'POST' });
      }
      const body = await parseJsonBody(req);
      const urlAmount = parseInt(parsedUrl.searchParams.get('amount') || parsedUrl.searchParams.get('step'), 10);
      const bodyAmount = typeof body.amount === 'number' ? body.amount : (typeof body.step === 'number' ? body.step : NaN);
      const step = (!Number.isNaN(urlAmount) && urlAmount > 0) ? urlAmount : ((!Number.isNaN(bodyAmount) && bodyAmount > 0) ? bodyAmount : 1);

      const current = await getCount();
      const count = await setCount(current + step);
      return sendJson(res, 200, { count, step });
    }

    // 4. POST /decrement (supports optional ?amount=X or JSON body { amount: X })
    if (pathname === '/decrement') {
      if (method !== 'POST') {
        return sendJson(res, 405, { error: 'Method Not Allowed' }, { Allow: 'POST' });
      }
      const body = await parseJsonBody(req);
      const urlAmount = parseInt(parsedUrl.searchParams.get('amount') || parsedUrl.searchParams.get('step'), 10);
      const bodyAmount = typeof body.amount === 'number' ? body.amount : (typeof body.step === 'number' ? body.step : NaN);
      const step = (!Number.isNaN(urlAmount) && urlAmount > 0) ? urlAmount : ((!Number.isNaN(bodyAmount) && bodyAmount > 0) ? bodyAmount : 1);

      const current = await getCount();
      const count = await setCount(current - step);
      return sendJson(res, 200, { count, step });
    }

    // 5. POST /reset
    if (pathname === '/reset') {
      if (method !== 'POST') {
        return sendJson(res, 405, { error: 'Method Not Allowed' }, { Allow: 'POST' });
      }
      const count = await setCount(0);
      return sendJson(res, 200, { count });
    }

    // 6. POST /set (allows setting a specific target count)
    if (pathname === '/set') {
      if (method !== 'POST') {
        return sendJson(res, 405, { error: 'Method Not Allowed' }, { Allow: 'POST' });
      }
      const body = await parseJsonBody(req);
      const urlVal = parseInt(parsedUrl.searchParams.get('value') || parsedUrl.searchParams.get('count'), 10);
      const targetVal = typeof body.value === 'number' ? body.value : (typeof body.count === 'number' ? body.count : (!Number.isNaN(urlVal) ? urlVal : 0));
      const count = await setCount(targetVal);
      return sendJson(res, 200, { count });
    }

    // 7. Unknown routes -> 404 Not Found
    return sendJson(res, 404, {
      error: 'Not Found',
      message: `The requested path '${pathname}' was not found on this server.`
    });

  } catch (err) {
    console.error('Internal Server Error:', err);
    return sendJson(res, 500, { error: 'Internal Server Error' });
  }
});

// Initialize data.json on start and listen for incoming connections
getCount()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`🚀 Counter server is running at http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Fatal initialization error:', err);
    process.exit(1);
  });
