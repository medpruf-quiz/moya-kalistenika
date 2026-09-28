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
const dataTempPath = fm.joinPath(dir, "data.tmp.json");
const appPath = fm.joinPath(dir, "app.html");
const appBackupPath = fm.joinPath(dir, "app.backup.html");
const appTempPath = fm.joinPath(dir, "app.tmp.html");

const genericDefaultState = {
  schema: 4,
  version: "2.5.0",
  profile: { age:30, height:175, startWeight:70, goalMin:75, goalMax:78, proteinMin:110, proteinMax:130 },
  metrics: [], sessions: [], daily: {}, settings: { restSeconds:120 }, activeSession: null
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
function writeDataAtomic(text){
  JSON.parse(text);
  if(fm.fileExists(dataTempPath))fm.remove(dataTempPath);
  fm.writeString(dataTempPath,text);
  if(fm.fileExists(dataPath)){
    if(fm.fileExists(dataBackupPath))fm.remove(dataBackupPath);
    fm.copy(dataPath,dataBackupPath);
    fm.remove(dataPath);
  }
  fm.move(dataTempPath,dataPath);
}
function appVersionFromHTML(text){
  const m=String(text||"").match(/data-app-version="(\d+\.\d+\.\d+)"/);
  return m?m[1]:null;
}
function validApp(text,expectedVersion=null){
  if(typeof text!=="string"||text.length<20000||text.length>600000) return false;
  if(!text.includes('data-mk-app="true"')||!text.includes("__STATE_JSON__")||!text.includes("__BOOTSTRAP_META_JSON__")) return false;
  const v=appVersionFromHTML(text);
  return !!v&&(!expectedVersion||v===expectedVersion);
}
function writeAppAtomic(text,expectedVersion=null){
  if(!validApp(text,expectedVersion)) throw new Error("Invalid app package");
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
  if(!meta||!/^\d+\.\d+\.\d+$/.test(String(meta.version||""))) throw new Error("Invalid version manifest");
  if(meta.minBootstrap&&!/^\d+\.\d+\.\d+$/.test(String(meta.minBootstrap))) throw new Error("Invalid bootstrap requirement");
  return meta;
}
async function fetchRemoteApp(meta){
  const text=await requestString(meta?.appUrl||REMOTE_APP_URL,15);
  if(!validApp(text,meta?.version||null)) throw new Error("Downloaded app failed validation");
  return text;
}
async function downloadInitialApp(){
  const meta=await fetchManifest();
  if(compareVersions(BOOTSTRAP_VERSION,meta.minBootstrap||"0.0.0")<0) throw new Error("Bootstrap too old");
  const text=await fetchRemoteApp(meta);
  writeAppAtomic(text,meta.version);
  return text;
}
async function loadLocalApp(){
  if(fm.fileExists(appPath)){
    const text=fm.readString(appPath);
    if(validApp(text)) return text;
  }
  if(fm.fileExists(appBackupPath)){
    const backup=fm.readString(appBackupPath);
    if(validApp(backup)){fm.writeString(appPath,backup);return backup;}
  }
  return await downloadInitialApp();
}
async function runManualUpdateCheck(currentHTML){
  let notice=null,tone="good",html=currentHTML;
  try{
    const meta=await fetchManifest();
    const current=appVersionFromHTML(html)||"0.0.0";
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
      writeAppAtomic(next,meta.version);
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

let state=readJSON(dataPath);
if(!state){
  const recovered=readJSON(dataBackupPath);
  state=recovered||genericDefaultState;
  try{writeDataPrimary(JSON.stringify(state));}catch(e){console.log("Primary data recovery failed: "+e);}
}

let appHTML;
try{
  appHTML=await loadLocalApp();
}catch(e){
  const a=new Alert();
  a.title="Моя калистеника";
  a.message="Не удалось получить локальный интерфейс. Для первой установки нужен интернет. Данные не удалены.";
  a.addAction("OK");
  await a.presentAlert();
  Script.complete();
  return;
}

let updateNotice=null;
let updateTone="";
const action=(args&&args.queryParameters&&args.queryParameters.action)||"";
if(action==="checkUpdate"){
  const result=await runManualUpdateCheck(appHTML);
  appHTML=result.html;
  updateNotice=result.notice;
  updateTone=result.tone;
}

const bootstrapMeta={
  version:BOOTSTRAP_VERSION,
  localAppVersion:appVersionFromHTML(appHTML),
  repo:"medpruf-quiz/moya-kalistenika",
  runURL:URLScheme.forRunningScript(),
  updateNotice,
  updateTone
};

let html=appHTML
  .replace("__STATE_JSON__",JSON.stringify(state).replace(/<\/script/gi,"<\\/script"))
  .replace("__BOOTSTRAP_META_JSON__",JSON.stringify(bootstrapMeta).replace(/<\/script/gi,"<\\/script"));

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

web.shouldAllowRequest=(req)=>{
  const url=req.url||"";
  if(!url.startsWith("https://scriptable.local/")){
    if(/^https?:\/\//i.test(url))return false;
    return true;
  }
  try{
    if(url.includes("/state/begin")){
      const id=getParam(url,"id"),parts=Number(getParam(url,"parts"));
      if(id&&Number.isInteger(parts)&&parts>0&&parts<5000) incomingState[id]={parts:new Array(parts),created:Date.now()};
    }else if(url.includes("/state/chunk")){
      const id=getParam(url,"id"),i=Number(getParam(url,"i")),d=getParam(url,"d");
      if(incomingState[id]&&Number.isInteger(i)&&i>=0&&i<incomingState[id].parts.length&&d!=null) incomingState[id].parts[i]=d;
    }else if(url.includes("/state/end")){
      const id=getParam(url,"id"),item=incomingState[id];
      if(item&&item.parts.every(x=>typeof x==="string")){
        const data=Data.fromBase64String(item.parts.join(""));
        const text=data?data.toRawString():null;
        if(text) writeDataAtomic(text);
      }
      delete incomingState[id];
    }else if(url.includes("/action/copy-backup")){
      const text=fm.fileExists(dataPath)?fm.readString(dataPath):JSON.stringify(state);
      Pasteboard.copyString(text);
    }else if(url.includes("/action/purge-data-backup")){
      if(fm.fileExists(dataBackupPath))fm.remove(dataBackupPath);
      if(fm.fileExists(dataTempPath))fm.remove(dataTempPath);
    }
    cleanupStateChunks();
  }catch(e){
    console.log("Bridge error: "+e);
  }
  return false;
};

await web.loadHTML(html,"https://moya-kalistenika.local/");
await web.present(true);
Script.complete();
