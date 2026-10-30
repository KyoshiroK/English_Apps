import {createRecorder} from './recorder.js';
import {makeBody,photoParts,consumeSSE,friendlyError} from './core.js';
const $ = id => document.getElementById(id);
let config={mode:'direct',proxyUrl:'',model:'gpt-4.1-mini',imageSize:1600,answerStyle:'short',transcribeModel:'gpt-transcribe'};
try {config={...config,...JSON.parse(localStorage.getItem('eqa-settings')||'{}')};} catch {}
let apiKey='',proxyToken='',imageData='',media=null,imageVersion=0,cameraVersion=0,contextVersion=0;
let recognition=null,listening=false,manualStop=false,stopRequested=false,silenceTimer=null,interimText='';
let speechBase='',mode='voice',speechHadError=false,speechEpoch=0;
const lanes={voice:{seq:0,controller:null,last:''},photo:{seq:0,controller:null}};
function status(lane,msg,error=false){$(lane+'Status').textContent=msg;$(lane+'Status').classList.toggle('error',error);}
function cancel(lane,reason='処理を中止しました。') {const l=lanes[lane];l.seq++;if(l.controller){l.controller.abort();l.controller=null;status(lane,reason);$(lane+'Timing').textContent='中止 / 未完了';}$(lane+'Cancel').disabled=true;}
function invalidateVoice(){abortTranscription();lanes.voice.last='';cancel('voice','問題が更新されました。再回答できます。');}
function updateConnection(){const ready=config.mode==='direct'?!!apiKey:!!proxyToken&&!!config.proxyUrl;$('connectionState').textContent=ready?'接続設定済み':'API未接続';$('connectionState').classList.toggle('active',ready);}
function openSettings() {
  $('connectionMode').value=config.mode;$('proxyUrl').value=config.proxyUrl;$('model').value=config.model;$('transcribeModel').value=config.transcribeModel;$('imageSize').value=String(config.imageSize);$('answerStyle').value=config.answerStyle;
  $('apiKey').value='';$('proxyToken').value='';$('settingsMessage').textContent='';fields();$('settings').showModal();
}
function fields(){$('directFields').hidden=$('connectionMode').value!=='direct';$('proxyFields').hidden=$('connectionMode').value!=='proxy';}
$('settingsOpen').onclick=openSettings;$('settingsClose').onclick=()=>$('settings').close();$('connectionMode').onchange=fields;
$('settingsForm').onsubmit=e=>{
  e.preventDefault();const next={mode:$('connectionMode').value,proxyUrl:$('proxyUrl').value.trim().replace(/\/$/,''),model:$('model').value.trim(),transcribeModel:$('transcribeModel').value.trim(),imageSize:Number($('imageSize').value),answerStyle:$('answerStyle').value};
  if(next.mode==='proxy') {try {const u=new URL(next.proxyUrl);if(u.protocol!=='https:'||!u.hostname.endsWith('.workers.dev')||u.username||u.password||u.search||u.hash||u.pathname!=='/')throw Error();}catch{$('settingsMessage').textContent='https://名前.workers.dev の形式で入力してください。';return;}}
  stopRecognition(false);abortTranscription();cancel('voice');cancel('photo');lanes.voice.last='';
  config=next;apiKey=$('apiKey').value.trim()||apiKey;proxyToken=$('proxyToken').value.trim()||proxyToken;
  $('apiKey').value='';$('proxyToken').value='';try{localStorage.setItem('eqa-settings',JSON.stringify(config));}catch{}
  updateConnection();$('settings').close();status('voice','設定を適用しました。回答ボタンで接続を確認できます。');
};
$('forget').onclick=()=>{apiKey='';proxyToken='';$('apiKey').value='';$('proxyToken').value='';stopRecognition(false);abortTranscription();cancel('voice');cancel('photo');updateConnection();$('settingsMessage').textContent='認証情報を消去しました。';};
function switchMode(next){const contextChanged=$('usePhoto').checked&&next!==mode;mode=next;$('workspace').classList.toggle('dual',next==='dual');$('photoPanel').hidden=next!=='dual';$('photoContextLabel').hidden=next!=='dual';$('layoutTools').hidden=next!=='dual';$('modeVoice').setAttribute('aria-pressed',String(next==='voice'));$('modeDual').setAttribute('aria-pressed',String(next==='dual'));if(next!=='dual')closeCamera();if(contextChanged){contextVersion++;invalidateVoice();}}
$('modeVoice').onclick=()=>switchMode('voice');$('modeDual').onclick=()=>switchMode('dual');
document.addEventListener('keydown',e=>{if(!$('settings').open&&e.altKey&&['1','2'].includes(e.key)){e.preventDefault();switchMode(e.key==='1'?'voice':'dual');}});
function requireConnection(){if(config.mode==='direct'&&!apiKey){openSettings();throw new Error('「接続・設定」でAPIキーを入力してください。');}if(config.mode==='proxy'&&(!proxyToken||!config.proxyUrl)){openSettings();throw new Error('中継サーバーのURLと接続パスワードを入力してください。');}}
async function request(lane,task,text='',image='') {
  try {requireConnection();}catch(e){status(lane,e.message,true);return false;}
  cancel(lane);const l=lanes[lane],seq=++l.seq,controller=new AbortController();l.controller=controller;
  $(lane+'Cancel').disabled=false;$(lane+'Answer').textContent='';$(lane+'Timing').textContent='接続中…';status(lane,'回答を生成しています…');
  const started=performance.now();let first=null,raw='',timeout=false;const timer=setTimeout(()=>{timeout=true;controller.abort();},60000);
  const key= config.mode==='direct'?apiKey:proxyToken;
  try {
    const response=await fetch(config.mode==='direct'?'https://api.openai.com/v1/responses':config.proxyUrl,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+key},body:JSON.stringify(makeBody({model:config.model,task,text,image,style:config.answerStyle})),signal:controller.signal});
    if(!response.ok){let message='';try{message=(await response.json()).error?.message;}catch{}throw new Error(friendlyError(response.status,message));}
    await consumeSSE(response.body,delta=>{
      if(seq!==l.seq)return;
      if(first===null){first=performance.now();$(lane+'Timing').textContent=`最初の文字 ${((first-started)/1000).toFixed(2)}秒`;}
      raw+=delta;
      if(task==='photo') {const p=photoParts(raw);$(lane+'Answer').textContent=p.answer+(p.reason?'\n\n'+p.reason:'');if(p.transcript)$('photoText').value=p.transcript;}
      else if(task==='ocr')$('photoText').value=raw;
      else $(lane+'Answer').textContent=raw;
    });
    if(seq!==l.seq)return false;
    if(!raw.trim())throw new Error('回答テキストが返りませんでした。モデルの対応状況を確認してください。');
    if(task==='photo'&&!photoParts(raw).transcript)throw new Error('文字起こしの形式が不完全です。「文字起こしのみ」で再試行してください。');
    if(lane==='photo'&&task!=='voice'){contextVersion++;if($('usePhoto').checked)invalidateVoice();}
    if(task==='ocr')$('photoAnswer').textContent='文字起こし完了。「修正文で回答」で回答できます。';
    $(lane+'Timing').textContent=`最初の文字 ${first===null?'—':((first-started)/1000).toFixed(2)+'秒'} / 完了 ${((performance.now()-started)/1000).toFixed(2)}秒`;
    status(lane,'完了しました。問題文と回答を確認してください。');return true;
  }catch(e){if(seq!==l.seq)return false;const aborted=e.name==='AbortError';status(lane,timeout?'60秒でタイムアウトしました。再実行してください。':aborted?'処理を中止しました。':e.message==='Failed to fetch'?'通信できません。ネットワーク、社内プロキシ、URL、CORSを確認してください。':e.message,true);$(lane+'Timing').textContent=`未完了 / ${((performance.now()-started)/1000).toFixed(2)}秒`;return false;
  }finally{clearTimeout(timer);if(seq===l.seq){l.controller=null;$(lane+'Cancel').disabled=true;}}
}
function voiceInput(){let text=$('voiceText').value.trim();if(mode==='dual'&&$('usePhoto').checked){const p=$('photoText').value.trim();if(p)text='Photo question:\n'+p+'\n\nSpoken question / additional data:\n'+text;}return text;}
async function solveVoice(auto=false){clearTimeout(silenceTimer);if(mode==='dual'&&$('usePhoto').checked&&lanes.photo.controller){status('voice','写真の読み取り完了後に回答してください。');return;}const text=voiceInput();if(!text){status('voice','問題文と選択肢を入力してください。',true);return;}const signature=JSON.stringify([text,config.answerStyle,config.model,contextVersion]);if(auto&&signature===lanes.voice.last)return;lanes.voice.last=signature;const ok=await request('voice','voice',text);if(!ok&&lanes.voice.last===signature)lanes.voice.last='';}
$('voiceSolve').onclick=()=>{stopRecognition(false);solveVoice();};$('voiceCancel').onclick=()=>{abortTranscription();stopRecognition(false);lanes.voice.last='';cancel('voice');};$('photoCancel').onclick=()=>cancel('photo');
$('voiceText').oninput=()=>{clearTimeout(silenceTimer);if(listening)stopRecognition(false);invalidateVoice();};
$('photoText').oninput=()=>{cancel('photo','問題文が編集されました。「修正文で回答」を押してください。');contextVersion++;if($('usePhoto').checked)invalidateVoice();};
$('usePhoto').onchange=()=>{contextVersion++;invalidateVoice();};
$('sample').onclick=()=>{stopRecognition(false);$('voiceText').value='Which word best completes the sentence? She ___ to school every day. A. go B. goes C. going D. gone';invalidateVoice();status('voice','サンプルを入力しました。「この問題に回答」を押してください。');};
$('voiceClear').onclick=()=>{stopRecognition(false);$('voiceText').value='';$('interim').textContent='';invalidateVoice();$('voiceAnswer').textContent='回答がここに表示されます。';$('voiceTiming').textContent='待機中';status('voice','新しい問題を入力してください。');};
function scheduleVoice(){clearTimeout(silenceTimer);if(recorder.active)return;if($('autoVoice').checked&& !interimText &&$('voiceText').value.trim())silenceTimer=setTimeout(()=>solveVoice(true),Number($('silence').value));}
$('autoVoice').onchange=()=>{$('autoVoice').checked?scheduleVoice():clearTimeout(silenceTimer);};$('silence').onchange=()=>{if(listening)scheduleVoice();};
function micState(on){listening=on;$('micStart').disabled=on;$('micStop').disabled=!on;$('micBadge').textContent=on?'● 認識中':'マイク停止中';$('micBadge').classList.toggle('active',on);}
function startRecognition(){
  if(listening)return;const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SR){$('voiceEngine').value='record';status('voice','このブラウザは音声認識に対応していません。録音方式に切り替えました。もう一度開始してください。',true);return;}
  clearTimeout(silenceTimer);manualStop=false;stopRequested=false;speechHadError=false;speechBase=$('voiceText').value.trim();interimText='';const epoch=++speechEpoch;
  const r=new SR();recognition=r;r.lang=$('speechLang').value;r.continuous=true;r.interimResults=true;r.maxAlternatives=1;
  r.onstart=()=>{if(epoch!==speechEpoch)return;micState(true);status('voice','認識中。問題文とすべての選択肢を読み上げてください。');};
  r.onresult=e=>{
    if(epoch!==speechEpoch)return;
    clearTimeout(silenceTimer);let final='',interim='';for(let i=0;i<e.results.length;i++){const result=e.results[i];if(result.isFinal)final+=result[0].transcript+' ';else interim+=result[0].transcript;}
    const next=[speechBase,final.trim()].filter(Boolean).join('\n');
    if(next!==$('voiceText').value){$('voiceText').value=next;invalidateVoice();}
    interimText=interim;$('interim').textContent=interim?'認識中: '+interim:'';
    if(interim)invalidateVoice();else if(!stopRequested)scheduleVoice();
  };
  r.onerror=e=>{if(epoch!==speechEpoch)return;speechHadError=true;clearTimeout(silenceTimer);status('voice',({ 'not-allowed':'マイクの利用を許可してください。','audio-capture':'マイクが見つかりません。','network':'音声認識サービスに接続できません。ネットワークまたはブラウザを確認してください。','no-speech':'音声を検出できませんでした。もう一度開始してください。','aborted':'音声認識を中止しました。'})[e.error]||'音声認識エラー: '+e.error,true);};
  r.onend=()=>{if(epoch!==speechEpoch)return;micState(false);recognition=null;if(interimText){status('voice','未確定の音声があります。認識中テキストを確認し、必要なら問題欄に補ってください。',true);interimText='';clearTimeout(silenceTimer);return;}if(speechHadError)return;if(manualStop){solveVoice(true);}else if($('autoVoice').checked)scheduleVoice();else status('voice','認識が終了しました。内容を確認して回答ボタンを押してください。');};
  try{r.start();micState(true);}catch(e){micState(false);status('voice',e.message,true);}
}
function stopRecognition(answer){if(recorder.active){recorder.stop(answer);micState(false);return;}if(!answer){recorder.stop(false);abortTranscription();}clearTimeout(silenceTimer);manualStop=answer;stopRequested=true;if(recognition){if(answer)recognition.stop();else{speechEpoch++;recognition.abort();recognition=null;interimText='';$('interim').textContent='';micState(false);}}else if(answer)solveVoice();}

let transcriptionController=null,transcriptionSeq=0,recordBase='';
function abortTranscription(){transcriptionSeq++;if(transcriptionController){transcriptionController.abort();transcriptionController=null;$('voiceCancel').disabled=true;status('voice','文字起こしを中止しました。');}}
async function transcribe(blob){
  micState(false);abortTranscription();const seq=transcriptionSeq,controller=new AbortController();transcriptionController=controller;
  $('voiceCancel').disabled=false;status('voice','音声を文字起こししています…');const start=performance.now();let timeout=false;
  const timer=setTimeout(()=>{timeout=true;controller.abort();},60000);
  try{requireConnection();if(blob.size>12*1024*1024)throw new Error('録音が大きすぎます。問題を分けて録音してください。');
    const form=new FormData();form.append('file',blob,blob.type.includes('mp4')?'question.mp4':'question.webm');form.append('model',config.transcribeModel);
    const response=await fetch(config.mode==='direct'?'https://api.openai.com/v1/audio/transcriptions':config.proxyUrl+'/transcribe',{method:'POST',headers:{Authorization:'Bearer '+(config.mode==='direct'?apiKey:proxyToken)},body:form,signal:controller.signal});
    if(!response.ok)throw new Error(friendlyError(response.status,''));const result=await response.json();if(seq!==transcriptionSeq)return;
    if(typeof result.text!=='string'||!result.text.trim())throw new Error('音声を読み取れませんでした。もう一度録音してください。');
    $('voiceText').value=[recordBase,result.text.trim()].filter(Boolean).join('\n');transcriptionController=null;
    $('interim').textContent=`文字起こし ${((performance.now()-start)/1000).toFixed(2)}秒`;
    await solveVoice();
  }catch(e){if(seq!==transcriptionSeq)return;status('voice',timeout?'文字起こしが60秒でタイムアウトしました。':e.name==='AbortError'?'文字起こしを中止しました。':e.message,true);}
  finally{clearTimeout(timer);if(seq===transcriptionSeq){transcriptionController=null;if(!lanes.voice.controller)$('voiceCancel').disabled=true;}}
}
const recorder=createRecorder({getSilence:()=>Number($('silence').value),getAuto:()=>$('autoVoice').checked,onStatus:msg=>status('voice',msg),onDone:blob=>transcribe(blob),onError:e=>{micState(false);status('voice','録音できません: '+e.message,true);}});
function startRecording(){try{requireConnection();}catch(e){status('voice',e.message,true);return;}stopRecognition(false);invalidateVoice();recordBase=$('voiceText').value.trim();$('interim').textContent='録音後に文字起こしを表示します。';micState(true);recorder.start();}
function updateEngineHint(){$('speechLang').disabled=$('voiceEngine').value==='record';$('engineHint').textContent=$('voiceEngine').value==='record'?'iPhone向け録音方式。無音または停止ボタンで文字起こし→自動回答。1回最大60秒。録音中は画面を開いたままにしてください。':'認識途中の文字を表示します。ブラウザの対応・設定によって利用できない場合は録音方式を選んでください。';}
$('voiceEngine').onchange=()=>{stopRecognition(false);updateEngineHint();};
$('layoutToggle').onclick=()=>{const vertical=$('workspace').classList.toggle('vertical');$('layoutToggle').textContent=vertical?'左右表示に切替':'上下表示に切替';$('layoutTools').querySelector('span').textContent=vertical?'写真と音声を上下に表示':'写真と音声を左右に表示';};

$('micStart').onclick=()=>{$('voiceEngine').value==='record'?startRecording():startRecognition();};$('micStop').onclick=()=>stopRecognition(true);
$('speechLang').onchange=()=>stopRecognition(false);
function closeCamera(){cameraVersion++;if(media){media.getTracks().forEach(t=>t.stop());media=null;}$('camera').srcObject=null;$('cameraBox').hidden=true;}
$('cameraOpen').onclick=async()=>{closeCamera();try{if(!navigator.mediaDevices?.getUserMedia)throw new Error('HTTPSのページで開き、カメラ対応ブラウザを使用してください。');const epoch=cameraVersion;const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}},audio:false});if(mode!=='dual'||epoch!==cameraVersion){stream.getTracks().forEach(t=>t.stop());return;}media=stream;$('camera').srcObject=media;$('cameraBox').hidden=false;await $('camera').play();}catch(e){closeCamera();status('photo','カメラを起動できません: '+e.message+' 「写真を選択」も使えます。',true);}};
$('cameraClose').onclick=()=>{imageVersion++;closeCamera();};
async function decodeImage(file){if(typeof createImageBitmap==='function'){try{return await createImageBitmap(file,{imageOrientation:'from-image'});}catch{}}const url=URL.createObjectURL(file);try{const img=new Image();img.src=url;await img.decode();return {width:img.naturalWidth,height:img.naturalHeight,source:img,close(){}};}finally{URL.revokeObjectURL(url);}}
function canvasData(source,w,h){const ratio=Math.min(1,config.imageSize/Math.max(w,h));const c=document.createElement('canvas');c.width=Math.round(w*ratio);c.height=Math.round(h*ratio);const ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(source,0,0,c.width,c.height);return c.toDataURL('image/jpeg',.86);}
async function setImage(data){imageData=data;$('preview').src=data;$('previewBox').hidden=false;$('photoText').value='';$('photoAnswer').textContent='';contextVersion++;if($('usePhoto').checked)invalidateVoice();status('photo',`画像を準備しました（約${Math.round(data.length*.75/1024)}KB）。`);if($('photoAuto').checked)await request('photo','photo','',imageData);}
$('capture').onclick=async()=>{const v=$('camera');if(!v.videoWidth){status('photo','カメラの準備中です。',true);return;}imageVersion++;cancel('photo');const data=canvasData(v,v.videoWidth,v.videoHeight);closeCamera();await setImage(data);};
$('imageFile').onchange=async e=>{const file=e.target.files?.[0];if(!file)return;e.target.value='';const version=++imageVersion;cancel('photo');closeCamera();try{if(file.size>20*1024*1024)throw Error('20MB以下の写真を選択してください。');if(!['image/jpeg','image/png','image/webp','image/gif'].includes(file.type))throw Error('JPEG / PNG / WebP / GIFを選択してください。');const bitmap=await decodeImage(file);try{if(version===imageVersion)await setImage(canvasData(bitmap.source||bitmap,bitmap.width,bitmap.height));}finally{bitmap.close();}}catch(e){status('photo','写真を開けません: '+e.message,true);}};
$('removeImage').onclick=()=>{imageVersion++;cancel('photo');imageData='';$('preview').removeAttribute('src');$('previewBox').hidden=true;$('photoText').value='';$('photoAnswer').textContent='写真の回答がここに表示されます。';$('photoTiming').textContent='待機中';contextVersion++;if($('usePhoto').checked)invalidateVoice();status('photo','写真を解除しました。');};
$('photoSolve').onclick=()=>{if(!imageData){status('photo','写真を選択してください。',true);return;}request('photo','photo','',imageData);};
$('ocrOnly').onclick=()=>{if(!imageData){status('photo','写真を選択してください。',true);return;}request('photo','ocr','',imageData);};
$('photoTextSolve').onclick=()=>{const text=$('photoText').value.trim();if(!text){status('photo','問題文を入力してください。',true);return;}request('photo','voice',text);};
document.addEventListener('visibilitychange',()=>{if(document.hidden){imageVersion++;closeCamera();stopRecognition(false);}});
window.addEventListener('pagehide',()=>{closeCamera();stopRecognition(false);abortTranscription();cancel('voice');cancel('photo');apiKey='';proxyToken='';});
updateConnection();if(!/iPhone|iPad|iPod/.test(navigator.userAgent)&&(window.SpeechRecognition||window.webkitSpeechRecognition))$('voiceEngine').value='browser';updateEngineHint();
