const MAX_HTML = 2_000_000;

function plain(html) {
  return String(html ?? '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => { const point = Number(code); return point <= 0x10ffff ? String.fromCodePoint(point) : ''; })
    .replace(/\s+/g, ' ').trim();
}

export function recipeUrl(value) {
  let url;
  try { url = new URL(String(value ?? '').trim()); } catch { throw new Error('Enter a full https recipe URL.'); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') ||
    !host.includes('.') || /^(?:localhost|\d+\.\d+\.\d+\.\d+|\[.*\])$/.test(host) ||
    /\.(?:local|internal|test|invalid|localhost)$/.test(host)) throw new Error('Use a public https recipe URL.');
  url.hash = '';
  return url.toString();
}

export function cleanRecipe(input, id) {
  const title = String(input?.title ?? '').trim();
  const source = input?.source ? recipeUrl(input.source) : '';
  const ingredients = Array.isArray(input?.ingredients) ? input.ingredients.map(item => ({
    name: String(item?.name ?? '').trim(), measure: String(item?.measure ?? '').trim(),
  })) : [];
  const baseServings = Number(input?.baseServings);
  const instructions = String(input?.instructions ?? '').trim();
  const area = String(input?.area ?? '').trim();
  const category = String(input?.category ?? '').trim();
  if (!title || title.length > 200) throw new Error('Add a recipe title (up to 200 characters).');
  if (!Number.isInteger(baseServings) || baseServings < 1 || baseServings > 50) throw new Error('Servings must be between 1 and 50.');
  if (!ingredients.length || ingredients.length > 80 || ingredients.some(item => !item.name || item.name.length > 100 || item.measure.length > 100)) throw new Error('Add 1–80 ingredients with names and optional amounts.');
  if (instructions.length > 10_000 || area.length > 80 || category.length > 80) throw new Error('Recipe text is too long.');
  return { id, title, source, ingredients, baseServings, instructions, area: area || 'My recipes', category: category || 'Homemade', image: '', kcal: null };
}

function ingredient(line) {
  const value = plain(line);
  const match = value.match(/^((?:kb\.?\s*)?(?:\d+(?:[.,]\d+)?(?:\s*[-–]\s*\d+(?:[.,]\d+)?)?|fél|egy|két)\s+(?:(?:közepes|nagy|kis)\s+)?(?:g|kg|dkg|ml|l|db|ek|tk|evőkanál|teáskanál|csipet|maréknyi|cup|cups|tbsp|tsp)\b)\s+(.+)$/i);
  return match ? { name: match[2], measure: match[1] } : { name: value, measure: '' };
}

function findRecipe(data, depth = 0) {
  if (!data || depth > 7) return null;
  if (Array.isArray(data)) return data.map(item => findRecipe(item, depth + 1)).find(Boolean) || null;
  if (typeof data !== 'object') return null;
  const types = Array.isArray(data['@type']) ? data['@type'] : [data['@type']];
  if (types.some(type => String(type).split('/').at(-1) === 'Recipe') && Array.isArray(data.recipeIngredient) && data.recipeIngredient.length) return data;
  return findRecipe(data['@graph'], depth + 1) || findRecipe(data.mainEntity, depth + 1);
}

function structured(html) {
  for (const match of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { const recipe = findRecipe(JSON.parse(match[1])); if (recipe) return recipe; } catch { /* Try the next block. */ }
  }
  return null;
}

function steps(value) {
  if (Array.isArray(value)) return value.map(item => plain(typeof item === 'string' ? item : item?.text ?? item?.name)).filter(Boolean).join('\n\n');
  return plain(typeof value === 'string' ? value : value?.text);
}

export function parseRecipeHtml(html, url) {
  const source = recipeUrl(url);
  const page = String(html ?? '');
  const metadata = structured(page);
  const host = new URL(source).hostname;
  let title = plain(metadata?.name || page.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || page.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]);
  let ingredients = (metadata?.recipeIngredient || []).map(ingredient);
  let instructions = steps(metadata?.recipeInstructions);
  let baseServings = Number(String(Array.isArray(metadata?.recipeYield) ? metadata.recipeYield[0] : metadata?.recipeYield ?? '').match(/\d+/)?.[0]);

  if (!ingredients.length && /(?:^|\.)streetkitchen\.hu$/i.test(host)) {
    const section = page.match(/<h3\b[^>]*>Hozzávalók<\/h3>([\s\S]*?)<h3\b[^>]*>Elkészítés<\/h3>/i)?.[1] || '';
    ingredients = [...section.matchAll(/<div class="my-2[^"<>]*">\s*<input\b[^>]*>\s*<div[^>]*>\s*<div>([\s\S]*?)<\/div>\s*<div class="font-bold">([\s\S]*?)<\/div>/gi)]
      .map(match => ({ measure: plain(match[1]), name: plain(match[2]) }));
    const prep = page.match(/<div[^>]*id="Streetk_content_preparation_wrapper"[^>]*>([\s\S]*?)<\/ol>/i)?.[1] || '';
    instructions = [...prep.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map(match => plain(match[1])).filter(Boolean).join('\n\n');
    title = plain(page.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]) || title;
  }
  if (!ingredients.length && /(?:^|\.)blogspot\.com$/i.test(host)) {
    const list = page.match(/Hozzávalók:\s*<\/strong>[\s\S]*?<\/p>\s*<ul\b[^>]*>([\s\S]*?)<\/ul>/i)?.[1] || '';
    ingredients = [...list.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map(match => ingredient(match[1].replace(/<br\s*\/?>(?:\s*<br\s*\/?>)?[\s\S]*$/i, ''))).filter(item => item.name);
    instructions = plain(page.match(/Hozzávalók:[\s\S]*?<\/ul>\s*<p\b[^>]*>([\s\S]*?)<\/p>/i)?.[1]);
    baseServings = Number(page.match(/(\d+)\s*fős adag/i)?.[1]);
    title = plain(page.match(/<h[12][^>]*class="[^"]*post-title[^"]*"[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i)?.[1]) || title;
  }
  if (!ingredients.length) throw new Error('This page did not expose ingredients. You can add the recipe manually and keep its URL.');
  return cleanRecipe({ title, source, ingredients, instructions, baseServings: baseServings >= 1 && baseServings <= 50 ? baseServings : 4,
    area: plain(metadata?.recipeCuisine) || 'My recipes', category: plain(metadata?.recipeCategory) || 'Homemade' }, '');
}

export async function importRecipeUrl(value, fetcher = fetch) {
  let url = recipeUrl(value);
  for (let redirects = 0; redirects < 3; redirects++) {
    const response = await fetcher(url, { redirect: 'manual', headers: { accept: 'text/html' }, signal: AbortSignal.timeout(9000) });
    if ([301, 302, 303, 307, 308].includes(response.status)) { url = recipeUrl(new URL(response.headers.get('location'), url)); continue; }
    if (!response.ok) throw new Error(`The recipe site returned ${response.status}. Add this recipe manually if the site blocks imports.`);
    if (!/text\/html|application\/xhtml\+xml/i.test(response.headers.get('content-type') || '')) throw new Error('That URL is not a recipe webpage.');
    if (Number(response.headers.get('content-length') || 0) > MAX_HTML) throw new Error('This recipe page is too large to import.');
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Could not read the recipe page.');
    const chunks = []; let length = 0;
    while (true) { const { done, value } = await reader.read(); if (done) break; length += value.byteLength; if (length > MAX_HTML) { await reader.cancel(); throw new Error('This recipe page is too large to import.'); } chunks.push(value); }
    const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return parseRecipeHtml(new TextDecoder().decode(bytes), url);
  }
  throw new Error('The recipe site redirected too many times.');
}
