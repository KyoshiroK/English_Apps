// Interaction integration using a minimal DOM/media mock, not a rendering engine.
import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
test('iPhone application flows with mocked DOM, media and APIs',async t=>{
  const html=await readFile(new URL('../index.html',import.meta.url),'utf8');const elements=new Map();
  class El{constructor(tag){this.value='';this.textContent='';this.hidden=/\bhidden\b/.test(tag);this.checked=/\bchecked\b/.test(tag);this.disabled=/\bdisabled\b/.test(tag);this.open=false;this.classes=new Set();this.classList={toggle:(c,on)=>{const value=on===undefined?!this.classes.has(c):on;value?this.classes.add(c):this.classes.delete(c);return value;}};const v=tag.match(/\bvalue="([^"]*)"/);if(v)this.value=v[1];}setAttribute(k,v){this[k]=v;}removeAttribute(k){delete this[k];}showModal(){this.open=true;}close(){this.open=false;}querySelector(){return this.span??=new El('');}}
  for(const match of html.matchAll(/<[^>]*\bid="([^"]+)"[^>]*>/g))elements.set(match[1],new El(match[0]));
  const $=id=>{assert.ok(elements.has(id),'UI id exists: '+id);return elements.get(id);};
  Object.assign($('connectionMode'),{value:'direct'});$('imageSize').value='1600';$('answerStyle').value='short';$('voiceEngine').value='record';$('silence').value='1800';$('speechLang').value='en-US';
  const docEvents={};globalThis.document={getElementById:$,addEventListener:(e,f)=>docEvents[e]=f,createElement:()=>({width:0,height:0,getContext:()=>({fillRect(){},drawImage(){}}),toDataURL:()=> 'data:image/jpeg;base64,AA=='})};
  const stored=new Map();globalThis.localStorage={getItem:k=>stored.get(k)||null,setItem:(k,v)=>stored.set(k,v)};
  let speech,rec;
  class Speech{start(){speech=this;this.onstart();}stop(){this.onend();}abort(){this.onend();}}
  class Media{static isTypeSupported(m){return m==='audio/mp4';}constructor(stream,options){this.mimeType=options.mimeType;rec=this;this.state='inactive';}start(){this.state='recording';}stop(){this.state='inactive';this.ondataavailable({data:new Blob(['audio bytes'],{type:this.mimeType})});this.onstop();}}
  const mediaDevices={getUserMedia:async()=>({getTracks:()=>[{stop(){}}]})};Object.defineProperty(globalThis,'navigator',{value:{userAgent:'iPhone',mediaDevices},configurable:true});
  globalThis.window={SpeechRecognition:Speech,MediaRecorder:Media,addEventListener(){}};globalThis.MediaRecorder=Media;globalThis.createImageBitmap=async()=>({width:300,height:200,close(){}});
  const originalFetch=globalThis.fetch;let calls=[],hold=false;
  globalThis.fetch=async(url,init)=>{calls.push({url,init});if(hold)return new Promise((resolve,reject)=>init.signal.addEventListener('abort',()=>reject(new DOMException('abort','AbortError'))));if(url.endsWith('/transcriptions'))return Response.json({text:'She ___ to school. A go B goes'});const body=JSON.parse(init.body),photo=body.input[0].content.some(p=>p.type==='input_image');const raw=photo?'[ANSWER]\nB. goes\n[TRANSCRIPT]\nShe ___ to school. A go B goes\n[REASON]\n三人称単数。':'B. goes';return new Response('data: '+JSON.stringify({type:'response.output_text.delta',delta:raw})+'\n\ndata: '+JSON.stringify({type:'response.completed'})+'\n\n');};
  const settle=async()=>{for(let i=0;i<15;i++)await new Promise(r=>setTimeout(r,0));};
  try{
    await import('../app.js');assert.equal($('voiceEngine').value,'record');
    await t.test('credentials stay out of persisted settings',()=>{$('settingsOpen').onclick();$('apiKey').value='private-key';$('settingsForm').onsubmit({preventDefault(){}});assert.equal(stored.get('eqa-settings').includes('private-key'),false);assert.equal($('apiKey').value,'');});
    await t.test('text answer and instant mode switch',async()=>{$('sample').onclick();await $('voiceSolve').onclick();await settle();assert.equal($('voiceAnswer').textContent,'B. goes');$('modeDual').onclick();assert.equal($('photoPanel').hidden,false);$('layoutToggle').onclick();assert.ok($('workspace').classes.has('vertical'));});
    await t.test('photo transcription and answer in a single request',async()=>{await $('imageFile').onchange({target:{files:[new File(['a'],'a.jpg',{type:'image/jpeg'})],value:'a'}});assert.match($('photoText').value,/She/);assert.match($('photoAnswer').textContent,/B. goes/);});
    await t.test('iPhone recording uses MP4 and chains transcription to answer',async()=>{$('voiceClear').onclick();$('micStart').onclick();await settle();assert.equal(rec.mimeType,'audio/mp4');$('micStop').onclick();await settle();assert.match($('voiceText').value,/She/);assert.equal($('voiceAnswer').textContent,'B. goes');const audio=calls.find(c=>c.url.endsWith('/transcriptions'));assert.equal(audio.init.body.get('model'),'gpt-transcribe');assert.equal(audio.init.body.get('file').name,'question.mp4');});
    await t.test('browser recognition waits for complete results on stop',async()=>{$('voiceClear').onclick();$('voiceEngine').value='browser';$('voiceEngine').onchange();$('micStart').onclick();const r=[{transcript:'She ___ to school A go B goes'}];r.isFinal=true;speech.onresult({results:[r]});$('micStop').onclick();await settle();assert.equal($('voiceAnswer').textContent,'B. goes');});
    await t.test('editing cancels in-flight result instead of overwriting',async()=>{hold=true;$('voiceSolve').onclick();await settle();$('voiceText').value='New question';$('voiceText').oninput();await settle();assert.match($('voiceStatus').textContent,/更新/);assert.equal($('voiceText').value,'New question');hold=false;});
    await t.test('forget credentials forces setup before next call',async()=>{$('forget').onclick();await $('voiceSolve').onclick();await settle();assert.equal($('settings').open,true);});
  }finally{globalThis.fetch=originalFetch;}
});
