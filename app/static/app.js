const input = document.querySelector('#recipe-input');
const count = document.querySelector('#char-count');
const analyzeBtn = document.querySelector('#analyze-btn');
const results = document.querySelector('#results');
const emptyState = document.querySelector('#empty-state');
const progress = document.querySelector('#analysis-progress');
const toast = document.querySelector('#toast');
const methodButtons = [...document.querySelectorAll('.style-pill')];
const savedCount = document.querySelector('.nav-count');
const STORAGE_KEY = 'nutrafuel.savedRecipes';
const examples = [
  'I made chicken curry using 500g chicken breast, 2 medium onions, 3 tomatoes, 2 tbsp sunflower oil, turmeric, coriander powder and chili powder. It serves 4 people.',
  '1 cup cooked rice, 1/2 cup dal, 1 tsp ghee, cumin and a pinch of salt. Serves 2.',
  '250g paneer, 1 bell pepper, 1 onion, 2 tbsp tomato puree and 1 tbsp oil. Serves 3.',
  '200g potato, 1 cup spinach, 2 tsp olive oil, garlic, chili and lemon. Serves 2.'
];
let exampleIndex = 0;
let selectedMethod = 'curry';
let servings = 4;
let activeController = null;

const fmt = (value, digits = 0) => Number(value ?? 0).toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });
const titleCase = (value = '') => value.replace(/\b\w/g, c => c.toUpperCase());
const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2600);
}
function setCount() { count.textContent = input.value.length.toLocaleString(); }
function setLoading(loading) {
  analyzeBtn.disabled = loading;
  analyzeBtn.querySelector('span:first-child').textContent = loading ? 'Working on it…' : 'Analyze recipe';
}
function setProgress(stage, subtitle, percent, page) {
  document.querySelector('#progress-title').textContent = stage;
  document.querySelector('#progress-subtitle').textContent = subtitle;
  document.querySelector('#progress-fill').style.width = `${percent}%`;
  document.querySelector('#progress-percent').textContent = page;
}
function getSavedRecipes() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
function updateSavedCount() {
  if (savedCount) savedCount.textContent = String(getSavedRecipes().length).padStart(2, '0');
}

async function requestJson(url, options, controller) {
  const response = await fetch(url, { ...options, signal: controller.signal });
  let payload = null;
  try { payload = await response.json(); } catch { /* handled below */ }
  if (!response.ok) {
    const detail = payload?.detail;
    const message = Array.isArray(detail) ? detail[0]?.msg : detail;
    throw new Error(message || `Request failed (${response.status}).`);
  }
  return payload;
}

async function analyze() {
  const recipe = input.value.trim();
  if (!recipe) { input.focus(); showToast('Add a recipe to get started.'); return; }

  if (activeController) activeController.abort();
  activeController = new AbortController();
  const controller = activeController;

  setLoading(true);
  progress.classList.remove('hidden');
  setProgress('Reading your recipe', 'Finding ingredients and quantities…', 22, '01 / 03');
  try {
    const parsed = await requestJson('/v1/recipes/parse', {
      method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({recipe})
    }, controller);
    setProgress('Resolving ingredients', `${parsed.matches?.length || parsed.parsed?.ingredients?.length || 0} ingredients matched to the reference table…`, 58, '02 / 03');
    await new Promise(resolve => setTimeout(resolve, 180));
    if (controller.signal.aborted) return;
    const analysis = await requestJson('/v1/recipes/analyze', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({parsed: parsed.parsed, method_override: selectedMethod, servings_override: servings})
    }, controller);
    setProgress('Building your snapshot', 'Turning the recipe into useful signals…', 88, '03 / 03');
    await new Promise(resolve => setTimeout(resolve, 180));
    if (controller.signal.aborted) return;
    render(analysis);
    progress.classList.add('hidden');
  } catch (error) {
    if (error.name === 'AbortError') return;
    progress.classList.add('hidden');
    showToast(error.message || 'Something went wrong.');
  } finally {
    if (activeController === controller) {
      activeController = null;
      setLoading(false);
    }
  }
}

function render(data) {
  const total = data.total_nutrition || {};
  const serving = data.per_serving || {};
  const confidence = data.confidence || {};
  document.querySelector('#dish-title').textContent = titleCase(data.dish_name || 'Your recipe');
  document.querySelector('#method-label').textContent = titleCase(data.method || selectedMethod);
  document.querySelector('#servings-label').textContent = `${fmt(data.servings)} servings`;
  document.querySelector('#weight-label').textContent = `~${fmt(data.estimated_cooked_weight_g)}g cooked`;
  document.querySelector('#total-kcal').textContent = fmt(total.kcal);
  document.querySelector('#total-protein').textContent = fmt(total.protein_g, 1);
  document.querySelector('#total-carbs').textContent = fmt(total.carbs_g, 1);
  document.querySelector('#total-fat').textContent = fmt(total.fat_g, 1);
  document.querySelector('#serving-kcal').textContent = fmt(serving.kcal);
  document.querySelector('#serving-protein').textContent = `${fmt(serving.protein_g, 1)}g`;
  document.querySelector('#serving-carbs').textContent = `${fmt(serving.carbs_g, 1)}g`;
  document.querySelector('#serving-fat').textContent = `${fmt(serving.fat_g, 1)}g`;
  document.querySelector('#protein-share').textContent = `${fmt(total.protein_g, 1)}g total`;
  document.querySelector('#carb-share').textContent = `${fmt(total.carbs_g, 1)}g total`;
  document.querySelector('#fat-share').textContent = `${fmt(total.fat_g, 1)}g total`;
  const score = Math.max(0, Math.min(100, Math.round(confidence.energy_macros ?? confidence.overall ?? 0)));
  document.querySelector('#confidence-score').textContent = `${score}%`;
  document.querySelector('#confidence-label').textContent = `${score}% reliable`;
  document.querySelector('#confidence-fill').style.width = `${score}%`;
  document.querySelector('#confidence-note').textContent = confidence.suggestions?.[0] || 'Every number is traceable to an ingredient match.';

  const list = document.querySelector('#ingredient-list');
  list.innerHTML = (data.ingredients || []).map((item, index) => {
    const name = escapeHtml(item.matched_name || item.raw_text || 'Unknown ingredient');
    const raw = escapeHtml(item.raw_text || '');
    const basis = escapeHtml(item.conversion_basis || 'reference table');
    const method = escapeHtml(item.match_method || 'review');
    return `<div class="ingredient-row" style="animation-delay:${index * 45}ms"><div><div class="ingredient-name">${name}<span class="match-tag">${method}</span></div><div class="ingredient-sub">${raw} · ${basis}</div></div><div class="ingredient-kcal">${fmt(item.nutrition?.kcal)}<small> kcal</small></div></div>`;
  }).join('') || '<p class="ingredient-sub">No ingredients were resolved.</p>';
  document.querySelector('#ingredient-count').textContent = `${(data.ingredients || []).length} items`;

  const suggestion = (confidence.suggestions || []).find(item => /salt/i.test(item));
  const warning = (data.warnings || [])[0] || suggestion;
  document.querySelector('#warning-box').classList.toggle('hidden', !warning);
  if (warning) document.querySelector('#warning-text').textContent = warning;
  results.classList.remove('hidden');
  emptyState.classList.add('hidden');
  results.scrollIntoView({behavior:'smooth', block:'start'});
}

function saveCurrentRecipe(event) {
  const recipe = input.value.trim();
  if (!recipe) { showToast('Analyze a recipe before saving it.'); return; }
  const saved = getSavedRecipes();
  const record = { recipe, method: selectedMethod, servings, savedAt: new Date().toISOString() };
  const duplicate = saved.some(item => item.recipe === recipe && item.method === selectedMethod && item.servings === servings);
  if (!duplicate) {
    saved.unshift(record);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved.slice(0, 20)));
    updateSavedCount();
  }
  event.currentTarget.innerHTML = duplicate ? '✓ <span>Saved</span>' : '✓ <span>Saved</span>';
  showToast(duplicate ? 'This recipe is already saved.' : 'Recipe saved on this device.');
}

input.addEventListener('input', setCount);
analyzeBtn.addEventListener('click', analyze);
document.querySelector('#example-btn').addEventListener('click', () => { exampleIndex = (exampleIndex + 1) % examples.length; input.value = examples[exampleIndex]; setCount(); input.focus(); showToast('Example recipe loaded.'); });
methodButtons.forEach(button => button.addEventListener('click', () => { methodButtons.forEach(item => item.classList.remove('active')); button.classList.add('active'); selectedMethod = button.dataset.method; }));
document.querySelector('#servings-minus').addEventListener('click', () => { servings = Math.max(1, servings - 1); document.querySelector('#servings-value').textContent = servings; });
document.querySelector('#servings-plus').addEventListener('click', () => { servings = Math.min(20, servings + 1); document.querySelector('#servings-value').textContent = servings; });
document.querySelector('#new-recipe').addEventListener('click', () => { input.value = ''; setCount(); results.classList.add('hidden'); emptyState.classList.remove('hidden'); document.querySelector('#save-recipe').innerHTML = '♡ <span>Save</span>'; window.scrollTo({top:0, behavior:'smooth'}); input.focus(); });
document.querySelector('#save-recipe').addEventListener('click', saveCurrentRecipe);
setCount();
updateSavedCount();