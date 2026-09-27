(() => {
  'use strict';
  const KEY = 'next-week-kitchen-v2';
  const DEFAULT_AVOID = ['Mushrooms','Tofu','Cabbage'];
  const DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
  const LEGACY_PANTRY_NAMES = {chicken:'Chicken',mince:'Minced meat',tuna:'Tuna',salmon:'Salmon',egg:'Eggs',sourcream:'Sour cream',cream:'Cream',milk:'Milk',cheese:'Cheese',feta:'Feta',butter:'Butter',pasta:'Pasta',rice:'Rice',tortilla:'Tortillas',lentils:'Lentils',beans:'Beans',chickpeas:'Chickpeas',tomatoesCan:'Canned tomatoes',passata:'Passata',stock:'Stock',flour:'Flour',oil:'Oil',paprika:'Paprika',cumin:'Cumin',curry:'Curry powder',oregano:'Oregano',pepper:'Black pepper',salt:'Salt',potato:'Potatoes',onion:'Onion',garlic:'Garlic',carrot:'Carrots',pepperFresh:'Bell pepper',mushroom:'Mushrooms',spinach:'Spinach',broccoli:'Broccoli',courgette:'Courgette',lemon:'Lemon',tomato:'Tomatoes',cucumber:'Cucumber'};
  const $ = id => document.getElementById(id);
  const el = {
    home:$('homeView'), wizard:$('wizardView'), homePlan:$('homePlan'), homeEmpty:$('homeEmpty'), homeGrid:$('homeGrid'), homeRange:$('homeRange'), homeSummary:$('homeSummary'), homeSelectNote:$('homeSelectNote'), homeShop:$('homeShopBtn'), homeShopping:$('homeShopping'), homeMenuTitle:$('homeMenuTitle'),
    progress:$('wizardProgress'), grid:$('planGrid'), list:$('shoppingList'), range:$('weekRange'), planError:$('planError'), selectionCount:$('selectionCount'),
    dinnerCount:$('dinnerCount'), servings:$('servings'), diet:$('diet'), avoidSearch:$('avoidSearch'), avoidOptions:$('avoidOptions'), avoidItems:$('avoidItems'),
    pantry:$('pantryItems'), pantrySearch:$('pantrySearch'), pantryOptions:$('pantryOptions'), empty:$('emptyKitchen'),
    planBtn:$('generateBtn'), shoppingIntro:$('shoppingIntro'), recipeCountNote:$('recipeCountNote'),
    dialog:$('recipeDialog'), content:$('recipeContent'), toast:$('toast')
  };
  let committed = load();
  let state = committed;
  let serverRevision = null;
  let saving = false;
  let refreshing = null;
  let queuedSaves = Promise.resolve();
  let pendingChanges = 0;
  let wizardStep = 0;
  let maxStep = 1;
  let loading = false;
  let planRevision = 0;
  let candidates = [];
  let selectedIds = [];
  let seenCandidateIds = new Set();
  let toastTimer;
  const cloneState = value => JSON.parse(JSON.stringify(value));

  function esc(value) { return String(value ?? '').replace(/[&<>"']/g, x => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x])); }
  function norm(value) { return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim(); }
  function nextMonday() { const d=new Date();d.setHours(12,0,0,0);const days=(8-d.getDay())%7;d.setDate(d.getDate()+(days||7));return d; }
  function weekKey() {const d=nextMonday();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');}
  function mondayFor(plan) {const d=new Date(`${plan.week}T12:00:00`);return Number.isNaN(d.getTime())?nextMonday():d;}
  function weekRange(plan) {const monday=mondayFor(plan),sunday=new Date(monday);sunday.setDate(monday.getDate()+6);const fmt=d=>d.toLocaleDateString('en-GB',{day:'numeric',month:'long'});return `${fmt(monday)} – ${fmt(sunday)} · dinner for ${plan.servings} ${plan.servings===1?'person':'people'}`;}
  function load(fromServer) {
    const blank={week:weekKey(),recipes:[],shoppingRecipeIds:[],dinnerCount:7,servings:4,diet:'all',avoid:[...DEFAULT_AVOID],avoidDefaultsVersion:1,pantry:[],empty:true,checked:{}};
    try {
      const saved=fromServer===undefined?JSON.parse(localStorage.getItem(KEY)):fromServer;
      if(!saved||typeof saved!=='object') {
        const old=fromServer===undefined?JSON.parse(localStorage.getItem('next-week-kitchen-v1')):null;
        if(old&&typeof old==='object') {blank.servings=[1,2,3,4,5,6].includes(Number(old.servings))?Number(old.servings):4;blank.diet=['all','vegetarian','no-fish'].includes(old.diet)?old.diet:'all';blank.pantry=Array.isArray(old.pantry)?old.pantry.map(key=>LEGACY_PANTRY_NAMES[key]).filter(Boolean):[];blank.empty=old.emptyKitchen===true||blank.pantry.length===0;}
        return blank;
      }
      const savedAvoid=Array.isArray(saved.avoid)?saved.avoid.filter(x=>typeof x==='string').slice(0,30):[];
      const avoid=saved.avoidDefaultsVersion===1?savedAvoid:[...savedAvoid,...DEFAULT_AVOID.filter(name=>!savedAvoid.some(item=>norm(item).replace(/s$/,'')===norm(name).replace(/s$/,'')))].slice(0,30);
      const recipes=Array.isArray(saved.recipes)&&saved.recipes.every(x=>x&&Array.isArray(x.ingredients))?saved.recipes:[];
      const recipeIds=new Set(recipes.map(recipe=>recipe.id));
      const shoppingRecipeIds=Array.isArray(saved.shoppingRecipeIds)?[...new Set(saved.shoppingRecipeIds.filter(id=>recipeIds.has(id)))]:recipes.map(recipe=>recipe.id);
      return {...blank,week:/^\d{4}-\d{2}-\d{2}$/.test(saved.week||'')?saved.week:weekKey(),dinnerCount:Number.isInteger(saved.dinnerCount)&&saved.dinnerCount>=1&&saved.dinnerCount<=7?saved.dinnerCount:7,servings:[1,2,3,4,5,6].includes(Number(saved.servings))?Number(saved.servings):4,diet:['all','vegetarian','no-fish'].includes(saved.diet)?saved.diet:'all',avoid,pantry:Array.isArray(saved.pantry)?saved.pantry.filter(x=>typeof x==='string').slice(0,100):[],empty:Boolean(saved.empty),checked:saved.checked&&typeof saved.checked==='object'?saved.checked:{},recipes,shoppingRecipeIds};
    } catch {return blank;}
  }
  function showToast(message) {el.toast.textContent=message;el.toast.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.toast.classList.remove('show'),3500);}
  async function api(url,options) {const response=await fetch(url,options);const data=await response.json();if(!response.ok)throw new Error(data.error||'The service is unavailable.');return data;}
  async function writeWeek(plan, revision=serverRevision) {
    if(revision===null)throw new Error('The shared week has not loaded yet. Try again.');
    return api('/api/week',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({revision,plan})});
  }
  function useSharedWeek(saved) {
    serverRevision=saved.revision;
    committed=load(saved.plan);
    if(!wizardStep){state=committed;renderHome();}
    try{localStorage.removeItem(KEY);localStorage.removeItem('next-week-kitchen-v1');}catch{}
  }
  async function refreshWeek() {
    if(wizardStep||saving||pendingChanges)return;
    if(refreshing)return refreshing;
    refreshing=(async()=>{
      let saved=await api('/api/week');
      if(saved.revision===0&&!saved.plan&&serverRevision===null&&committed.recipes.length){
        try{saved=await writeWeek(committed,0);}
        catch(error){if(!/Another device changed/.test(error.message))throw error;saved=await api('/api/week');}
      }
      if(!wizardStep&&!saving&&!pendingChanges&&(serverRevision===null||saved.revision>serverRevision))useSharedWeek(saved);
    })();
    try{await refreshing;}finally{refreshing=null;}
  }
  function sameMenu(left,right) {return left&&right&&left.week===right.week&&JSON.stringify(left.recipes.map(recipe=>recipe.id))===JSON.stringify(right.recipes.map(recipe=>recipe.id));}
  function queueSharedChange(apply) {
    pendingChanges++;
    queuedSaves=queuedSaves.then(async()=>{
      saving=true;
      try {
        let revision=serverRevision, next=cloneState(committed);
        for(let attempt=0;attempt<4;attempt++){
          apply(next);
          try{useSharedWeek(await writeWeek(next,revision));return;}
          catch(error){
            if(!/Another device changed/.test(error.message))throw error;
            const latest=await api('/api/week');
            if(!sameMenu(latest.plan,next)){useSharedWeek(latest);showToast('Another device saved a new menu. Showing the shared week.');return;}
            revision=latest.revision;next=cloneState(latest.plan);
          }
        }
        throw new Error('Another device updated the list. Try again.');
      } catch(error){try{useSharedWeek(await api('/api/week'));}catch{}showToast(error.message||'Could not save the shopping list.');}
      finally{saving=false;pendingChanges--;}
    });
  }
  function setShoppingRecipe(plan,id,selected) {
    const ids=new Set(Array.isArray(plan.shoppingRecipeIds)?plan.shoppingRecipeIds:plan.recipes.map(recipe=>recipe.id));
    if(selected)ids.add(id);else ids.delete(id);
    plan.shoppingRecipeIds=plan.recipes.filter(recipe=>ids.has(recipe.id)).map(recipe=>recipe.id);
  }
  function selectedShoppingRecipes() {
    if(wizardStep)return state.recipes;
    const ids=new Set(state.shoppingRecipeIds);
    return state.recipes.filter(recipe=>ids.has(recipe.id));
  }
  function toggleHomeRecipe(index) {
    const recipe=committed.recipes[index];if(!recipe)return;
    const selected=!committed.shoppingRecipeIds.includes(recipe.id);
    setShoppingRecipe(committed,recipe.id,selected);
    renderHome();
    queueSharedChange(plan=>setShoppingRecipe(plan,recipe.id,selected));
  }
  function atHome(name) {return !state.empty&&state.pantry.some(item=>norm(item)===norm(name)||norm(item).replace(/s$/,'')===norm(name).replace(/s$/,''));}
  function pantryCount(recipe) {return recipe.ingredients.filter(item=>atHome(item.name)).length;}
  function scaleMeasure(measure) {
    const ratio=state.servings/4,value=String(measure||'').trim();if(ratio===1||!value)return value;
    const match=value.match(/^(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?|½|¼|¾)(\s*.*)$/);
    if(!match)return `${value} (recipe amount)`;
    const n=match[1]==='½'?.5:match[1]==='¼'?.25:match[1]==='¾'?.75:match[1].includes(' ')?Number(match[1].split(' ')[0])+Number(match[1].split(' ')[1].split('/')[0])/Number(match[1].split(' ')[1].split('/')[1]):match[1].includes('/')?Number(match[1].split('/')[0])/Number(match[1].split('/')[1]):Number(match[1]);
    return `${Number((n*ratio).toFixed(2))}${match[2]}`;
  }
  function invalidateRecipes() {if(wizardStep){planRevision++;candidates=[];selectedIds=[];seenCandidateIds=new Set();state.recipes=[];state.checked={};el.planError.hidden=true;}}

  function cards(recipes) {
    return recipes.map((recipe,i)=>{const selected=state.shoppingRecipeIds.includes(recipe.id);return `<article class="meal-card home-card ${selected?'selected':''}"><button class="card-pick" type="button" data-home-toggle="${i}" aria-pressed="${selected}" aria-label="${selected?'Remove':'Include'} ${esc(recipe.title)} ${selected?'from':'in'} shopping list"></button><div class="meal-visual">${recipe.image?`<img src="${esc(recipe.image)}" alt="${esc(recipe.title)}" loading="lazy">`:'<span>🍽️</span>'}</div><div class="meal-body"><h3>${esc(recipe.title)}</h3><p>${esc(recipe.area||recipe.category||'Dinner')}</p><div class="meal-meta"><strong>${esc(recipe.category||'Dinner')}</strong><span>${recipe.ingredients.length} ingredients</span></div><div class="calorie-line">${recipe.kcal===null?'Kcal estimate unavailable':`≈ ${recipe.kcal} kcal / serving`}${pantryCount(recipe)?` · ${pantryCount(recipe)} at home`:''}</div></div><div class="meal-actions"><button type="button" data-recipe="${i}" aria-label="View ${esc(recipe.title)} recipe">View recipe ↗</button></div></article>`;}).join('');
  }
  function renderHome() {
    state=committed;
    const hasPlan=committed.recipes.length>0;
    el.homePlan.hidden=!hasPlan;el.homeShopping.hidden=!hasPlan;el.homeEmpty.hidden=hasPlan;el.homeShop.hidden=!hasPlan;
    if(hasPlan){const count=committed.recipes.length,selected=selectedShoppingRecipes();el.homeMenuTitle.textContent=`Your ${count} ${count===1?'dinner':'dinners'}`;el.homeRange.textContent=weekRange(committed);el.homeGrid.dataset.count=String(count);el.homeGrid.innerHTML=cards(committed.recipes);const items=new Set(selected.flatMap(recipe=>recipe.ingredients.map(item=>norm(item.name))));el.homeSummary.textContent=`${selected.length} of ${count} dinners selected · ${items.size} ingredients`;el.homeSelectNote.textContent=`Tap dinner cards to choose what to buy for. ${committed.empty?'Starting with an empty kitchen.':`${committed.pantry.length} items already at home.`}`;renderShopping();}
  }
  function syncControls() {el.dinnerCount.value=String(state.dinnerCount);el.servings.value=String(state.servings);el.diet.value=state.diet;}
  function renderAvoid() {el.avoidItems.innerHTML=state.avoid.map((name,i)=>`<span class="avoid-chip">${esc(name)} <button type="button" data-remove-avoid="${i}" aria-label="Allow ${esc(name)} again">×</button></span>`).join('')||'<span class="pantry-empty">No ingredients excluded.</span>';}
  function renderPantry() {el.empty.checked=state.empty;el.pantry.innerHTML=state.pantry.length?state.pantry.map((name,i)=>`<span class="pantry-chip">${esc(name)} <button type="button" data-remove-pantry="${i}" aria-label="Remove ${esc(name)}">×</button></span>`).join(''):`<span class="pantry-empty">${state.empty?'Starting with an empty kitchen.':'Nothing added yet.'}</span>`;}
  function candidateCards() {
    return candidates.map((recipe,i)=>{
      const selectedIndex=selectedIds.indexOf(recipe.id),selected=selectedIndex!==-1;
      return `<article class="meal-card candidate-card ${selected?'selected':''}"><button class="card-pick" type="button" data-toggle="${i}" aria-pressed="${selected}" aria-label="${selected?'Remove':'Select'} ${esc(recipe.title)} ${selected?'from':'for'} next week"></button><div class="meal-visual">${recipe.image?`<img src="${esc(recipe.image)}" alt="${esc(recipe.title)}" loading="lazy">`:'<span>🍽️</span>'}</div><div class="meal-body"><span class="day-label">${selected?`${DAYS[selectedIndex]} · selected`:`RECIPE IDEA ${i+1}`}</span><h3>${esc(recipe.title)}</h3><p>${esc(recipe.area||recipe.category||'Dinner')}</p><div class="meal-meta"><strong>${esc(recipe.category||'Dinner')}</strong><span>${recipe.ingredients.length} ingredients</span></div><div class="calorie-line">${recipe.kcal===null?'Kcal estimate unavailable':`≈ ${recipe.kcal} kcal / serving`}${pantryCount(recipe)?` · ${pantryCount(recipe)} at home`:''}</div></div><div class="meal-actions"><button type="button" data-recipe="${i}" aria-label="View ${esc(recipe.title)} recipe">View recipe ↗</button></div></article>`;
    }).join('');
  }
  function renderRecipes() {
    const count=state.dinnerCount,ideas=count*2;
    $('planTitle').textContent=count===1?'Choose next week’s dinner':'Choose next week’s dinners';
    $('finishBtn').innerHTML=`Save ${count===1?'dinner':'dinners'} and see what to buy <span>↗</span>`;
    $('finishBtn').disabled=loading||selectedIds.length!==count;
    el.range.textContent=weekRange(state);
    el.recipeCountNote.textContent=`Choose ${count} ${count===1?'dinner':'dinners'} from ${ideas} recipe ideas.`;
    el.selectionCount.textContent=`${selectedIds.length} of ${count} selected${selectedIds.length===count?' · ready to save':''}`;
    el.grid.dataset.count=String(ideas);
    el.grid.innerHTML=candidates.length===ideas?candidateCards():`<div class="empty-plan">Finding ${ideas} recipe ideas that fit your preferences and kitchen.</div>`;
    el.planBtn.textContent=candidates.length===ideas?'↻ Refresh unselected recipes':`Find ${ideas} recipe ideas ↻`;
  }
  function toggleCandidate(index) {
    if(loading)return;
    const recipe=candidates[index];if(!recipe)return;
    const selectedIndex=selectedIds.indexOf(recipe.id);
    if(selectedIndex!==-1)selectedIds.splice(selectedIndex,1);
    else if(selectedIds.length<state.dinnerCount)selectedIds.push(recipe.id);
    else {showToast(`You have chosen ${state.dinnerCount} dinners. Remove one before choosing another.`);return;}
    state.recipes=selectedIds.map(id=>candidates.find(item=>item.id===id)).filter(Boolean);
    state.checked={};renderRecipes();
  }
  function aggregate() {
    const map=new Map();for(const recipe of selectedShoppingRecipes())for(const item of recipe.ingredients){const key=norm(item.name);if(!key)continue;const row=map.get(key)||{name:item.name,measures:[]};row.measures.push(`${scaleMeasure(item.measure)||'amount as needed'} (${recipe.title})`);map.set(key,row);}
    return [...map.values()].sort((a,b)=>a.name.localeCompare(b.name));
  }
  function renderShopping() {
    const items=aggregate(),count=selectedShoppingRecipes().length;el.shoppingIntro.textContent=count===0?'Select a dinner above to see its ingredients here.':state.empty?`Everything needed for ${count} selected ${count===1?'dinner':'dinners'} is listed below.`:`Ingredients from ${count} selected ${count===1?'dinner':'dinners'}; items at home are already marked.`;
    $('copyBtn').disabled=count===0;$('printBtn').disabled=count===0;
    el.list.innerHTML=items.length?`<div class="shop-category shop-full"><h3>Ingredients <span class="shop-count">${items.length} items</span></h3>${items.map((item,i)=>{const home=atHome(item.name),done=home||Boolean(state.checked[norm(item.name)]);return `<div class="shop-row ${done?'done':''}"><input type="checkbox" data-item="${i}" ${done?'checked':''} ${home?'disabled':''} aria-label="Mark ${esc(item.name)} as obtained"><span class="item-name">${esc(item.name)}${home?' <small class="at-home">at home</small>':''}<small class="shop-measure">${esc(item.measures.join(' · '))}</small></span></div>`;}).join('')}</div>`:'<div class="empty-plan">Select one or more dinners above to build the shopping list.</div>';
  }

  function showStep(number) {
    if(number<1||number>3)return;
    wizardStep=number;maxStep=Math.max(maxStep,number);
    el.home.hidden=true;el.wizard.hidden=false;
    for(let i=1;i<=3;i++)$('step'+i).hidden=i!==number;
    for(const button of el.progress.querySelectorAll('[data-go-step]')){const step=Number(button.dataset.goStep);button.disabled=step>maxStep;button.setAttribute('aria-current',step===number?'step':'false');}
    if(number===3)renderRecipes();
    window.scrollTo({top:0,behavior:'smooth'});
  }
  async function startWizard() {
    if(loading)return;
    await queuedSaves;
    await refreshWeek();
    state=cloneState(committed);
    state.week=weekKey();state.recipes=[];state.shoppingRecipeIds=[];state.checked={};
    candidates=[];selectedIds=[];seenCandidateIds=new Set();
    syncControls();renderAvoid();renderPantry();
    maxStep=1;
    showStep(1);
  }
  async function leaveWizard(commit=false) {
    if(commit){
      if(state.recipes.length!==state.dinnerCount){showToast(`Choose ${state.dinnerCount} ${state.dinnerCount===1?'dinner':'dinners'} before saving.`);return;}
      if(saving)return;
      saving=true;$('finishBtn').disabled=true;
      state.shoppingRecipeIds=state.recipes.map(recipe=>recipe.id);
      try{useSharedWeek(await writeWeek(cloneState(state)));}
      catch(error){el.planError.textContent=error.message||'Could not save this week.';el.planError.hidden=false;$('finishBtn').disabled=false;showToast('Could not save the shared week.');return;}
      finally{saving=false;}
    }
    wizardStep=0;state=committed;
    el.wizard.hidden=true;el.home.hidden=false;renderHome();
    if(commit)el.homeShopping.scrollIntoView({behavior:'smooth'});else{window.scrollTo({top:0,behavior:'smooth'});refreshWeek().catch(()=>{});}
  }
  async function generate() {
    if(loading||wizardStep!==3)return;
    const draft=state,revision=planRevision;
    const ideas=state.dinnerCount*2,initial=candidates.length!==ideas;
    const refreshPositions=initial?[]:candidates.map((recipe,i)=>selectedIds.includes(recipe.id)?-1:i).filter(i=>i!==-1);
    const needed=initial?ideas:refreshPositions.length;
    if(!needed)return;
    loading=true;el.planError.hidden=true;el.planBtn.disabled=true;$('finishBtn').disabled=true;
    for(const button of el.grid.querySelectorAll('[data-toggle]'))button.disabled=true;
    if(initial)el.grid.innerHTML=`<div class="empty-plan">Finding ${ideas} recipe ideas from TheMealDB…</div>`;
    else for(const index of refreshPositions)el.grid.querySelectorAll('.meal-card')[index]?.classList.add('rerolling');
    try {
      const previous=committed.recipes.map(recipe=>recipe.id);
      const currentIds=candidates.map(recipe=>recipe.id);
      const exclude=initial?[]:[...currentIds,...[...seenCandidateIds].filter(id=>!currentIds.includes(id)).slice(-(100-currentIds.length))];
      const recipes=[];
      const maxAttempts=needed>8?4:3;
      let attempts=0,lastError;
      while(recipes.length<needed&&attempts<maxAttempts){
        attempts++;
        const blocked=new Set([...exclude,...recipes.map(recipe=>recipe.id)]);
        try{
          const data=await api('/api/plan',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({diet:state.diet,avoid:state.avoid,pantry:state.empty?[]:state.pantry,previous,exclude:[...blocked].slice(-100),count:needed-recipes.length})});
          if(!Array.isArray(data.recipes))throw new Error('The recipe service returned an invalid response.');
          for(const recipe of data.recipes)if(recipe&&typeof recipe.id==='string'&&!blocked.has(recipe.id)&&!recipes.some(item=>item.id===recipe.id))recipes.push(recipe);
        }catch(error){lastError=error;}
        if(state!==draft||wizardStep===0||planRevision!==revision)return;
      }
      if(state!==draft||wizardStep===0||planRevision!==revision)return;
      if(recipes.length!==needed)throw new Error(recipes.length===0&&lastError?lastError.message:`Found ${recipes.length} of ${needed} ideas after ${attempts} searches. Try fewer excluded ingredients.`);
      if(initial)candidates=recipes;
      else for(let i=0;i<refreshPositions.length;i++)candidates[refreshPositions[i]]=recipes[i];
      for(const recipe of recipes)seenCandidateIds.add(recipe.id);
      renderRecipes();showToast(initial?`${ideas} recipe ideas are ready. Choose ${state.dinnerCount}.`:'Unselected recipes refreshed.');
    } catch(error) {if(state===draft&&wizardStep!==0&&planRevision===revision){renderRecipes();el.planError.textContent=error.message||'Could not get recipes.';el.planError.hidden=false;}}
    finally {loading=false;el.planBtn.disabled=false;$('finishBtn').disabled=selectedIds.length!==state.dinnerCount;if(state===draft&&wizardStep===3&&planRevision!==revision&&candidates.length!==state.dinnerCount*2)generate();}
  }
  function openRecipe(recipe) {
    if(!recipe)return;
    el.content.innerHTML=`<div class="modal-header"><div class="section-kicker">THEMEALDB RECIPE</div><h2 id="recipeTitle">${esc(recipe.title)}</h2><p>${esc(recipe.area||recipe.category||'Dinner')}</p><div class="modal-meta"><span>${state.servings} people (approximate scaling)</span><span>${recipe.kcal===null?'Kcal unavailable':`≈ ${recipe.kcal} kcal / serving`}</span></div></div><div class="modal-columns"><div><h3>Ingredients</h3><ul class="modal-ingredients">${recipe.ingredients.map(item=>`<li><div>${esc(item.name)}<small>${esc(scaleMeasure(item.measure)||'Amount as needed')}${atHome(item.name)?' · at home':''}</small></div></li>`).join('')}</ul></div><div><h3>Let's cook</h3><div class="api-instructions">${esc(recipe.instructions||'Open the source recipe for instructions.')}</div><p class="nutrition-note">Calories are a rough ingredient-based estimate assuming four portions. The source does not supply verified nutrition or serving counts. Check labels and actual amounts.</p><p><a href="${esc(recipe.source)}" target="_blank" rel="noopener noreferrer">Original recipe ↗</a></p></div></div>`;el.dialog.showModal();
  }
  async function copyList() {const lines=[`Shopping list · ${weekRange(state)}`];for(const item of aggregate())if(!atHome(item.name)&&!state.checked[norm(item.name)])lines.push(`${item.name} — ${item.measures.join(' · ')}`);try{await navigator.clipboard.writeText(lines.join('\n'));showToast('Shopping list copied.');}catch{showToast('Your browser blocked copying.');}}
  function addPantry(name) {if(!name||name.length>80)return;state.empty=false;if(!state.pantry.some(item=>norm(item)===norm(name)))state.pantry.push(name);invalidateRecipes();renderPantry();}
  async function loadIngredients() {try{const data=await api('/api/ingredients');const names=data.ingredients||[];el.avoidOptions.innerHTML=names.map(name=>`<option value="${esc(name)}"></option>`).join('');el.pantryOptions.innerHTML=names.map(name=>`<option value="${esc(name)}"></option>`).join('');}catch{el.avoidSearch.placeholder='Type an ingredient to avoid…';}}

  $('startWizardBtn').addEventListener('click',()=>startWizard().catch(error=>showToast(error.message||'Could not load the shared week.')));$('emptyStartBtn').addEventListener('click',()=>startWizard().catch(error=>showToast(error.message||'Could not load the shared week.')));el.homeShop.addEventListener('click',()=>el.homeShopping.scrollIntoView({behavior:'smooth'}));$('homeLogo').addEventListener('click',event=>{event.preventDefault();if(wizardStep)leaveWizard();else window.scrollTo({top:0,behavior:'smooth'});});
  $('toKitchenBtn').addEventListener('click',()=>showStep(2));$('backPrefsBtn').addEventListener('click',()=>showStep(1));$('toRecipesBtn').addEventListener('click',()=>{showStep(3);if(candidates.length!==state.dinnerCount*2)generate();});$('backKitchenBtn').addEventListener('click',()=>showStep(2));$('finishBtn').addEventListener('click',()=>leaveWizard(true));
  el.progress.addEventListener('click',event=>{const button=event.target.closest('[data-go-step]');if(!button||button.disabled)return;const step=Number(button.dataset.goStep);showStep(step);if(step===3&&candidates.length!==state.dinnerCount*2)generate();});
  el.dinnerCount.addEventListener('change',()=>{state.dinnerCount=Number(el.dinnerCount.value);invalidateRecipes();});el.servings.addEventListener('change',()=>{state.servings=Number(el.servings.value);invalidateRecipes();});el.diet.addEventListener('change',()=>{state.diet=el.diet.value;invalidateRecipes();});
  $('addAvoidBtn').addEventListener('click',()=>{const name=el.avoidSearch.value.trim();if(!name)return;if(name.length>80||state.avoid.length>=30){showToast('Use up to 30 short ingredient names.');return;}if(!state.avoid.some(x=>norm(x)===norm(name)))state.avoid.push(name);el.avoidSearch.value='';invalidateRecipes();renderAvoid();});el.avoidSearch.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();$('addAvoidBtn').click();}});el.avoidItems.addEventListener('click',event=>{const button=event.target.closest('[data-remove-avoid]');if(button){state.avoid.splice(Number(button.dataset.removeAvoid),1);invalidateRecipes();renderAvoid();}});
  el.empty.addEventListener('change',()=>{state.empty=el.empty.checked;if(state.empty)state.pantry=[];invalidateRecipes();renderPantry();});$('addPantryBtn').addEventListener('click',()=>{addPantry(el.pantrySearch.value.trim());el.pantrySearch.value='';});el.pantrySearch.addEventListener('keydown',event=>{if(event.key==='Enter'){$('addPantryBtn').click();}});el.pantry.addEventListener('click',event=>{const button=event.target.closest('[data-remove-pantry]');if(button){state.pantry.splice(Number(button.dataset.removePantry),1);invalidateRecipes();renderPantry();}});
  el.planBtn.addEventListener('click',()=>generate());el.grid.addEventListener('click',event=>{const recipe=event.target.closest('[data-recipe]'),toggle=event.target.closest('[data-toggle]');if(recipe)openRecipe(candidates[Number(recipe.dataset.recipe)]);else if(toggle)toggleCandidate(Number(toggle.dataset.toggle));});el.homeGrid.addEventListener('click',event=>{const recipe=event.target.closest('[data-recipe]'),toggle=event.target.closest('[data-home-toggle]');if(recipe)openRecipe(state.recipes[Number(recipe.dataset.recipe)]);else if(toggle)toggleHomeRecipe(Number(toggle.dataset.homeToggle));});
  el.list.addEventListener('change',event=>{const input=event.target.closest('[data-item]');if(!input)return;const item=aggregate()[Number(input.dataset.item)];if(item){const key=norm(item.name),value=input.checked;state.checked[key]=value;renderShopping();queueSharedChange(plan=>{plan.checked[key]=value;});}});$('copyBtn').addEventListener('click',copyList);$('printBtn').addEventListener('click',()=>window.print());$('closeDialog').addEventListener('click',()=>el.dialog.close());el.dialog.addEventListener('click',event=>{if(event.target===el.dialog)el.dialog.close();});
  renderHome();refreshWeek().catch(error=>showToast(error.message||'Could not load the shared week.'));setInterval(()=>refreshWeek().catch(()=>{}),10000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshWeek().catch(()=>{});});window.addEventListener('focus',()=>refreshWeek().catch(()=>{}));loadIngredients();
})();
