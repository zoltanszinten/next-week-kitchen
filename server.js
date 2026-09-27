import http from 'node:http';
import { readFile, writeFile, rename, mkdir, rm } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { addMissingEstimates, ingredientNames, makePlan } from './meal-data.js';
import { cleanRecipe, importRecipeUrl } from './recipe-import.js';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC = join(ROOT, 'public');
const WEEK_FILE = join(ROOT, 'data', 'week.json');
const RECIPES_FILE = join(ROOT, 'data', 'recipes.json');
const MAX_BODY = 1024 * 1024;
const MAX_WEEK_BODY = 1024 * 1024;
const STATIC = new Map([
  ['/', ['index.html','text/html; charset=utf-8']],
  ['/index.html', ['index.html','text/html; charset=utf-8']],
  ['/styles.css', ['styles.css','text/css; charset=utf-8']],
  ['/ui.css', ['ui.css','text/css; charset=utf-8']],
  ['/app.js', ['app.js','text/javascript; charset=utf-8']]
]);

function privateIpv4(address) {
  const parts = address.replace(/^::ffff:/, '').split('.').map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 127 || parts[0] === 10 || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168) || (parts[0] === 169 && parts[1] === 254);
}

export function lanAddresses() {
  const adapters = Object.entries(networkInterfaces()).filter(([name]) => !/vEthernet|WSL|Docker|VirtualBox|VMware|VPN|Tailscale|WireGuard/i.test(name));
  return [...new Set(adapters.flatMap(([, items]) => items || []).filter(item => item.family === 'IPv4' && !item.internal && privateIpv4(item.address)).map(item => item.address))];
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function readBody(request, maxBytes = MAX_BODY) {
  const length = Number(request.headers['content-length'] || 0);
  if (length > maxBytes) throw new HttpError(413, 'Request is too large.');
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw new HttpError(413, 'Request is too large.');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new HttpError(400, 'Invalid JSON request.'); }
}

function validWeek(plan) {
  const shortStrings = (items, limit) => Array.isArray(items) && items.length <= limit && items.every(item => typeof item === 'string' && item.length <= 80);
  return plan && typeof plan === 'object' && /^\d{4}-\d{2}-\d{2}$/.test(plan.week) &&
    Number.isInteger(plan.dinnerCount) && plan.dinnerCount >= 1 && plan.dinnerCount <= 7 &&
    Number.isInteger(plan.servings) && plan.servings >= 1 && plan.servings <= 6 &&
    (plan.diet === undefined || ['all','vegetarian','no-fish'].includes(plan.diet)) && (plan.lighter === undefined || typeof plan.lighter === 'boolean') &&
    typeof plan.empty === 'boolean' && shortStrings(plan.avoid, 30) && shortStrings(plan.pantry, 100) &&
    (plan.shoppingRecipeIds === undefined || (Array.isArray(plan.shoppingRecipeIds) && plan.shoppingRecipeIds.length <= 7 && Array.isArray(plan.recipes) && plan.shoppingRecipeIds.every(id => typeof id === 'string' && plan.recipes.some(recipe => recipe?.id === id)) && new Set(plan.shoppingRecipeIds).size === plan.shoppingRecipeIds.length)) &&
    plan.checked && typeof plan.checked === 'object' && !Array.isArray(plan.checked) &&
    Object.entries(plan.checked).length <= 500 && Object.entries(plan.checked).every(([key,value]) => key.length <= 80 && typeof value === 'boolean') &&
    Array.isArray(plan.recipes) && plan.recipes.length <= 7 && plan.recipes.every(recipe => recipe && typeof recipe.id === 'string' && recipe.id.length <= 80 && typeof recipe.title === 'string' && recipe.title.length <= 200 && Array.isArray(recipe.ingredients) && recipe.ingredients.length <= 100 && recipe.ingredients.every(item => item && typeof item.name === 'string' && item.name.length <= 100 && typeof item.measure === 'string' && item.measure.length <= 100));
}

export function createWeekStore(file = WEEK_FILE) {
  let current;
  let writing = Promise.resolve();
  async function read() {
    if (!current) current = readFile(file, 'utf8').then(text => {
      const saved = JSON.parse(text);
      if (!Number.isInteger(saved.revision) || saved.revision < 1 || !validWeek(saved.plan)) throw new Error('Saved week is invalid.');
      return saved;
    }).catch(error => {
      if (error.code === 'ENOENT') return { revision:0, plan:null };
      throw error;
    });
    return current;
  }
  return {
    read,
    write(revision, plan) {
      const task = writing.then(async () => {
        const saved = await read();
        if (revision !== saved.revision) throw new HttpError(409, 'Another device changed the shared week. Reload it before saving.');
        if (!validWeek(plan) || Buffer.byteLength(JSON.stringify(plan)) > MAX_WEEK_BODY) throw new HttpError(400, 'The saved week is invalid or too large.');
        const next = { revision:revision + 1, plan };
        await mkdir(dirname(file), { recursive:true });
        const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
        try {
          await writeFile(temporary, JSON.stringify(next, null, 2), { flag:'wx' });
          await rename(temporary, file);
        } finally { await rm(temporary, { force:true }); }
        current = Promise.resolve(next);
        return next;
      });
      writing = task.catch(() => {});
      return task;
    }
  };
}

export function createRecipeStore(file = RECIPES_FILE) {
  let writing = Promise.resolve();
  async function read() {
    try { const recipes = JSON.parse(await readFile(file, 'utf8')); return Array.isArray(recipes) ? recipes : []; }
    catch(error) { if(error.code === 'ENOENT')return []; throw error; }
  }
  function change(apply) {
    const task=writing.then(async()=>{
      const current=await read(),next=apply(current);
      await mkdir(dirname(file),{recursive:true});
      const temporary=`${file}.${process.pid}.${Date.now()}.tmp`;
      try {await writeFile(temporary,JSON.stringify(next,null,2),{flag:'wx'});await rename(temporary,file);}
      finally {await rm(temporary,{force:true});}
      return next;
    });
    writing=task.catch(()=>{});return task;
  }
  return { read, change };
}

function sendJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, { 'content-type':'application/json; charset=utf-8', 'content-length':Buffer.byteLength(body), 'cache-control':'no-store', 'x-content-type-options':'nosniff' });
  response.end(body);
}

export function createAppServer({ ingredients = ingredientNames, plan = makePlan, weekStore = createWeekStore(), recipeStore = createRecipeStore(), importRecipe = importRecipeUrl, lan = false } = {}) {
  const allowedHosts = new Set(['127.0.0.1', 'localhost', ...(lan ? lanAddresses() : [])]);
  return http.createServer(async (request, response) => {
    try {
      const host = request.headers.host;
      const hostMatch = typeof host === 'string' && host.match(/^([^:]+):(\d+)$/);
      if (!hostMatch || !allowedHosts.has(hostMatch[1]) || (lan && !privateIpv4(request.socket.remoteAddress || ''))) throw new HttpError(403, 'Local network requests only.');
      const url = new URL(request.url, `http://${host}`);
      if (url.pathname.startsWith('/api/')) {
        if(url.pathname==='/api/recipes'&&request.method==='GET')return sendJson(response,200,{recipes:await recipeStore.read()});
        if(url.pathname==='/api/recipes/import'&&request.method==='POST'){
          if(request.headers.origin&&request.headers.origin!==`http://${host}`)throw new HttpError(403,'Cross-site requests are blocked.');
          if(!String(request.headers['content-type']||'').startsWith('application/json'))throw new HttpError(415,'Send JSON.');
          const input=await readBody(request);
          try{return sendJson(response,200,{recipe:await importRecipe(input?.url)});}
          catch(error){throw new HttpError(422,error.message||'Could not import this recipe.');}
        }
        if(url.pathname==='/api/recipes'&&request.method==='POST'){
          if(request.headers.origin&&request.headers.origin!==`http://${host}`)throw new HttpError(403,'Cross-site requests are blocked.');
          if(!String(request.headers['content-type']||'').startsWith('application/json'))throw new HttpError(415,'Send JSON.');
          let recipe;try{recipe=cleanRecipe(await readBody(request),`my:${crypto.randomUUID()}`);}catch(error){throw new HttpError(400,error.message);}
          await recipeStore.change(current=>{if(current.length>=200)throw new HttpError(400,'The recipe collection is full.');return [...current,recipe];});
          return sendJson(response,201,{recipe});
        }
        if(url.pathname.startsWith('/api/recipes/')&&(request.method==='PUT'||request.method==='DELETE')){
          if(request.headers.origin&&request.headers.origin!==`http://${host}`)throw new HttpError(403,'Cross-site requests are blocked.');
          const id=decodeURIComponent(url.pathname.slice('/api/recipes/'.length));
          if(!/^my:[a-f0-9-]{36}$/i.test(id))throw new HttpError(404,'Recipe not found.');
          let recipe;
          if(request.method==='PUT'){
            if(!String(request.headers['content-type']||'').startsWith('application/json'))throw new HttpError(415,'Send JSON.');
            try{recipe=cleanRecipe(await readBody(request),id);}catch(error){throw new HttpError(400,error.message);}
          }
          await recipeStore.change(current=>{const index=current.findIndex(item=>item.id===id);if(index<0)throw new HttpError(404,'Recipe not found.');const next=[...current];if(recipe)next[index]=recipe;else next.splice(index,1);return next;});
          return sendJson(response,200,recipe?{recipe}:{deleted:true});
        }
        if (url.pathname === '/api/week' && request.method === 'GET') return sendJson(response, 200, addMissingEstimates(await weekStore.read()));
        if (url.pathname === '/api/week' && request.method === 'PUT') {
          if (request.headers.origin && request.headers.origin !== `http://${host}`) throw new HttpError(403, 'Cross-site requests are blocked.');
          if (!String(request.headers['content-type'] || '').startsWith('application/json')) throw new HttpError(415, 'Send a JSON week.');
          const payload = await readBody(request, MAX_WEEK_BODY);
          if (!Number.isInteger(payload?.revision) || payload.revision < 0) throw new HttpError(400, 'The saved week is invalid.');
          return sendJson(response, 200, await weekStore.write(payload.revision, payload.plan));
        }
        if (url.pathname === '/api/ingredients' && request.method === 'GET') return sendJson(response, 200, { ingredients: await ingredients() });
        if (url.pathname === '/api/plan' && request.method === 'POST') {
          if (request.headers.origin && request.headers.origin !== `http://${host}`) throw new HttpError(403, 'Cross-site requests are blocked.');
          if (!String(request.headers['content-type'] || '').startsWith('application/json')) throw new HttpError(415, 'Send JSON preferences.');
          const payload = await readBody(request);
        if (!payload || (payload.diet !== undefined && !['all','vegetarian','no-fish'].includes(payload.diet)) || !Array.isArray(payload.avoid) || payload.avoid.length > 30 || payload.avoid.some(x => typeof x !== 'string' || x.length > 80) || (payload.count !== undefined && (!Number.isInteger(payload.count) || payload.count < 1 || payload.count > 14)) || (payload.exclude !== undefined && (!Array.isArray(payload.exclude) || payload.exclude.length > 100 || payload.exclude.some(x => typeof x !== 'string' || x.length > 30)))) throw new HttpError(400, 'Check the planning preferences.');
          let recipes;
          try { recipes = await plan({ ...payload, allowPartial: true }); }
          catch (error) { throw new HttpError(502, error.message || 'Could not find matching recipes.'); }
          return sendJson(response, 200, { recipes });
        }
        throw new HttpError(404, 'Endpoint not found.');
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') throw new HttpError(405, 'Method not allowed.');
      const asset = STATIC.get(url.pathname);
      if (!asset) throw new HttpError(404, 'Page not found.');
      const data = await readFile(join(PUBLIC, asset[0]));
      response.writeHead(200, { 'content-type':asset[1], 'content-length':data.length, 'cache-control':'no-store', 'x-content-type-options':'nosniff' });
      response.end(request.method === 'HEAD' ? undefined : data);
    } catch (error) {
      sendJson(response, error instanceof HttpError ? error.status : 500, { error: error instanceof HttpError ? error.message : 'Something went wrong.' });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535.');
  const lan = process.env.KITCHEN_LAN === '1';
  createAppServer({ lan }).listen(port, lan ? '0.0.0.0' : '127.0.0.1', () => {
    console.log(`Next Week Kitchen is ready at http://127.0.0.1:${port}`);
    if (lan) for (const address of lanAddresses()) console.log(`Open on a phone on the same home network: http://${address}:${port}`);
    console.log('Press Ctrl+C to stop the server.');
  });
}
