import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateKcal, recipeFromMeal, matchesPreferences, makePlan } from '../meal-data.js';

const meal = (id, ingredients, category='Vegetarian') => ({idMeal:String(id),strMeal:`Meal ${id}`,strCategory:category,strInstructions:'Cook everything.',...Object.fromEntries(ingredients.flatMap(([name,measure],i)=>[[`strIngredient${i+1}`,name],[`strMeasure${i+1}`,measure]]))});

test('ingredient avoidance filters recipes before planning', async () => {
  const names = Array.from({length:16},(_,i)=>({idMeal:String(i+1)}));
  const fetcher = async url => ({ok:true,json:async()=>url.includes('filter.php')?{meals:names}:{meals:[meal(new URL(url).searchParams.get('i'),[['Garlic','2 cloves'],['Rice','200g'],['Tomato','2'],['Carrot','1'],['Onion','1']])]}});
  await assert.rejects(makePlan({diet:'vegetarian',avoid:['garlic'],lighter:false},fetcher),/Only 0 matching recipes/);
  const result = await makePlan({diet:'vegetarian',avoid:['milk'],lighter:false},fetcher);
  assert.equal(result.length,7);
  assert(result.every(recipe=>recipe.ingredients.some(item=>item.name==='Garlic')));
});

test('nutrition stays approximate and attached units parse correctly', () => {
  const estimate=estimateKcal([{name:'Rice',measure:'200g'},{name:'Tomato',measure:'2'}]);
  assert(estimate>100 && estimate<300);
  const recipe=recipeFromMeal(meal(5,[['Rice','200g'],['Tomato','2'],['Carrot','1'],['Onion','1'],['Salt','1 tsp']]));
  assert(recipe.kcal > estimate);
  assert.equal(matchesPreferences(recipe,{avoid:['rice']}),false);
  assert.equal(matchesPreferences(recipe,{avoid:['chicken']}),true);
  assert.equal(matchesPreferences({...recipe,title:'Red onion pickle'},{avoid:[]}),false);
  assert.equal(matchesPreferences({...recipe,ingredients:[...recipe.ingredients,{name:'Eggplant',measure:'1'}]},{avoid:['egg']}),true);
});


test('a single replacement excludes recipes already in the week', async () => {
  const names=Array.from({length:16},(_,i)=>({idMeal:String(i+1)}));
  const fetcher=async url=>({ok:true,json:async()=>url.includes('filter.php')?{meals:names}:{meals:[meal(new URL(url).searchParams.get('i'),[['Rice','200g'],['Tomato','2'],['Carrot','1'],['Onion','1'],['Salt','1 tsp']])]}});
  const result=await makePlan({diet:'vegetarian',count:1,previous:['1','2','3']},fetcher);
  assert.equal(result.length,1);
  assert(!['1','2','3'].includes(result[0].id));
});

test('planning returns the requested number of dinners', async () => {
  const names=Array.from({length:40},(_,i)=>({idMeal:String(i+1)}));
  const fetcher=async url=>({ok:true,json:async()=>url.includes('filter.php')?{meals:names}:{meals:[meal(new URL(url).searchParams.get('i'),[['Rice','200g'],['Tomato','2'],['Carrot','1'],['Onion','1'],['Salt','1 tsp']])]}});
  assert.equal((await makePlan({diet:'all',count:3},fetcher)).length,3);
  assert.equal((await makePlan({diet:'all',count:6},fetcher)).length,6);
  const refreshed=await makePlan({diet:'all',count:14,exclude:['1','2','3','4','5']},fetcher);
  assert.equal(refreshed.length,14);
  assert(refreshed.every(recipe=>!['1','2','3','4','5'].includes(recipe.id)));
});

test('a partial search stays within the Free Worker outbound request budget', async () => {
  const names=Array.from({length:100},(_,i)=>({idMeal:String(i+1)}));
  let calls=0;
  const fetcher=async url=>{
    calls++;
    return {ok:true,json:async()=>url.includes('filter.php')?{meals:names}:{meals:[meal(new URL(url).searchParams.get('i'),[['Rice','200g'],['Tomato','2'],['Onion','1'],['Salt','1 tsp']])]}};
  };
  const result=await makePlan({diet:'all',count:6,allowPartial:true},fetcher);
  assert.deepEqual(result,[]);
  assert(calls<=44,`Expected at most 44 outbound calls, got ${calls}`);
});

test('unknown calories do not exclude a dinner unless lighter meals were requested', async () => {
  const names=Array.from({length:10},(_,i)=>({idMeal:String(i+1)}));
  const fetcher=async url=>({ok:true,json:async()=>url.includes('filter.php')?{meals:names}:{meals:[meal(new URL(url).searchParams.get('i'),[['Rice','some'],['Tomato','some'],['Onion','some'],['Carrot','some'],['Salt','some']])]}});
  assert.equal((await makePlan({diet:'all',count:3},fetcher)).length,3);
  assert.deepEqual(await makePlan({diet:'all',count:3,lighter:true,allowPartial:true},fetcher),[]);
});

test('an available Hungarian dinner is checked early and included', async () => {
  const names=Array.from({length:100},(_,i)=>({idMeal:String(i+1)}));
  const fetcher=async url=>{
    const path=new URL(url);
    if(path.pathname.endsWith('filter.php'))return {ok:true,json:async()=>({meals:path.searchParams.get('a')==='Hungarian'?[{idMeal:'999'}]:names})};
    const id=path.searchParams.get('i');
    const raw=meal(id,[['Rice','200g'],['Tomato','2'],['Onion','1'],['Carrot','1'],['Salt','1 tsp']]);
    if(id==='999')raw.strArea='Hungarian';
    return {ok:true,json:async()=>({meals:[raw]})};
  };
  const result=await makePlan({diet:'all',count:6},fetcher);
  assert(result.some(recipe=>recipe.id==='999'));
});
