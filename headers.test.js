import {test} from 'node:test';
import assert from 'node:assert/strict';
import {initialState, newProfile, scopeFilter, compile} from './model.js';
import {applyState, readState, storageKey} from './engine.js';
import {exportData, importData} from './transfer.js';
import {splitRules} from './network.js';
function config() {
  const s = initialState(); s.profiles[0].scope = 'api.example.com';
  s.profiles[0].headers = [{enabled:true,target:'request',operation:'set',name:'Accept-Language',value:'test'}];
  return s;
}
function fake() {
  const current = {rules:[],storage:{},native:{enabled:false},rejectRules:false,rejectStorage:false};
  const api = {storage:{local:{get:async()=>structuredClone(current.storage),set:async x=>{
    if (current.rejectStorage) throw Error('disk'); Object.assign(current.storage,structuredClone(x));
  }}},declarativeNetRequest:{getDynamicRules:async()=>structuredClone(current.rules),updateDynamicRules:async ({removeRuleIds,addRules})=>{
    if (current.rejectRules) throw Error('unsupported header');
    current.rules = current.rules.filter(r=>!removeRuleIds.includes(r.id)).concat(structuredClone(addRules));
  }},runtime:{sendNativeMessage:async (_,input)=>{
    if(input.kind==='get')return {ok:true,config:structuredClone(current.native)};
    current.native=structuredClone(input);return {ok:true};
  }},action:{setBadgeText:async()=>{},setBadgeBackgroundColor:async()=>{}}};
  return {api,current};
}
test('initial state is inert and requests no site access',()=>{assert.deepEqual(compile(initialState()),{rules:[],origins:[],count:0});});
test('standard set/remove use DNR, custom names and append use Fetch/XHR',()=>{
  const s=config();s.profiles[0].headers.push(
    {enabled:true,target:'request',operation:'remove',name:'Authorization',value:''},
    {enabled:true,target:'request',operation:'append',name:'Accept',value:'application/test'},
    {enabled:true,target:'response',operation:'set',name:'X-Reply',value:'reply'});
  const result=splitRules(compile(s));
  assert.equal(result.rules.length,1);
  assert.deepEqual(result.rules[0].action.requestHeaders.map(h=>h.header),['Accept-Language','Authorization']);
  assert.deepEqual(result.native.requestHeaders,[{header:'Accept',operation:'append',value:'application/test'}]);
  assert.deepEqual(result.native.responseHeaders,[{header:'X-Reply',operation:'set',value:'reply'}]);
  assert.equal(result.native.enabled,true);
  s.enabled=false;const paused=splitRules(compile(s));assert.equal(paused.native.enabled,false);assert.deepEqual(paused.rules,[]);
});
test('storage failure restores native header configuration too',async()=>{
  const s=config();s.profiles[0].headers[0].name='X-Custom';const {api,current}=fake();
  await applyState(api,s);const before=structuredClone(current.native);
  current.rejectStorage=true;s.enabled=false;await assert.rejects(applyState(api,s));
  assert.deepEqual(current.native,{kind:'apply',...before});
});
test('domain filter separates unrelated hosts and includes both HTTP protocols',()=>{
  const f=scopeFilter('api.example.com'), r=new RegExp(f.regex);
  assert(r.test('https://api.example.com/a')); assert(r.test('http://api.example.com:8080/a'));
  assert(!r.test('https://badapi.example.com/a')); assert(!r.test('https://api.example.com.evil/a'));
  assert(!r.test('https://other.test/api.example.com/a')); assert(!r.test('https://child.api.example.com/a'));
  assert.deepEqual(f.origins,['http://api.example.com/*','https://api.example.com/*']);
});
test('subdomain filter includes root without matching suffix attacks',()=>{
  const r=new RegExp(scopeFilter('*.example.com').regex);
  assert(r.test('https://example.com/')); assert(r.test('https://one.two.example.com/'));
  assert(!r.test('https://badexample.com/')); assert(!r.test('https://example.com.evil/'));
});
test('URL wildcard matches path/query without widening scheme or port',()=>{
  const r=new RegExp(scopeFilter('https://api.example.com/v1/*').regex);
  assert(r.test('https://api.example.com/v1/users?q=a')); assert(!r.test('https://api.example.com/v2/users'));
  assert(!r.test('http://api.example.com/v1/users')); assert(!r.test('https://api.example.com:8080/v1/users'));
  assert(new RegExp(scopeFilter('https://api.example.com:8443/v1/*').regex).test('https://api.example.com:8443/v1/a'));
});
test('invalid scopes cannot broaden a filter',()=>{
  for(const value of ['', 'file:///etc/passwd','https://user:password@example.com/a','https://example.com/#fragment','example.com/a','exa mple.com']) assert.throws(()=>scopeFilter(value));
});
test('header rules compile requests, responses, append and remove',()=>{
  const s=config(); s.profiles[0].headers.push({enabled:true,target:'response',operation:'append',name:'X-Reply',value:'second'},
    {enabled:true,target:'request',operation:'remove',name:'X-Remove',value:'ignored'},
    {enabled:false,target:'request',operation:'set',name:'Disabled',value:'off'});
  const c=compile(s); assert.equal(c.count,3); assert.equal(c.rules[0].action.requestHeaders.length,2);
  assert.deepEqual(c.rules[0].action.requestHeaders[1],{header:'X-Remove',operation:'remove'});
  assert.equal(c.rules[0].action.responseHeaders[0].operation,'append');
});
test('duplicates are case insensitive within each header direction',()=>{
  const s=config(); s.profiles[0].headers.push({enabled:true,target:'request',operation:'set',name:'accept-language',value:'second'});
  assert.throws(()=>compile(s)); s.profiles[0].headers[1].target='response'; assert.equal(compile(s).count,2);
});
test('header injection and invalid HTTP token names are rejected',()=>{
  for(const [name,value] of [['Bad Name','ok'],['X-Test','a\r\nInjected: yes'],['X-Test','a\u0000b']]) {
    const s=config();Object.assign(s.profiles[0].headers[0],{name,value});assert.throws(()=>compile(s));
  }
});
test('pause removes rules, resume restores them and only active profile contributes',async()=>{
  const s=config(), p=newProfile('Another'); p.scope='other.example.com'; p.headers=[];s.profiles.push(p);
  const {api,current}=fake(); await applyState(api,s);assert.equal(current.rules.length,1);
  s.enabled=false;await applyState(api,s);assert.equal(current.rules.length,0);
  s.enabled=true;await applyState(api,s);assert.equal(current.rules.length,1);
  s.activeId=p.id;await applyState(api,s);assert.equal(current.rules.length,0);
});
test('engine rejection preserves prior configuration and rules',async()=>{
  const {api,current}=fake(),s=config();await applyState(api,s);
  const before=structuredClone(current);current.rejectRules=true;s.profiles[0].headers[0].value='changed';
  await assert.rejects(applyState(api,s));assert.deepEqual(current.rules,before.rules);assert.deepEqual(current.storage,before.storage);
});
test('storage failure rolls back successful rule update',async()=>{
  const {api,current}=fake(),s=config();await applyState(api,s);const before=structuredClone(current);
  current.rejectStorage=true;s.enabled=false;await assert.rejects(applyState(api,s));
  assert.deepEqual(current.rules,before.rules);assert.deepEqual(current.storage,before.storage);
});
test('native export/import preserves all values and pauses imported rules',()=>{
  const s=config();s.profiles[0].headers[0].value='sensitive-test-placeholder';
  assert.equal(exportData(s).format,'levisbox');
  const result=importData(JSON.parse(JSON.stringify(exportData(s))),initialState());
  assert.equal(result.count,1);assert.equal(result.state.enabled,false);
  assert.deepEqual(result.state.profiles[0].headers,s.profiles[0].headers);
  assert.equal(result.state.profiles[0].scope,s.profiles[0].scope);
  assert.notEqual(result.state.profiles[0].id,s.profiles[0].id);
});
test('legacy Levitas Headers exports remain importable after the rename',()=>{
  const s=config();const result=importData({format:'levitas-headers',...s},initialState());
  assert.deepEqual(result.state.profiles[0].headers,s.profiles[0].headers);
  assert.equal(result.state.enabled,false);
});
const modbox=()=>({name:'modbox',version:1,folders:[{name:'Folder',active:true,tabs:[{name:'Test',active:true,requestDomains:'example.com',blockedRequests:[],redirectRequests:[],requestHeaders:[{name:'X-First',value:'exact-value',active:true,condition:{urlFilter:'',requestDomains:''}},{name:'X-Disabled',value:'off',active:false,condition:{urlFilter:'',requestDomains:''}}],responseHeaders:[{name:'X-Response',value:'reply',active:true,condition:{urlFilter:'',requestDomains:''}}]}]}]});
test('ModBox import retains inactive headers and domain/subdomain semantics',()=>{
  const {state}=importData(modbox(),initialState()); const p=state.profiles[0];
  assert.equal(p.scope,'*.example.com');assert.equal(p.headers.length,3);assert.equal(p.headers[1].enabled,false);
  assert.equal(p.headers[2].target,'response');assert.equal(p.headers[0].value,'exact-value');assert.equal(state.enabled,false);
});
test('import appends to existing configured profiles without modifying them',()=>{
  const existing=config(),before=structuredClone(existing),result=importData(modbox(),existing);
  assert.equal(result.state.profiles.length,2);assert.deepEqual(result.state.profiles[0],before.profiles[0]);assert.deepEqual(existing,before);
});
test('unsupported ModBox conditions and traffic rules are rejected rather than broadened',()=>{
  let m=modbox();m.folders[0].tabs[0].requestHeaders[0].condition.urlFilter='restricted';assert.throws(()=>importData(m,initialState()));
  m=modbox();m.folders[0].tabs[0].blockedRequests=[{}];assert.throws(()=>importData(m,initialState()));
  assert.throws(()=>importData({name:'unknown'},initialState()));
});
test('settings read validates persisted data and survives a new UI instance',async()=>{
  const {api,current}=fake(),s=config();await applyState(api,s);assert.deepEqual(await readState(api),s);
  current.storage[storageKey]={version:99};await assert.rejects(readState(api));
});
