import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAppServer, createWeekStore } from '../server.js';

test('local server serves planning and rejects retired photo endpoints', async () => {
  const server = createAppServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(base)).status, 200);
    assert.equal((await fetch(`${base}/api/status`)).status, 404);
    assert.equal((await fetch(`${base}/api/analyze-pantry`, { method: 'POST' })).status, 404);
    assert.equal((await fetch(`${base}/server.js`)).status, 404);
  } finally { server.close(); await once(server, 'close'); }
});

test('planning endpoint returns live-provider results without built-in recipes', async () => {
  let preferences;
  const server = createAppServer({
    ingredients: async () => ['Garlic','Milk'],
    plan: async options => { preferences=options; return [{ id:'42', title:'Fresh recipe', ingredients:[{name:'Tomato',measure:'2'}] }]; }
  });
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}`;
  try {
    assert.deepEqual(await (await fetch(`${base}/api/ingredients`)).json(),{ingredients:['Garlic','Milk']});
    const response=await fetch(`${base}/api/plan`,{method:'POST',headers:{origin:base,'content-type':'application/json'},body:JSON.stringify({diet:'all',lighter:true,avoid:['Garlic'],count:3})});
    assert.equal(response.status,200);
    assert.equal((await response.json()).recipes[0].title,'Fresh recipe');
    assert.deepEqual(preferences.avoid,['Garlic']);
    assert.equal(preferences.lighter,true);
    assert.equal(preferences.count,3);
    const invalidCount=await fetch(`${base}/api/plan`,{method:'POST',headers:{origin:base,'content-type':'application/json'},body:JSON.stringify({diet:'all',avoid:[],count:15})});
    assert.equal(invalidCount.status,400);
    const ideas=await fetch(`${base}/api/plan`,{method:'POST',headers:{origin:base,'content-type':'application/json'},body:JSON.stringify({diet:'all',avoid:[],count:14,exclude:['42']})});
    assert.equal(ideas.status,200);
    assert.deepEqual(preferences.exclude,['42']);
  } finally {server.close();await once(server,'close');}
});

test('shared week persists to JSON and rejects stale device saves', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kitchen-week-test-'));
  const file = join(directory, 'data', 'week.json');
  const server = createAppServer({ weekStore:createWeekStore(file) });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const week = {week:'2026-09-28',dinnerCount:1,servings:2,diet:'all',lighter:true,avoid:['Mushrooms'],pantry:['Milk'],empty:false,checked:{},recipes:[{id:'42',title:'Tomato pasta',ingredients:[{name:'Tomato',measure:'2'}]}]};
  const put = (revision, plan, origin=base) => fetch(`${base}/api/week`, {method:'PUT',headers:{origin,'content-type':'application/json'},body:JSON.stringify({revision,plan})});
  try {
    assert.deepEqual(await (await fetch(`${base}/api/week`)).json(), {revision:0,plan:null});
    assert.equal((await put(0, week, 'http://evil.example')).status, 403);
    assert.equal((await put(0, {...week, recipes:[{id:'42',title:'bad',ingredients:'invalid'}]})).status, 400);
    assert.equal((await put(0, {...week, shoppingRecipeIds:['not-in-this-week']})).status, 400);
    assert.equal((await put(0, week)).status, 200);
    assert.deepEqual(await (await fetch(`${base}/api/week`)).json(), {revision:1,plan:week});
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), {revision:1,plan:week});
    assert.equal((await put(0, {...week, checked:{tomato:true}})).status, 409);
    assert.equal((await put(1, {...week, shoppingRecipeIds:[], checked:{tomato:true}})).status, 200);
    assert.deepEqual(await createWeekStore(file).read(), {revision:2,plan:{...week,shoppingRecipeIds:[],checked:{tomato:true}}});
  } finally {
    server.close();await once(server,'close');
    await rm(directory,{recursive:true,force:true});
  }
});
