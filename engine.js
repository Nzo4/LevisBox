import {compile, initialState, validateState} from './model.js';
import {splitRules} from './network.js';
export const storageKey = 'levitasHeaders';
export async function readState(api) {
  const stored = (await api.storage.local.get(storageKey))[storageKey];
  return stored === undefined ? initialState() : validateState(stored);
}
export async function applyState(api, state, compiled = compile(state)) {
  const next = splitRules(compiled);
  const oldRules = await api.declarativeNetRequest.getDynamicRules();
  const oldNative = await api.runtime.sendNativeMessage('dev.levitas.browser.headers',{kind:'get'});
  if (!oldNative?.ok) throw new Error(oldNative?.error || 'Обновите Levitas для поддержки нестандартных заголовков.');
  await api.declarativeNetRequest.updateDynamicRules({removeRuleIds: oldRules.map(r => r.id), addRules: next.rules});
  try {
    const response = await api.runtime.sendNativeMessage('dev.levitas.browser.headers',next.native);
    if (!response?.ok) throw new Error(response?.error || 'Levitas не применил нестандартные заголовки.');
    await api.storage.local.set({[storageKey]: state});
  }
  catch (error) {
    try {
      await api.declarativeNetRequest.updateDynamicRules({removeRuleIds: next.rules.map(r => r.id), addRules: oldRules});
      const restored = await api.runtime.sendNativeMessage('dev.levitas.browser.headers',{kind:'apply',...oldNative.config});
      if (!restored?.ok) throw Error('Native rollback');
    } catch {
      throw new Error('Настройки не сохранены; восстановить предыдущие сетевые правила не удалось. Выключите расширение в менеджере.');
    }
    throw new Error((error?.message || 'Настройки не сохранены.') + ' Предыдущие правила восстановлены.');
  }
  // Badge is informational; a badge failure must not roll back saved rules.
  try {
    await api.action.setBadgeText({text: compiled.count ? String(compiled.count) : ''});
    await api.action.setBadgeBackgroundColor({color: '#277354'});
  } catch {}
  return compiled;
}
