const BASE = 'https://www.themealdb.com/api/json/v1/1/';

export const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

async function json(path, fetcher = fetch) {
  const response = await fetcher(BASE + path, { signal: AbortSignal.timeout(12000), headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`Recipe service returned ${response.status}.`);
  return response.json();
}

export async function ingredientNames(fetcher = fetch) {
  const data = await json('list.php?i=list', fetcher);
  return [...new Set((data.meals || []).map(row => String(row.strIngredient || '').trim()).filter(Boolean))].sort((a,b) => a.localeCompare(b));
}

const categories = ['Vegetarian', 'Vegan', 'Chicken', 'Beef', 'Pork', 'Pasta', 'Seafood', 'Miscellaneous', 'Lamb'];
const fishWords = /fish|salmon|tuna|prawn|shrimp|seafood|cod|anchov|sardine|mackerel|trout|haddock|squid|crab|lobster/i;
const meatWords = /beef|chicken|pork|lamb|turkey|bacon|ham|sausage|meat|duck|gelatine|gelatin/i;

export function ingredientsOf(raw) {
  const result = [];
  for (let i = 1; i <= 20; i++) {
    const name = String(raw[`strIngredient${i}`] || '').trim();
    if (name) result.push({ name, measure: String(raw[`strMeasure${i}`] || '').trim() });
  }
  return result;
}

// TheMealDB has no nutrition field. These coarse values support an explicitly rough estimate.
const kcal100 = [
  [/oil|butter|ghee|margarine/i, 800], [/sugar|honey|syrup|jam/i, 350],
  [/flour|rice|pasta|noodle|couscous|oat|bread|tortilla/i, 350],
  [/cheese|feta|parmesan/i, 330], [/cream|coconut milk/i, 230],
  [/beef|lamb|pork|bacon|sausage|mince/i, 230], [/chicken|turkey|fish|salmon|tuna|prawn|shrimp/i, 150],
  [/bean|lentil|chickpea/i, 120], [/egg/i, 143], [/milk|yogurt|yoghurt/i, 65],
  [/potato|sweet potato/i, 85], [/nut|seed|peanut/i, 550],
  [/tomato|onion|garlic|carrot|pepper|mushroom|spinach|broccoli|courgette|zucchini|lemon|lime|cucumber|lettuce|celery|aubergine|eggplant|cabbage|vegetable|herb|parsley|coriander/i, 40],
  [/salt|water|stock|vinegar|spice|paprika|cumin|curry|oregano|pepper/i, 10]
];

function amountGrams(measure, name) {
  const text = normalize(measure).replace(/½/g,' 1/2').replace(/¼/g,' 1/4').replace(/¾/g,' 3/4');
  const match = text.match(/^(\d+(?:\.\d+)?)(?:\s+(\d+)\/(\d+))?|^(\d+)\/(\d+)/);
  if (!match) return null;
  const number = match[4] ? Number(match[4])/Number(match[5]) : Number(match[1]) + (match[2] ? Number(match[2])/Number(match[3]) : 0);
  const unit = text.slice(match[0].length).trim();
  if (/^kg\b/.test(unit)) return number * 1000;
  if (/^(?:g|gram|grams)\b/.test(unit)) return number;
  if (/^ml\b/.test(unit)) return number;
  if (/^(?:l|litre|liter|litres|liters)\b/.test(unit)) return number * 1000;
  if (/tbsp|tablespoon/i.test(text)) return number * (/oil|butter|sugar|honey/i.test(name) ? 14 : 15);
  if (/tsp|teaspoon/i.test(text)) return number * 5;
  if (/cup/i.test(text)) return number * (/flour/i.test(name) ? 125 : /rice|oat/i.test(name) ? 185 : 220);
  if (/whole/i.test(unit) && /chicken|turkey|duck/i.test(name)) return number * 1200;
  if (/chicken breast|fish fillet|salmon fillet|beef steak/i.test(name) && !unit) return number * 180;
  if (/^chicken$/i.test(name) && !unit) return number * 1000;
  if (/egg/i.test(name)) return number * 55;
  if (/clove/i.test(text)) return number * 5;
  if (/slice/i.test(text)) return number * 30;
  if (/can|tin/i.test(text)) return number * 400;
  if (/pinch|dash/i.test(text)) return number * 1;
  if (/\d/.test(text) && text.length < 18) return number * (/onion|tomato|potato|carrot|lemon|pepper/i.test(name) ? 110 : 100);
  return null;
}

export function estimateKcal(ingredients) {
  let total = 0, known = 0;
  for (const item of ingredients) {
    const row = kcal100.find(([pattern]) => pattern.test(item.name));
    const grams = amountGrams(item.measure, item.name);
    if (row && grams !== null) { total += row[1] * grams / 100; known++; }
  }
  const coverage = ingredients.length ? known / ingredients.length : 0;
  return coverage >= 0.65 && total < 12000 ? Math.round(total / 4 / 25) * 25 : null;
}

export function recipeFromMeal(raw) {
  const ingredients = ingredientsOf(raw);
  return {
    id: String(raw.idMeal), title: String(raw.strMeal || '').trim(),
    category: String(raw.strCategory || '').trim(), area: String(raw.strArea || '').trim(),
    image: /^https:\/\//.test(raw.strMealThumb || '') ? raw.strMealThumb : '',
    source: /^https?:\/\//.test(raw.strSource || '') ? raw.strSource : `https://www.themealdb.com/meal/${raw.idMeal}`,
    instructions: String(raw.strInstructions || '').trim(), ingredients,
    kcal: estimateKcal(ingredients)
  };
}

function shuffle(values) {
  const array = [...values];
  for (let i = array.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [array[i], array[j]] = [array[j], array[i]]; }
  return array;
}

export function matchesPreferences(recipe, { diet = 'all', avoid = [] } = {}) {
  if (recipe.ingredients.length < 5 || ['Side','Starter','Dessert','Breakfast'].includes(recipe.category)) return false;
  if (/\b(?:pickle|pickled|deviled eggs?|dip|salsa|dressing|chutney|jam|padron peppers|patatas bravas|lollipop|onion rings|bruschetta|cake|cookies?|pudding|muffins?|biscuits?)\b/i.test(recipe.title)) return false;
  const all = recipe.ingredients.map(item => normalize(item.name));
  const text = [recipe.title, recipe.category, ...all].join(' ');
  if (diet === 'vegetarian' && (meatWords.test(text) || fishWords.test(text))) return false;
  if (diet === 'no-fish' && fishWords.test(text)) return false;
  return !avoid.some(term => {
    const needle = normalize(term).match(/\p{L}+/gu) || [];
    const same = (a,b) => a===b || a===`${b}s` || a===`${b}es` || b===`${a}s` || b===`${a}es`;
    return needle.length && all.some(name => {
      const words = name.match(/\p{L}+/gu) || [];
      return words.some((_,i) => needle.every((part,j) => words[i+j] && same(words[i+j],part)));
    });
  });
}

export async function makePlan(options = {}, fetcher = fetch) {
  const count = Number.isInteger(options.count) && options.count >= 1 && options.count <= 14 ? options.count : 7;
  const diet = ['all','vegetarian','no-fish'].includes(options.diet) ? options.diet : 'all';
  const avoid = Array.isArray(options.avoid) ? options.avoid.map(String).slice(0,30) : [];
  const previous = new Set(Array.isArray(options.previous) ? options.previous.map(String) : []);
  const exclude = new Set(Array.isArray(options.exclude) ? options.exclude.map(String).slice(0,100) : []);
  const poolCategories = diet === 'vegetarian' ? ['Vegetarian','Vegan'] : diet === 'no-fish' ? categories.filter(x => x !== 'Seafood') : categories;
  const pickedCategories = diet === 'vegetarian' ? poolCategories : diet === 'no-fish'
    ? ['Vegetarian','Vegan',...shuffle(poolCategories.filter(x => !['Vegetarian','Vegan'].includes(x))).slice(0,5)]
    : ['Vegetarian','Vegan','Seafood',...shuffle(poolCategories.filter(x => !['Vegetarian','Vegan','Seafood'].includes(x))).slice(0,4)];
  const listings = await Promise.allSettled([
    ...pickedCategories.map(async category => (await json(`filter.php?c=${encodeURIComponent(category)}`, fetcher)).meals || []),
    (async () => (await json('filter.php?a=Hungarian', fetcher)).meals || [])()
  ]);
  const hungarianListing = listings.at(-1);
  const hungarianIds = shuffle(hungarianListing.status === 'fulfilled' ? hungarianListing.value.map(row => String(row.idMeal)) : []);
  const buckets = listings.slice(0, -1).map(result => shuffle(result.status === 'fulfilled' ? result.value.map(row => String(row.idMeal)) : []));
  const ids = [], seenIds = new Set();
  for (const id of hungarianIds.splice(0, Math.min(8, count))) {
    if (id && !seenIds.has(id)) { ids.push(id); seenIds.add(id); }
  }
  buckets.push(hungarianIds);
  while (buckets.some(bucket => bucket.length)) for (const bucket of buckets) {
    const id = bucket.shift();
    if (id && !seenIds.has(id)) { ids.push(id); seenIds.add(id); }
  }
  if (!ids.length) throw new Error('The recipe API is unavailable right now. Try again shortly.');
  const pantry = Array.isArray(options.pantry) ? options.pantry.map(normalize).slice(0,100) : [];
  const target = Math.min(42, Math.max(8, count * 3));
  const chosen = [], seen = new Set();
  // Free Workers allow 50 external subrequests per invocation. Listings use at
  // most eight, leaving room for these lookups and possible provider redirects.
  for (let start = 0; start < ids.length && chosen.length < target && start < 36; start += 6) {
    const group = ids.slice(start, Math.min(start + 6, 36));
    const details = await Promise.allSettled(group.map(async id => (await json(`lookup.php?i=${id}`, fetcher)).meals?.[0]));
    for (const result of details) {
      if (result.status !== 'fulfilled' || !result.value) continue;
      const recipe = recipeFromMeal(result.value);
      if (!recipe.title || !recipe.ingredients.length || seen.has(recipe.id) || exclude.has(recipe.id) || !matchesPreferences(recipe, { diet, avoid })) continue;
      if (options.lighter && (recipe.kcal === null || recipe.kcal > 600)) continue;
      seen.add(recipe.id); chosen.push(recipe);
      if (chosen.length === target) break;
    }
  }
  if (chosen.length < count && !options.allowPartial) throw new Error(`Only ${chosen.length} matching recipes were available. Remove a restriction and try again.`);
  const score = recipe => recipe.ingredients.filter(item => pantry.some(name => normalize(item.name).includes(name) || name.includes(normalize(item.name)))).length;
  const ranked = shuffle(chosen).sort((a,b) => Number(previous.has(a.id))-Number(previous.has(b.id)) || score(b)-score(a));
  const selected = [], usedCategories = new Set();
  const hungarian = ranked.find(recipe => recipe.area === 'Hungarian');
  if (hungarian) {selected.push(hungarian);usedCategories.add(hungarian.category);}
  for (const recipe of ranked) if (!selected.includes(recipe) && !usedCategories.has(recipe.category)) { selected.push(recipe);usedCategories.add(recipe.category);if(selected.length===count)break; }
  for (const recipe of ranked) if (selected.length<count && !selected.includes(recipe)) selected.push(recipe);
  return shuffle(selected);
}
