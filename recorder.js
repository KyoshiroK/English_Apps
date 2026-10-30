// Bounded microphone recording for iPhone Safari; no third-party runtime.
export class SilenceGate {
  constructor({silenceMs=1800,maxMs=60000,noSpeechMs=15000}={}){Object.assign(this,{silenceMs,maxMs,noSpeechMs,lastVoice:0,heard:false,voiceMs:0,previous:0});}
  update(elapsed,rms,auto){const dt=Math.min(250,Math.max(0,elapsed-this.previous));this.previous=elapsed;if(rms>0.018){this.lastVoice=elapsed;this.voiceMs+=dt;if(this.voiceMs>=250)this.heard=true;}if(elapsed>=this.maxMs)return 'limit';if(auto&&this.heard&&elapsed-this.lastVoice>=this.silenceMs)return 'silence';if(!this.heard&&elapsed>=this.noSpeechMs)return 'empty';return '';}
}
export function createRecorder({getSilence,getAuto,onStatus,onDone,onError}) {
  let current=null,epoch=0;
  function cleanup(s){clearInterval(s.timer);s.stream?.getTracks().forEach(t=>t.stop());s.source?.disconnect();s.audio?.close().catch(()=>{});}
  function stop(send=true){const s=current;if(!s){if(!send)epoch++;return;}current=null;s.doneEpoch=++epoch;s.send=send;clearInterval(s.timer);if(s.recorder?.state==='recording')s.recorder.stop();else cleanup(s);}
  async function start(){
    stop(false);const id=++epoch;
    if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){onError(new Error('このブラウザは録音に対応していません。SafariでHTTPSのページを開いてください。'));return;}
    const Audio=window.AudioContext||window.webkitAudioContext;
    const s={stream:null,recorder:null,audio:null,chunks:[],send:true,timer:null,source:null};current=s;
    try {
      if(Audio){s.audio=new Audio();s.audio.resume().catch(()=>{});}
      s.stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,channelCount:1},video:false});
      if(id!==epoch){cleanup(s);return;}
      const mime=['audio/mp4','audio/webm;codecs=opus','audio/webm'].find(m=>MediaRecorder.isTypeSupported(m));
      s.recorder=new MediaRecorder(s.stream,mime?{mimeType:mime,audioBitsPerSecond:64000}:{audioBitsPerSecond:64000});
      s.recorder.ondataavailable=e=>{if(e.data.size)s.chunks.push(e.data);};
      s.recorder.onerror=()=>{s.send=false;stop(false);onError(new Error('録音中にエラーが発生しました。再度開始してください。'));};
      s.recorder.onstop=()=>{const blob=new Blob(s.chunks,{type:s.recorder.mimeType||mime||'audio/mp4'});cleanup(s);if(s.send&&s.doneEpoch===epoch&&blob.size)onDone(blob);};
      const gate=new SilenceGate();const started=performance.now();let analyser=null,values;
      if(s.audio){analyser=s.audio.createAnalyser();analyser.fftSize=2048;s.source=s.audio.createMediaStreamSource(s.stream);s.source.connect(analyser);values=new Uint8Array(analyser.fftSize);}
      s.recorder.start(1000);onStatus('録音中。問題文とすべての選択肢を読み上げてください。');
      s.timer=setInterval(()=>{let rms=0;if(analyser){analyser.getByteTimeDomainData(values);rms=Math.sqrt(values.reduce((sum,x)=>sum+((x-128)/128)**2,0)/values.length);}const elapsed=performance.now()-started;gate.silenceMs=getSilence();const result=gate.update(elapsed,rms,getAuto()&&s.audio?.state==='running');onStatus(`録音中 ${Math.floor(elapsed/1000)}秒${gate.heard?' · 音声を検出':' · 音声待ち'}。停止ボタンでも送信できます。`);if(result==='empty'&&s.audio?.state==='running'){stop(false);onError(new Error('音声を検出できませんでした。マイクに近づいて再度開始してください。'));}else if(result==='silence'||result==='limit')stop(true);},100);
    }catch(e){if(id===epoch){current=null;epoch++;cleanup(s);onError(e);}else cleanup(s);}
  }
  return {start,stop,get active(){return !!current;}};
}
