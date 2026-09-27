import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanRecipe, importRecipeUrl, parseRecipeHtml, recipeUrl } from '../recipe-import.js';

test('imports Nosalty Recipe data and Hungarian amounts', () => {
  const html = `<script type="application/ld+json">${JSON.stringify({ '@type': 'Recipe', name: 'Szaftos paprikás csirke', recipeYield: 4,
    recipeIngredient: ['1 db Csirke feldarabolva', '1.5 ek Sertészsír', '0 ízlés szerint Só'], recipeInstructions: ['A hagymát felvágjuk.', 'Főzzük.'] })}</script>`;
  const recipe = parseRecipeHtml(html, 'https://www.nosalty.hu/recept/szaftos-paprikas-csirke');
  assert.equal(recipe.title, 'Szaftos paprikás csirke');
  assert.deepEqual(recipe.ingredients[0], { name: 'Csirke feldarabolva', measure: '1 db' });
  assert.deepEqual(recipe.ingredients[2], { name: 'Só', measure: 'ízlés szerint' });
  assert.equal(recipe.baseServings, 4);
  assert.match(recipe.instructions, /Főzzük/);
});

test('imports Street Kitchen page ingredient markup when metadata omits ingredients', () => {
  const html = `<h1>Palacsintatészta</h1><script type="application/ld+json">{"@type":"Recipe","name":"Palacsinta"}</script>
    <h3>Hozzávalók</h3><div class="my-2 flex items-center gap-2 text-lg"><input type="checkbox"><div><div>250<!-- --> g</div><div class="font-bold">finomliszt</div></div></div>
    <h3>Elkészítés</h3><div id="Streetk_content_preparation_wrapper"><ol><li><p>Keverjük össze.</p></li></ol>`;
  const recipe = parseRecipeHtml(html, 'https://streetkitchen.hu/receptek/palacsinta');
  assert.deepEqual(recipe.ingredients, [{ name: 'finomliszt', measure: '250 g' }]);
  assert.equal(recipe.instructions, 'Keverjük össze.');
});

test('imports an older Blogger ingredient list', () => {
  const html = `<h2 class="post-title entry-title"><a href="/">GÖRÖG TÉSZTASALÁTA</a></h2><p><strong>Hozzávalók:</strong></p>
    <ul><li>20 dkg fusili</li><li>pár szem koktélparadicsom<br><br>az öntethez:</li></ul><p>Főzzük meg a tésztát.</p><p>3 fős adag.</p>`;
  const recipe = parseRecipeHtml(html, 'https://lillafoz.blogspot.com/2009/06/gorog-tesztasalata.html');
  assert.equal(recipe.title, 'GÖRÖG TÉSZTASALÁTA');
  assert.deepEqual(recipe.ingredients[0], { name: 'fusili', measure: '20 dkg' });
  assert.equal(recipe.ingredients[1].name, 'pár szem koktélparadicsom');
  assert.equal(recipe.baseServings, 3);
});

test('Blogger document title overrides the site header when post markup differs', () => {
  const html = '<title>Görög tésztasaláta ~ Lilla főz</title><h1>Lilla főz</h1><p><strong>Hozzávalók:</strong></p><ul><li>20 dkg fusili</li></ul>';
  assert.equal(parseRecipeHtml(html, 'https://lillafoz.blogspot.com/2009/06/gorog-tesztasalata.html').title, 'Görög tésztasaláta');
});

test('URL import rejects local targets and follows a public redirect', async () => {
  assert.throws(() => recipeUrl('https://127.0.0.1/private'));
  assert.throws(() => recipeUrl('http://example.com/recipe'));
  const calls = [];
  const fetched = await importRecipeUrl('https://recipes.example/page', async url => {
    calls.push(url);
    if (calls.length === 1) return new Response(null, { status: 302, headers: { location: '/final' } });
    return new Response(`<script type="application/ld+json">{"@type":"Recipe","name":"Pasta","recipeIngredient":["200 g pasta"]}</script>`, { headers: { 'content-type': 'text/html' } });
  });
  assert.equal(fetched.ingredients[0].name, 'pasta');
  assert.equal(calls[1], 'https://recipes.example/final');
  assert.throws(() => cleanRecipe({ title: 'Bad', baseServings: 4, ingredients: [] }, 'x'));
});
