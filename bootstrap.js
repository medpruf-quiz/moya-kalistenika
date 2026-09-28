// Моя калистеника — стабильный локальный загрузчик Scriptable
// Bootstrap 1.3.0. Пользовательские данные хранятся только на iPhone.

const BOOTSTRAP_VERSION = "1.3.0";
const RAW_BASE = "https://raw.githubusercontent.com/medpruf-quiz/moya-kalistenika/main/";
const REMOTE_APP_URL = RAW_BASE + "app.html";
const VERSION_URL = RAW_BASE + "version.json";

const fm = FileManager.local();
const dir = fm.joinPath(fm.documentsDirectory(), "MoyaKalistenika");
if (!fm.fileExists(dir)) fm.createDirectory(dir, true);

const dataPath = fm.joinPath(dir, "data.json");
const dataBackupPath = fm.joinPath(dir, "data.backup.json");
const dataBackupTempPath = fm.joinPath(dir, "data.backup.tmp.json");
const dataTempPath = fm.joinPath(dir, "data.tmp.json");
const appPath = fm.joinPath(dir, "app.html");
const appBackupPath = fm.joinPath(dir, "app.backup.html");
const appTempPath = fm.joinPath(dir, "app.tmp.html");

const genericDefaultState = {
  schema: 5,
  revision: 0,
  version: "2.5.0",
  profile: { age:30, height:175, startWeight:70, goalMin:75, goalMax:78, proteinMin:110, proteinMax:130 },
  metrics: [], sessions: [], daily: {}, settings: { restSeconds:120, restEndAt:null }, activeSession: null
};

function versionParts(v){
  return String(v||"0").split(".").map(x=>parseInt(x,10)||0).slice(0,3).concat([0,0,0]).slice(0,3);
}
function compareVersions(a,b){
  const aa=versionParts(a),bb=versionParts(b);
  for(let i=0;i<3;i++){if(aa[i]>bb[i])return 1;if(aa[i]<bb[i])return -1;}
  return 0;
}
function readJSON(path){
  if(!fm.fileExists(path)) return null;
  try{const obj=JSON.parse(fm.readString(path));return obj&&typeof obj==="object"?obj:null;}catch(e){return null;}
}
function writeDataPrimary(text){
  JSON.parse(text);
  if(fm.fileExists(dataTempPath))fm.remove(dataTempPath);
  fm.writeString(dataTempPath,text);
  if(fm.fileExists(dataPath))fm.remove(dataPath);
  fm.move(dataTempPath,dataPath);
}
function writeDataAtomic(text){writeDataPrimary(text);}
function writeBackupSnapshot(text){
  JSON.parse(text);
  if(fm.fileExists(dataBackupTempPath))fm.remove(dataBackupTempPath);
  fm.writeString(dataBackupTempPath,text);
  if(fm.fileExists(dataBackupPath))fm.remove(dataBackupPath);
  fm.move(dataBackupTempPath,dataBackupPath);
}
function dataSchema(obj){
  const n=Number(obj?.schema);
  return Number.isInteger(n)&&n>0?n:2;
}
function appVersionFromHTML(text){
  const m=String(text||"").match(/data-app-version="(\d+\.\d+\.\d+)"/);
  return m?m[1]:null;
}
function appSchemaFromHTML(text){
  const src=String(text||"");
  const attr=src.match(/data-schema="(\d+)"/);
  if(attr)return Number(attr[1]);
  const legacy=src.match(/schema:\s*(\d+)/);
  return legacy?Number(legacy[1]):null;
}
function validApp(text,expectedVersion=null,expectedSchema=null){
  if(typeof text!=="string"||text.length<20000||text.length>600000)return false;
  if(!text.includes('data-mk-app="true"')||!text.includes("__STATE_JSON__")||!text.includes("__BOOTSTRAP_META_JSON__"))return false;
  const v=appVersionFromHTML(text),schema=appSchemaFromHTML(text);
  if(!v||!Number.isInteger(schema)||schema<=0)return false;
  if(expectedVersion&&v!==expectedVersion)return false;
  if(expectedSchema!=null&&schema!==Number(expectedSchema))return false;
  return true;
}
function appCompatibleWithData(text,currentDataSchema){
  return validApp(text)&&appSchemaFromHTML(text)>=currentDataSchema;
}
function writeAppAtomic(text,expectedVersion=null,expectedSchema=null){
  if(!validApp(text,expectedVersion,expectedSchema))throw new Error("Invalid app package");
  if(fm.fileExists(appTempPath)) fm.remove(appTempPath);
  fm.writeString(appTempPath,text);
  if(fm.fileExists(appPath)){
    if(fm.fileExists(appBackupPath)) fm.remove(appBackupPath);
    fm.copy(appPath,appBackupPath);
    fm.remove(appPath);
  }
  fm.move(appTempPath,appPath);
}
async function requestString(url,timeout=12){
  const req=new Request(url+(url.includes("?")?"&":"?")+"t="+Date.now());
  req.timeoutInterval=timeout;
  return await req.loadString();
}
async function fetchManifest(){
  const meta=JSON.parse(await requestString(VERSION_URL,10));
  if(!meta||!/^\d+\.\d+\.\d+$/.test(String(meta.version||"")))throw new Error("Invalid version manifest");
  if(meta.minBootstrap&&!/^\d+\.\d+\.\d+$/.test(String(meta.minBootstrap)))throw new Error("Invalid bootstrap requirement");
  if(!Number.isInteger(Number(meta.schema))||Number(meta.schema)<=0)throw new Error("Invalid data schema in manifest");
  meta.schema=Number(meta.schema);
  return meta;
}
async function fetchRemoteApp(meta){
  const text=await requestString(meta?.appUrl||REMOTE_APP_URL,15);
  if(!validApp(text,meta?.version||null,meta?.schema??null))throw new Error("Downloaded app failed validation");
  return text;
}
async function downloadInitialApp(currentDataSchema=2){
  const meta=await fetchManifest();
  if(compareVersions(BOOTSTRAP_VERSION,meta.minBootstrap||"0.0.0")<0)throw new Error("Bootstrap too old");
  if(meta.schema<currentDataSchema)throw new Error("Remote app is older than local data schema");
  const text=await fetchRemoteApp(meta);
  writeAppAtomic(text,meta.version,meta.schema);
  return text;
}
async function loadLocalApp(currentDataSchema){
  if(fm.fileExists(appPath)){
    const text=fm.readString(appPath);
    if(appCompatibleWithData(text,currentDataSchema))return text;
  }
  if(fm.fileExists(appBackupPath)){
    const backup=fm.readString(appBackupPath);
    if(appCompatibleWithData(backup,currentDataSchema)){
      fm.writeString(appPath,backup);
      return backup;
    }
  }
  return await downloadInitialApp(currentDataSchema);
}
async function runAutomaticBackupRestore(currentState){
  const backup=readJSON(dataBackupPath);
  if(!backup){
    const a=new Alert();a.title="Резервная копия";a.message="Автоматическая резервная копия не найдена.";a.addAction("OK");await a.presentAlert();
    return currentState;
  }
  const a=new Alert();
  a.title="Восстановить резервную копию?";
  a.message="Текущие данные будут заменены состоянием на начало предыдущего запуска приложения.";
  a.addAction("Восстановить");
  a.addCancelAction("Отмена");
  const choice=await a.presentAlert();
  if(choice!==0)return currentState;
  backup.revision=Math.max(Number(currentState?.revision)||0,Number(backup?.revision)||0,Date.now())+1;
  writeDataPrimary(JSON.stringify(backup));
  const done=new Alert();done.title="Готово";done.message="Автоматическая резервная копия восстановлена.";done.addAction("OK");await done.presentAlert();
  return backup;
}

async function runManualUpdateCheck(currentHTML){
  let notice=null,tone="good",html=currentHTML;
  try{
    const meta=await fetchManifest();
    const current=appVersionFromHTML(html)||"0.0.0";
    const currentDataSchema=dataSchema(state);
    if(meta.schema<currentDataSchema)throw new Error("Обновление несовместимо с текущей схемой данных");
    if(compareVersions(BOOTSTRAP_VERSION,meta.minBootstrap||"0.0.0")<0){
      notice="Для следующего обновления потребуется новая версия загрузчика Scriptable.";
      tone="warn";
      const a=new Alert();
      a.title="Обновление загрузчика";
      a.message="Доступна версия приложения "+meta.version+", но сначала нужно обновить bootstrap.js. Текущие данные не затронуты.";
      a.addAction("OK");
      await a.presentAlert();
      return {html,notice,tone};
    }
    if(compareVersions(meta.version,current)<=0){
      notice="У тебя актуальная версия "+current+".";
      tone="good";
      return {html,notice,tone};
    }

    const a=new Alert();
    a.title="Доступно обновление "+meta.version;
    const notes=Array.isArray(meta.notes)&&meta.notes.length?"\n\n"+meta.notes.map(x=>"• "+x).join("\n"):"";
    a.message="Текущая версия: "+current+"."+notes+"\n\nЛичные данные останутся на iPhone.";
    a.addAction("Установить");
    a.addCancelAction("Не сейчас");
    const choice=await a.presentAlert();

    if(choice===0){
      const next=await fetchRemoteApp(meta);
      writeAppAtomic(next,meta.version,meta.schema);
      html=next;
      notice="Обновлено до версии "+meta.version+".";
      tone="good";
    }else{
      notice="Обновление "+meta.version+" не установлено.";
      tone="";
    }
  }catch(e){
    console.log("Manual update check failed: "+e);
    notice="Не удалось проверить обновление. Попробуй позже.";
    tone="error";
  }
  return {html,notice,tone};
}

const action=(args&&args.queryParameters&&args.queryParameters.action)||"";
let state=readJSON(dataPath);
if(!state){
  const recovered=readJSON(dataBackupPath);
  state=recovered||genericDefaultState;
  try{writeDataPrimary(JSON.stringify(state));}catch(e){console.log("Primary data recovery failed: "+e);}
}

if(action==="restoreBackup"){
  try{state=await runAutomaticBackupRestore(state);}catch(e){console.log("Backup restore failed: "+e);}
}else if(action==="copyData"){
  try{
    const text=fm.fileExists(dataPath)?fm.readString(dataPath):JSON.stringify(state);
    Pasteboard.copyString(text);
    const a=new Alert();a.title="Готово";a.message="Текущие данные скопированы в буфер обмена.";a.addAction("OK");await a.presentAlert();
  }catch(e){
    console.log("Copy data failed: "+e);
    const a=new Alert();a.title="Не удалось скопировать";a.message="Текущие данные не удалось поместить в буфер обмена.";a.addAction("OK");await a.presentAlert();
  }
  try{writeBackupSnapshot(JSON.stringify(state));}catch(e){console.log("Backup snapshot failed: "+e);}
}else if(action==="fullReset"){
  try{
    await Notification.removePending(["moya-kalistenika-rest-timer"]).catch(()=>{});
    state=JSON.parse(JSON.stringify(genericDefaultState));
    state.revision=Date.now()+1;
    writeDataPrimary(JSON.stringify(state));
    if(fm.fileExists(dataBackupPath))fm.remove(dataBackupPath);
    if(fm.fileExists(dataBackupTempPath))fm.remove(dataBackupTempPath);
    if(fm.fileExists(dataTempPath))fm.remove(dataTempPath);
  }catch(e){
    console.log("Full reset failed: "+e);
    const a=new Alert();a.title="Сброс не выполнен";a.message="Не удалось безопасно очистить данные. Текущий файл оставлен без намеренной замены.";a.addAction("OK");await a.presentAlert();
  }
}else{
  try{writeBackupSnapshot(JSON.stringify(state));}catch(e){console.log("Backup snapshot failed: "+e);}
}

let appHTML;
try{
  appHTML=await loadLocalApp(dataSchema(state));
}catch(e){
  const a=new Alert();
  a.title="Моя калистеника";
  a.message="Не удалось открыть совместимую локальную версию приложения. Если код повреждён или устарел относительно данных, подключи интернет и запусти снова. Данные не удалены.";
  a.addAction("OK");
  await a.presentAlert();
  Script.complete();
  return;
}

let updateNotice=null;
let updateTone="";
if(action==="checkUpdate"){
  const result=await runManualUpdateCheck(appHTML);
  appHTML=result.html;
  updateNotice=result.notice;
  updateTone=result.tone;
}

function bootstrapMetaFor(appText){
  return {
    version:BOOTSTRAP_VERSION,
    localAppVersion:appVersionFromHTML(appText),
    repo:"medpruf-quiz/moya-kalistenika",
    runURL:URLScheme.forRunningScript(),
    updateNotice,
    updateTone
  };
}
function injectApp(appText){
  return appText
    .replace("__STATE_JSON__",JSON.stringify(state).replace(/<\/script/gi,"<\\/script"))
    .replace("__BOOTSTRAP_META_JSON__",JSON.stringify(bootstrapMetaFor(appText)).replace(/<\/script/gi,"<\\/script"));
}

const web=new WebView();
const incomingState={};

function getParam(url,name){
  const m=url.match(new RegExp("[?&]"+name+"=([^&]*)"));
  return m?decodeURIComponent(m[1]):null;
}
function cleanupStateChunks(){
  const now=Date.now();
  Object.keys(incomingState).forEach(k=>{if(now-(incomingState[k].created||0)>60000)delete incomingState[k];});
}

const REST_TIMER_NOTIFICATION_ID="moya-kalistenika-rest-timer";
function cancelRestNotification(){
  Notification.removePending([REST_TIMER_NOTIFICATION_ID]).catch(e=>console.log("Rest notification cancel failed: "+e));
}
function scheduleRestNotification(seconds){
  const sec=Number(seconds);
  if(!Number.isFinite(sec)||sec<10||sec>3600)return;
  cancelRestNotification();
  const n=new Notification();
  n.identifier=REST_TIMER_NOTIFICATION_ID;
  n.title="Моя калистеника";
  n.body="Отдых закончен — можно готовиться к следующему подходу.";
  n.sound="complete";
  n.threadIdentifier="moya-kalistenika";
  n.openURL=URLScheme.forRunningScript();
  n.setTriggerDate(new Date(Date.now()+sec*1000));
  n.schedule().catch(e=>console.log("Rest notification schedule failed: "+e));
}

web.shouldAllowRequest=(req)=>{
  const url=req.url||"";
  if(!url.startsWith("https://scriptable.local/")){
    if(/^https?:\/\//i.test(url))return false;
    return true;
  }
  try{
    if(url.includes("/state/begin")){
      const id=getParam(url,"id"),parts=Number(getParam(url,"parts")),mode=getParam(url,"mode")||"full";
      if(id&&Number.isInteger(parts)&&parts>0&&parts<5000&&(mode==="full"||mode==="patch"))incomingState[id]={parts:new Array(parts),mode,created:Date.now()};
    }else if(url.includes("/state/chunk")){
      const id=getParam(url,"id"),i=Number(getParam(url,"i")),d=getParam(url,"d");
      if(incomingState[id]&&Number.isInteger(i)&&i>=0&&i<incomingState[id].parts.length&&d!=null) incomingState[id].parts[i]=d;
    }else if(url.includes("/state/end")){
      const id=getParam(url,"id"),item=incomingState[id];
      if(item&&item.parts.every(x=>typeof x==="string")){
        const data=Data.fromBase64String(item.parts.join(""));
        const text=data?data.toRawString():null;
        if(text){
          const payload=JSON.parse(text);
          if(!payload||typeof payload!=="object"||Array.isArray(payload))throw new Error("Invalid state payload");
          let next;
          if(item.mode==="full"){
            next=payload;
          }else{
            next={...state};
            const allowed=["schema","revision","version","profile","metrics","sessions","daily","settings","activeSession"];
            for(const key of allowed)if(Object.prototype.hasOwnProperty.call(payload,key))next[key]=payload[key];
          }
          const currentRevision=Number(state?.revision)||0,nextRevision=Number(next?.revision)||0;
          if(nextRevision>=currentRevision){
            writeDataAtomic(JSON.stringify(next));
            state=next;
          }
        }
      }
      delete incomingState[id];
    }else if(url.includes("/action/rest-timer-start")){
      scheduleRestNotification(Number(getParam(url,"seconds")));
    }else if(url.includes("/action/rest-timer-stop")){
      cancelRestNotification();
    }
    cleanupStateChunks();
  }catch(e){
    console.log("Bridge error: "+e);
  }
  return false;
};

async function loadAndPreflight(appText){
  await web.loadHTML(injectApp(appText),"https://moya-kalistenika.local/");
  if(compareVersions(appVersionFromHTML(appText)||"0.0.0","2.5.0")<0)return true;
  try{return !!(await web.evaluateJavaScript("Boolean(window.__MK_READY__)",false));}
  catch(e){console.log("App preflight failed: "+e);return false;}
}

let ready=await loadAndPreflight(appHTML);
if(!ready){
  let rollback=null;
  if(fm.fileExists(appBackupPath)){
    const candidate=fm.readString(appBackupPath);
    if(appCompatibleWithData(candidate,dataSchema(state)))rollback=candidate;
  }
  if(rollback){
    fm.writeString(appPath,rollback);
    appHTML=rollback;
    updateNotice="Новое обновление не прошло проверку запуска. Восстановлена предыдущая совместимая версия.";
    updateTone="warn";
    ready=await loadAndPreflight(appHTML);
  }
}
if(!ready){
  const a=new Alert();
  a.title="Не удалось открыть приложение";
  a.message="Код приложения не прошёл проверку запуска. Данные сохранены. Попробуй позже проверить обновление или восстановить совместимую версию кода.";
  a.addAction("OK");
  await a.presentAlert();
  Script.complete();
  return;
}

await web.present(true);
Script.complete();
