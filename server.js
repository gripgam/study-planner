import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import Database from 'better-sqlite3';
import webpush from 'web-push';
import { DateTime } from 'luxon';

const required=['VAPID_PUBLIC_KEY','VAPID_PRIVATE_KEY','VAPID_SUBJECT'];
if(required.some(key=>!process.env[key])) throw new Error(`Missing required environment variables: ${required.filter(key=>!process.env[key]).join(', ')}`);
webpush.setVapidDetails(process.env.VAPID_SUBJECT,process.env.VAPID_PUBLIC_KEY,process.env.VAPID_PRIVATE_KEY);
const databasePath=process.env.DATABASE_PATH||'./data/study-planner.sqlite';
fs.mkdirSync(path.dirname(databasePath),{recursive:true});
const db=new Database(databasePath);
const appOrigin=String(process.env.APP_ORIGIN||'').replace(/\/$/,'');
db.pragma('journal_mode = WAL');
db.exec(`CREATE TABLE IF NOT EXISTS devices (device_id TEXT PRIMARY KEY, token_hash TEXT NOT NULL, subscription_json TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS schedules (device_id TEXT NOT NULL, plan_id TEXT NOT NULL, schedule_json TEXT NOT NULL, PRIMARY KEY(device_id,plan_id), FOREIGN KEY(device_id) REFERENCES devices(device_id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS sent_notifications (device_id TEXT NOT NULL, plan_id TEXT NOT NULL, occurrence_date TEXT NOT NULL, sent_at TEXT NOT NULL, PRIMARY KEY(device_id,plan_id,occurrence_date));`);
const app=express();
app.use(express.json({limit:'128kb'}));
const requestWindows=new Map();
app.use('/api', (req,res,next)=>{let key=`${req.ip}:${req.path}`,now=Date.now(),entry=requestWindows.get(key)||{count:0,started:now};if(now-entry.started>60_000)entry={count:0,started:now};entry.count++;requestWindows.set(key,entry);if(entry.count>60)return res.status(429).json({error:'Too many requests. Please try again shortly.'});next()});
app.use((req,res,next)=>{const allowed=process.env.CORS_ORIGIN;if(allowed&&req.headers.origin===allowed){res.setHeader('Access-Control-Allow-Origin',allowed);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Headers','Content-Type, X-Device-Id, Authorization');res.setHeader('Access-Control-Allow-Methods','GET,POST,PUT,OPTIONS')}if(req.method==='OPTIONS')return res.sendStatus(204);next()});
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const tokenFrom=req=>String(req.get('authorization')||'').replace(/^Bearer\s+/i,'');
function validId(value){return typeof value==='string'&&/^[a-zA-Z0-9-]{16,80}$/.test(value)}
function authenticate(req,res,next){const id=req.get('x-device-id'),token=tokenFrom(req),device=db.prepare('SELECT * FROM devices WHERE device_id=?').get(id);if(!validId(id)||!token||!device||!crypto.timingSafeEqual(Buffer.from(device.token_hash),Buffer.from(sha(token))))return res.status(401).json({error:'Unauthorized device'});req.device=device;next()}
function validTime(value,end=false){let m=String(value||'').match(/^(?:[01]\d|2[0-3]):(?:00|05|10|15|20|25|30|35|40|45|50|55)$/);return Boolean(m)||(end&&value==='24:00')}function timeToMinutes(value){let [hour,minute]=value.split(':').map(Number);return hour*60+minute}
function validSchedule(item){return item&&typeof item.planId==='string'&&item.planId.length<=100&&typeof item.title==='string'&&item.title.length>0&&item.title.length<=100&&validTime(item.start)&&validTime(item.end,true)&&timeToMinutes(item.end)>timeToMinutes(item.start)&&((item.recurring&&Number.isInteger(item.weekday)&&item.weekday>=0&&item.weekday<=6)||(!item.recurring&&/^\d{4}-\d{2}-\d{2}$/.test(item.date)))&&typeof item.timeZone==='string'&&item.timeZone.length<=64}
app.get('/api/health',(_,res)=>res.json({ok:true}));
app.get('/api/push/public-key',(_,res)=>res.json({publicKey:process.env.VAPID_PUBLIC_KEY}));
app.post('/api/devices/register',(req,res)=>{const id=req.get('x-device-id'),token=tokenFrom(req),subscription=req.body?.subscription;if(!validId(id)||token.length<24||!subscription?.endpoint||!subscription?.keys?.p256dh||!subscription?.keys?.auth)return res.status(400).json({error:'Invalid device registration'});const existing=db.prepare('SELECT token_hash FROM devices WHERE device_id=?').get(id),hash=sha(token);if(existing&&!crypto.timingSafeEqual(Buffer.from(existing.token_hash),Buffer.from(hash)))return res.status(401).json({error:'Unauthorized device'});db.prepare(`INSERT INTO devices(device_id,token_hash,subscription_json,updated_at) VALUES(?,?,?,?) ON CONFLICT(device_id) DO UPDATE SET subscription_json=excluded.subscription_json,updated_at=excluded.updated_at`).run(id,hash,JSON.stringify(subscription),new Date().toISOString());res.status(201).json({ok:true})});
app.delete('/api/devices/current',authenticate,(req,res)=>{db.prepare('DELETE FROM schedules WHERE device_id=?').run(req.device.device_id);db.prepare('DELETE FROM devices WHERE device_id=?').run(req.device.device_id);res.json({ok:true})});
app.put('/api/schedules/sync',authenticate,(req,res)=>{const schedules=req.body?.schedules;if(!Array.isArray(schedules)||schedules.length>500||!schedules.every(validSchedule))return res.status(400).json({error:'Invalid schedules'});const replace=db.transaction(()=>{db.prepare('DELETE FROM schedules WHERE device_id=?').run(req.device.device_id);const insert=db.prepare('INSERT INTO schedules(device_id,plan_id,schedule_json) VALUES(?,?,?)');for(const item of schedules)insert.run(req.device.device_id,item.planId,JSON.stringify(item))});replace();res.json({ok:true,count:schedules.length})});
app.post('/api/notifications/test',authenticate,async(req,res)=>{try{await webpush.sendNotification(JSON.parse(req.device.subscription_json),JSON.stringify({title:'스터디 플래너 테스트 알림',body:'푸시 알림 설정이 정상적으로 연결되었어요.',url:'./',tag:'study-planner-test'}));res.json({ok:true})}catch(error){if([404,410].includes(error.statusCode))db.prepare('DELETE FROM devices WHERE device_id=?').run(req.device.device_id);res.status(502).json({error:'Push delivery failed'})}});
function occurrence(schedule,now){let zone=DateTime.now().setZone(schedule.timeZone).isValid?schedule.timeZone:'Asia/Seoul',today=now.setZone(zone).startOf('day'),day;if(schedule.recurring){let target=schedule.weekday===0?7:schedule.weekday,delta=(target-today.weekday+7)%7;day=today.plus({days:delta})}else day=DateTime.fromISO(schedule.date,{zone}).startOf('day');let [hour,minute]=schedule.start.split(':').map(Number),start=day.set({hour,minute,second:0,millisecond:0});return {start,notifyAt:start.minus({minutes:20}),date:start.toISODate()}}
async function runScheduler(){const now=DateTime.now(),rows=db.prepare('SELECT schedules.device_id,schedules.plan_id,schedules.schedule_json,devices.subscription_json FROM schedules JOIN devices ON devices.device_id=schedules.device_id').all();for(const row of rows){let schedule;try{schedule=JSON.parse(row.schedule_json)}catch{continue}let item=occurrence(schedule,now),late=now.diff(item.notifyAt,'seconds').seconds;if(late<0||late>90||item.start<=now)continue;let marked=db.prepare('INSERT OR IGNORE INTO sent_notifications(device_id,plan_id,occurrence_date,sent_at) VALUES(?,?,?,?)').run(row.device_id,row.plan_id,item.date,new Date().toISOString());if(!marked.changes)continue;let path=`/?date=${item.date}&plan=${encodeURIComponent(schedule.planId)}`,payload={title:`20분 뒤 ${schedule.title}가 시작돼요`,body:`${schedule.start}~${schedule.end} · 준비할 시간이에요!`,url:appOrigin?`${appOrigin}${path}`:path,tag:`study-${schedule.planId}-${item.date}`};try{await webpush.sendNotification(JSON.parse(row.subscription_json),JSON.stringify(payload))}catch(error){if([404,410].includes(error.statusCode)){db.prepare('DELETE FROM devices WHERE device_id=?').run(row.device_id);db.prepare('DELETE FROM schedules WHERE device_id=?').run(row.device_id)}}}db.prepare(`DELETE FROM sent_notifications WHERE sent_at < ?`).run(DateTime.now().minus({days:35}).toISO())}
setInterval(()=>runScheduler().catch(error=>console.error('scheduler error',error)),30_000);runScheduler().catch(error=>console.error('scheduler startup error',error));
app.listen(Number(process.env.PORT||3000),()=>console.log(`Study planner push server listening on ${process.env.PORT||3000}`));
