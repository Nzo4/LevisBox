import {validateState, compile} from './model.js';
export function exportData(state) {
  validateState(state);
  return {format: 'levisbox', ...structuredClone(state)};
}
export function importData(source, existing) {
  validateState(existing);
  let profiles, activeIndex = 0;
  if (['levisbox', 'levitas-headers'].includes(source?.format)) {
    validateState(source);
    activeIndex = source.profiles.findIndex(p => p.id === source.activeId);
    profiles = structuredClone(source.profiles);
  } else if (source?.name === 'modbox' && source.version === 1 && Array.isArray(source.folders)) {
    profiles = [];
    for (const folder of source.folders) {
      if (!Array.isArray(folder.tabs)) throw new Error('Некорректная папка ModBox.');
      for (const tab of folder.tabs) {
        if (tab.blockedRequests?.length || tab.redirectRequests?.length)
          throw new Error('Этот импорт поддерживает HTTP-заголовки. Файл также содержит блокировки или перенаправления.');
        if (typeof tab.requestDomains !== 'string') throw new Error('Некорректный фильтр доменов ModBox.');
        const headers = [];
        for (const [key,target] of [['requestHeaders','request'],['responseHeaders','response']]) {
          if (!Array.isArray(tab[key])) throw new Error('Некорректный список заголовков ModBox.');
          for (const h of tab[key]) {
            if (h.condition?.urlFilter || h.condition?.requestDomains)
              throw new Error('Индивидуальные фильтры заголовков ModBox пока не поддерживаются. Импорт отменён.');
            if (typeof h.name !== 'string' || typeof h.value !== 'string' || typeof h.active !== 'boolean')
              throw new Error('Некорректный заголовок ModBox.');
            headers.push({enabled:h.active && folder.active !== false && tab.active !== false,
              name:h.name,value:h.value,target,operation:h.operation || 'set'});
          }
        }
        const domains = tab.requestDomains.trim().split(/[\s,;]+/).filter(Boolean);
        for (const domain of domains.length ? domains : ['*']) {
          // ModBox requestDomains includes the named domain and its subdomains.
          const scope = domain === '*' || domain.startsWith('*.') || domain.includes('://') ? domain : '*.' + domain;
          const name = [folder.name, tab.name].filter(Boolean).join(' / ') || 'ModBox';
          profiles.push({id:crypto.randomUUID(),name:name.slice(0,80),scope,headers:structuredClone(headers)});
        }
      }
    }
  } else throw new Error('Поддерживаются JSON LevisBox / Levitas Headers и экспорт ModBox версии 1.');
  if (!profiles.length) throw new Error('В файле нет профилей.');
  profiles.forEach(p => { p.id = crypto.randomUUID(); });
  const state = structuredClone(existing);
  // Replace only the untouched initial placeholder, never an existing rule set.
  if (state.profiles.length === 1 && !state.profiles[0].scope && !state.profiles[0].headers.length)
    state.profiles = [];
  state.profiles.push(...profiles);
  state.activeId = profiles[activeIndex].id;
  state.enabled = false;
  validateState(state);
  for (const p of profiles) compile({...state, enabled:true, activeId:p.id});
  return {state, count:profiles.length};
}
