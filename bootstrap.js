// Моя калистеника — стабильный локальный загрузчик Scriptable
// Bootstrap 1.0.0. Пользовательские данные хранятся только на iPhone.

const BOOTSTRAP_VERSION = "1.0.0";
const RAW_BASE = "https://raw.githubusercontent.com/medpruf-quiz/moya-kalistenika/main/";
const REMOTE_APP_URL = RAW_BASE + "app.html";

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
  version: "2.4.0",
  profile: { age:30, height:175, startWeight:70, goalMin:75, goalMax:78, proteinMin:110, proteinMax:130 },
  metrics: [], sessions: [], daily: {}, settings: { restSeconds:120 }, activeSession: null
};

function readJSON(path){
  if(!fm.fileExists(path)) return null;
  try{const obj=JSON.parse(fm.readString(path));return obj&&typeof obj==="object"?obj:null;}catch(e){return null;}
}
function writeDataAtomic(text){
  JSON.parse(text);
  if(fm.fileExists(dataTempPath)) fm.remove(dataTempPath);
  fm.writeString(dataTempPath,text);
  if(fm.fileExists(dataPath)){
    if(fm.fileExists(dataBackupPath)) fm.remove(dataBackupPath);
    fm.copy(dataPath,dataBackupPath);
    fm.remove(dataPath);
  }
  fm.move(dataTempPath,dataPath);
}
function appVersionFromHTML(text){const m=String(text||"").match(/data-app-version="(\d+\.\d+\.\d+)"/);return m?m[1]:null;}
function validApp(text,expectedVersion=null){
  if(typeof text!=="string"||text.length<20000||text.length>600000) return false;
  if(!text.includes('data-mk-app="true"')||!text.includes("__STATE_JSON__")||!text.includes("__BOOTSTRAP_META_JSON__")) return false;
  const v=appVersionFromHTML(text);return !!v&&(!expectedVersion||v===expectedVersion);
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
async function downloadInitialApp(){
  const req=new Request(REMOTE_APP_URL+"?t="+Date.now());req.timeoutInterval=12;const text=await req.loadString();
  if(!validApp(text)) throw new Error("Downloaded app failed validation");writeAppAtomic(text);return text;
}
async function loadLocalApp(){
  if(fm.fileExists(appPath)){
    const text=fm.readString(appPath);if(validApp(text))return text;
  }
  if(fm.fileExists(appBackupPath)){
    const backup=fm.readString(appBackupPath);if(validApp(backup)){fm.writeString(appPath,backup);return backup;}
  }
  return await downloadInitialApp();
}

let state=readJSON(dataPath);
if(!state){
  state=readJSON(dataBackupPath)||genericDefaultState;
  try{writeDataAtomic(JSON.stringify(state));}catch(e){}
}

let appHTML;
try{appHTML=await loadLocalApp();}
catch(e){
  const a=new Alert();a.title="Моя калистеника";a.message="Не удалось получить локальный интерфейс. Для первой установки нужен интернет. Данные не удалены.";a.addAction("OK");await a.presentAlert();Script.complete();return;
}

const bootstrapMeta={version:BOOTSTRAP_VERSION,localAppVersion:appVersionFromHTML(appHTML),repo:"medpruf-quiz/moya-kalistenika"};
let html=appHTML
  .replace("__STATE_JSON__",JSON.stringify(state).replace(/<\/script/gi,"<\\/script"))
  .replace("__BOOTSTRAP_META_JSON__",JSON.stringify(bootstrapMeta).replace(/<\/script/gi,"<\\/script"));

const web=new WebView();
const incomingState={};
const incomingApp={};
function getParam(url,name){const m=url.match(new RegExp("[?&]"+name+"=([^&]*)"));return m?decodeURIComponent(m[1]):null;}
function cleanup(map){const now=Date.now();Object.keys(map).forEach(k=>{if(now-(map[k].created||0)>60000)delete map[k];});}
web.shouldAllowRequest=(req)=>{
  const url=req.url||"";
  if(!url.startsWith("https://scriptable.local/")) return true;
  try{
    if(url.includes("/state/begin")){
      const id=getParam(url,"id"),parts=Number(getParam(url,"parts"));if(id&&Number.isInteger(parts)&&parts>0&&parts<5000)incomingState[id]={parts:new Array(parts),created:Date.now()};
    }else if(url.includes("/state/chunk")){
      const id=getParam(url,"id"),i=Number(getParam(url,"i")),d=getParam(url,"d");if(incomingState[id]&&Number.isInteger(i)&&i>=0&&i<incomingState[id].parts.length&&d!=null)incomingState[id].parts[i]=d;
    }else if(url.includes("/state/end")){
      const id=getParam(url,"id"),item=incomingState[id];if(item&&item.parts.every(x=>typeof x==="string")){const data=Data.fromBase64String(item.parts.join("")),text=data?data.toRawString():null;if(text)writeDataAtomic(text);}delete incomingState[id];
    }else if(url.includes("/app/begin")){
      const id=getParam(url,"id"),parts=Number(getParam(url,"parts")),version=getParam(url,"version");if(id&&version&&Number.isInteger(parts)&&parts>0&&parts<1000)incomingApp[id]={parts:new Array(parts),version,created:Date.now()};
    }else if(url.includes("/app/chunk")){
      const id=getParam(url,"id"),i=Number(getParam(url,"i")),d=getParam(url,"d");if(incomingApp[id]&&Number.isInteger(i)&&i>=0&&i<incomingApp[id].parts.length&&d!=null)incomingApp[id].parts[i]=d;
    }else if(url.includes("/app/end")){
      const id=getParam(url,"id"),item=incomingApp[id];if(item&&item.parts.every(x=>typeof x==="string")){const data=Data.fromBase64String(item.parts.join("")),text=data?data.toRawString():null;if(text)writeAppAtomic(text,item.version);}delete incomingApp[id];
    }else if(url.includes("/action/copy-backup")){
      const text=fm.fileExists(dataPath)?fm.readString(dataPath):JSON.stringify(state);Pasteboard.copyString(text);
    }
    cleanup(incomingState);cleanup(incomingApp);
  }catch(e){console.log("Bridge error: "+e);}
  return false;
};

await web.loadHTML(html,"https://moya-kalistenika.local/");
await web.present(true);
Script.complete();
