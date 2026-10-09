import {compile, newProfile} from './model.js';
import {readState, applyState} from './engine.js';
import {exportData, importData} from './transfer.js';
import {splitRules} from './network.js';
const api = globalThis.browser;
const $ = selector => document.querySelector(selector);
let state, appliedJSON = '', busy = false;
const active = () => state.profiles.find(p => p.id === state.activeId);
function status(text, kind = '') { $('#status').textContent = text; $('#status').dataset.kind = kind; }
function showError(error) { $('#error').textContent = error?.message || String(error); $('#error').hidden = false; }
function dirty() {
  $('#error').hidden = true;
  status(JSON.stringify(state) === appliedJSON ? (state.enabled ? 'Настройки сохранены.' : 'Пауза: заголовки не изменяются.') : 'Есть изменения · нажмите «Применить».');
  $('#save').disabled = busy; updatePause();
}
function updatePause() {
  $('#pause').textContent = state.enabled ? 'Пауза' : 'Продолжить';
  $('#pause').setAttribute('aria-pressed', String(!state.enabled));
}
function render() {
  const picker = $('#profiles'); picker.replaceChildren();
  for (const p of state.profiles) { const option = new Option(p.name, p.id); picker.add(option); }
  picker.value = state.activeId;
  const profile = active(); $('#profile-name').value = profile.name; $('#scope').value = profile.scope;
  $('#headers').replaceChildren();
  for (const h of profile.headers) {
    const row = $('#header-template').content.firstElementChild.cloneNode(true);
    row.querySelector('.header-enabled').checked = h.enabled;
    row.querySelector('.header-target').value = h.target;
    row.querySelector('.header-operation').value = h.operation;
    row.querySelector('.header-name').value = h.name;
    row.querySelector('.header-value').value = h.value;
    row.querySelector('.header-value').hidden = h.operation === 'remove';
    for (const [selector, key] of [['.header-enabled','enabled'],['.header-target','target'],['.header-operation','operation'],['.header-name','name'],['.header-value','value']]) {
      row.querySelector(selector).addEventListener('input', e => {
        h[key] = key === 'enabled' ? e.target.checked : e.target.value;
        row.querySelector('.header-value').hidden = h.operation === 'remove'; dirty();
      });
    }
    row.querySelector('.remove-header').addEventListener('click', () => { profile.headers.splice(profile.headers.indexOf(h),1); render(); dirty(); });
    $('#headers').append(row);
  }
  $('#empty').hidden = profile.headers.length > 0;
  $('#delete-profile').disabled = state.profiles.length === 1;
  $('#new-profile').disabled = $('#duplicate-profile').disabled = state.profiles.length >= 20;
  $('#add-header').disabled = profile.headers.length >= 100;
  updatePause();
}
async function save() {
  if (busy) return;
  let compiled;
  try { compiled = compile(state); } catch (error) { showError(error); return; }
  busy = true;
  const snapshot = structuredClone(state);
  // Request from the user's click, before other asynchronous work.
  let grant;
  try { grant = compiled.origins.length ? api.permissions.request({origins: compiled.origins}) : Promise.resolve(true); }
  catch (error) { busy = false; showError(error); return; }
  const controls = [...document.querySelectorAll('input, select, button')];
  controls.forEach(c => c.disabled = true); $('#error').hidden = true; status('Применение…');
  try {
    if (!await grant) throw new Error('Доступ к сайту не разрешён. Предыдущие правила сохранены.');
    if (compiled.rules.length && api.declarativeNetRequest.isRegexSupported) {
      const result = await api.declarativeNetRequest.isRegexSupported({regex: compiled.rules[0].condition.regexFilter});
      if (!result.isSupported) throw new Error('WebKit не поддерживает этот фильтр URL. Используйте более простой домен или путь.');
    }
    await applyState(api, snapshot, compiled);
    appliedJSON = JSON.stringify(snapshot);
    const custom = splitRules(compiled).native.enabled;
    status(compiled.count ? `Применено: ${compiled.count} · ${custom ? 'GET/HEAD · Fetch/XHR · ' : ''}обновите страницу.` : state.enabled ? 'Нет активных правил. Заголовки не изменяются.' : 'Пауза: заголовки не изменяются.', 'applied');
    $('#access').textContent = compiled.origins.length ? 'Правила действуют только на разрешённых сайтах.' : 'Доступ к сайту запрашивается при применении.';
  } catch (error) { showError(error); status('Изменения не применены.'); }
  finally { busy = false; controls.forEach(c => c.disabled = false); render(); }
}
$('#save').addEventListener('click', save);
$('#scope').addEventListener('input', e => { active().scope = e.target.value; dirty(); });
$('#profile-name').addEventListener('input', e => { active().name = e.target.value; $('#profiles').selectedOptions[0].textContent = e.target.value || 'Без названия'; dirty(); });
$('#profiles').addEventListener('change', e => { state.activeId = e.target.value; render(); dirty(); });
$('#add-header').addEventListener('click', () => {
  active().headers.push({enabled:true,target:'request',operation:'set',name:'',value:''}); render(); dirty();
  $('#headers').lastElementChild.querySelector('.header-name').focus();
});
$('#new-profile').addEventListener('click', () => { const p = newProfile('Профиль ' + (state.profiles.length+1)); state.profiles.push(p); state.activeId = p.id; render(); dirty(); });
$('#duplicate-profile').addEventListener('click', () => { const p = structuredClone(active()); p.id = crypto.randomUUID(); p.name = (p.name + ' · копия').slice(0,80); state.profiles.push(p); state.activeId = p.id; render(); dirty(); });
$('#delete-profile').addEventListener('click', () => { if (state.profiles.length < 2) return; state.profiles = state.profiles.filter(p => p.id !== state.activeId); state.activeId = state.profiles[0].id; render(); dirty(); });
$('#import-json').addEventListener('click', () => {
  if (JSON.stringify(state) !== appliedJSON) { showError(new Error('Сначала примените изменения, затем импортируйте JSON.')); return; }
  $('#import-file').click();
});
$('#import-file').addEventListener('change', async e => {
  const file = e.target.files[0]; if (!file || busy) return;
  busy = true; const controls = [...document.querySelectorAll('input,select,button')];
  controls.forEach(c => c.disabled = true);
  try {
    if (file.size > 2_000_000) throw new Error('JSON слишком большой. Максимум 2 МБ.');
    const result = importData(JSON.parse(await file.text()), state);
    await applyState(api, result.state);
    state = result.state; appliedJSON = JSON.stringify(state); $('#error').hidden = true;
    status(`Импортировано профилей: ${result.count}. Пауза · «Продолжить» включит правила.`, 'applied');
    document.documentElement.dataset.imported = String(result.count);
  } catch (error) { showError(error); }
  finally { busy = false; e.target.value = ''; controls.forEach(c => c.disabled = false); render(); }
});
function downloadJSON(payload) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)+'\n'],{type:'application/json'}));
  const link = document.createElement('a'); link.href = url;
  link.download = 'levisbox-' + new Date().toISOString().slice(0,10) + '.json';
  document.body.append(link); link.click(); link.remove();
  // The tab is retained for the save dialog; its Blob is released on unload.
  addEventListener('pagehide', () => URL.revokeObjectURL(url), {once:true});
}
$('#open-options').addEventListener('click', () => api.runtime.openOptionsPage().catch(showError));
$('#export-json').addEventListener('click', async () => {
  try {
    const payload = exportData(state);
    if (location.pathname.endsWith('/options.html')) downloadJSON(payload);
    else {
      // Export in a normal browser tab to use Levitas' native save dialog and
      // download history, rather than replacing WebKit's action-popup delegates.
      await api.storage.session.set({levitasHeadersExport:payload});
      await api.tabs.create({url:api.runtime.getURL('options.html?export=1')});
    }
  } catch (error) { showError(error); }
});
$('#pause').addEventListener('click', () => {
  if (JSON.stringify(state) !== appliedJSON) { showError(new Error('Сначала примените изменения профиля, затем включайте паузу.')); return; }
  state.enabled = !state.enabled;
  save().then(() => { if (JSON.stringify(state) !== appliedJSON) { state.enabled = !state.enabled; updatePause(); } });
});
try {
  if (!api?.declarativeNetRequest?.updateDynamicRules) throw new Error('Эта версия WebKit не поддерживает изменение сетевых заголовков.');
  state = await readState(api); appliedJSON = JSON.stringify(state); render();
  const count = compile(state).count;
  status(state.enabled ? (count ? `Работает: ${count} · ${splitRules(compile(state)).native.enabled ? 'GET/HEAD · Fetch/XHR · ' : ''}профиль «${active().name}».` : 'Нет активных правил. Заголовки не изменяются.') : 'Пауза: заголовки не изменяются.', count ? 'applied' : '');
  $('#save').disabled = false; document.documentElement.dataset.ready = 'true';
  if (location.pathname.endsWith('/options.html')) $('#open-options').hidden = true;
  if (new URL(location.href).searchParams.get('export') === '1') {
    const {levitasHeadersExport:payload} = await api.storage.session.get('levitasHeadersExport');
    if (payload) { await api.storage.session.remove('levitasHeadersExport'); downloadJSON(payload); }
    history.replaceState(null,'',location.pathname);
  }
} catch (error) {
  showError(error); status('Расширение не готово.');
  document.querySelectorAll('input,select,button').forEach(c => c.disabled = true);
  document.documentElement.dataset.ready = 'error';
}
