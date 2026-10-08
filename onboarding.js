function finishOnboarding(){isFirstRun=false;localStorage.setItem(KEY,JSON.stringify(plans));$('#onboarding-sheet').classList.add('hidden');$('#sheet-backdrop').classList.add('hidden');render()}
function showOnboarding(){if(!isFirstRun)return;$('#sheet-backdrop').classList.remove('hidden');$('#onboarding-sheet').classList.remove('hidden')}
async function disableNotificationsForThisDevice(){notificationSettings.enabled=false;notificationSettings.syncPending=true;saveNotificationSettings();try{if(navigator.onLine){await fetch(`${apiBase()}/api/devices/current`,{method:'DELETE',headers:pushHeaders()});let registration=await navigator.serviceWorker.ready,subscription=await registration.pushManager.getSubscription();await subscription?.unsubscribe();notificationSettings.syncPending=false;saveNotificationSettings()}}catch{notificationSettings.syncPending=true;saveNotificationSettings()}}
$('#notification-button').onclick=async()=>{if(notificationSettings.enabled)await disableNotificationsForThisDevice();else await requestNotificationAccess()};
$('#start-empty').onclick=finishOnboarding;
$('#start-manual').onclick=()=>{finishOnboarding();openEditor()};
$('#start-example').onclick=()=>{let existing=new Set(plans.map(plan=>plan.id));defaults.forEach((item,index)=>{let plan={id:crypto.randomUUID(),title:item[0],start:item[1],end:item[2],recurring:true,weekday:index+1,doneDates:[],notify:false};if(!existing.has(plan.id))plans.push(plan)});finishOnboarding()};
showOnboarding();
