/* ---- Settings: PRICING_ON turns the free-month and limits on ---- */
var CONFIG={PRICING_ON:true,FREE_DAYS:30,FREE_LIMIT:20,FREE_ENTRIES:100,PRICE:20,SUB_URL:"https://rzp.io/rzp/ZzJ03aC",GOOGLE_CLIENT_ID:""};
var CATS=["Food","Groceries","Transport","Shopping","Bills","Entertainment","Health","Rent","Fuel","Education","Family","Travel","Gifts","Other"],
SC={Trip:["Stay","Transport","Food","Activities","Shopping","Other"],Tour:["Stay","Transport","Food","Activities","Shopping","Other"],Event:["Venue","Catering","Decor","Gifts","Transport","Other"]},
PCT={Salaried:{Rent:28,Groceries:12,Food:8,Bills:10,Transport:8,Shopping:8,Health:5,Entertainment:6,Family:5,Other:10},
Student:{Food:25,Transport:15,Education:20,Shopping:10,Entertainment:10,Bills:10,Other:10},
Freelancer:{Rent:25,Food:10,Groceries:10,Bills:15,Transport:8,Shopping:7,Health:5,Entertainment:5,Other:15},
"Business owner":{Rent:20,Groceries:10,Food:8,Bills:12,Fuel:10,Family:10,Health:5,Education:5,Shopping:5,Other:15},
Homemaker:{Groceries:30,Food:8,Bills:14,Education:10,Health:8,Shopping:10,Family:10,Other:10}},
K="paydesk.v2",S={people:[],txns:[],start:Date.now(),plan:false,days:[],spaces:[],profile:null,budget:null,skip:false},curSpace="";
try{var r=localStorage.getItem(K);if(r)S=Object.assign(S,JSON.parse(r))}catch(e){}
var $=function(i){return document.getElementById(i)},view="home",qcat="Food";
function save(){try{localStorage.setItem(K,JSON.stringify(S))}catch(e){}schedSync()}
function esc(s){var d=document.createElement("div");d.textContent=s==null?"":s;return d.innerHTML}
function inr(n){return "₹"+Number(n).toLocaleString("en-IN",{maximumFractionDigits:2})}
function uid(){return Date.now().toString(36)+Math.random().toString(36).slice(2,6)}
function day(d){var x=d?new Date(d):new Date();return x.getFullYear()+"-"+String(x.getMonth()+1).padStart(2,"0")+"-"+String(x.getDate()).padStart(2,"0")}
function person(id){return S.people.filter(function(p){return p.id===id})[0]}
function due(d){var n=new Date(),t=new Date(n.getFullYear(),n.getMonth(),d),b=new Date(n.getFullYear(),n.getMonth(),n.getDate());if(t<b)t=new Date(n.getFullYear(),n.getMonth()+1,d);return Math.round((t-b)/864e5)}
function tcat(t){if(t.kind==="exp"||t.cat)return t.cat;var c=(person(t.pid)||{}).cat||"Other";return{Electricity:"Bills",Water:"Bills",Gas:"Bills","Mobile / Internet":"Bills",Rent:"Rent",Person:"Other"}[c]||c}
function spaceById(i){return S.spaces.filter(function(x){return x.id===i})[0]}
function spent(i){var n=0;S.txns.forEach(function(t){if(t.sid===i&&counts(t))n+=t.amt});return n}
function bar(p){return'<div class="pg'+(p>1?' ov':'')+'"><i style="width:'+Math.min(100,p*100)+'%"></i></div>'}
function counts(t){return t.kind==="exp"||t.status==="paid"}
if(S.days.indexOf(day())<0){S.days.push(day());S.days=S.days.slice(-400);save()}
function streak(){var n=0,d=new Date();while(S.days.indexOf(day(d))>=0){n++;d.setDate(d.getDate()-1)}return n}
function planOn(){return S.plan&&(!S.planUntil||S.planUntil>Date.now())}
function gateBlocked(kind){if(!CONFIG.PRICING_ON||planOn())return false;if((Date.now()-S.start)/864e5<=CONFIG.FREE_DAYS)return false;
 var m=day().slice(0,7),k=kind||"pay";return S.txns.filter(function(t){return t.kind===k&&t.date.slice(0,7)===m}).length>=(k==="exp"?CONFIG.FREE_ENTRIES:CONFIG.FREE_LIMIT)}

function show(v){view=v;if(v!=="scan")stopScan();["home","pay","hist","people","plans","space","scan","qp","me"].forEach(function(x){$("v-"+x).hidden=x!==v});
 document.querySelectorAll("nav button").forEach(function(b){b.removeAttribute("aria-current");if(b.dataset.v===(v==="pay"||v==="hist"||v==="scan"||v==="qp"?"home":v==="space"?"plans":v))b.setAttribute("aria-current","page")});
 $("fab").hidden=["pay","scan","qp"].indexOf(v)>=0;render();scrollTo(0,0)}
document.querySelectorAll("nav button").forEach(function(b){b.onclick=function(){show(b.dataset.v)}});

function row(t){var p=person(t.pid),nm=t.kind==="exp"?t.cat:(p?p.name:(t.pn||t.pa||"Removed"));
 return '<div class="row"><div><b>'+esc(nm)+'</b><small>'+esc(t.date)+" · "+hm(t.ts)+(t.kind==="pay"&&t.cat?" · "+esc(t.cat):"")+(t.pb?" · paid by "+esc(t.pb):"")+(t.note?" · "+esc(t.note):"")+'</small></div><div style="display:flex;gap:8px;align-items:center"><span class="n">'+inr(t.amt)+'</span>'+(t.kind==="pay"?'<button class="tg '+(t.status==="paid"?"pd":"pn")+'" data-tog="'+t.id+'">'+(t.status==="paid"?"Paid":"Pending")+'</button>':"")+'<button class="tg" aria-label="Delete" data-del="'+t.id+'">✕</button></div></div>'}

function render(){
 var today=day(),mo=today.slice(0,7),td=0,mt=0;
 S.txns.forEach(function(t){if(!counts(t))return;if(t.date===today)td+=t.amt;if(t.date.slice(0,7)===mo)mt+=t.amt});
 var dueN=S.people.filter(function(p){return p.due&&due(p.due)<=5}).length;
 var c2={};S.txns.forEach(function(t){if(counts(t)&&!t.sid&&t.date.slice(0,7)===mo){var c=tcat(t);c2[c]=(c2[c]||0)+t.amt}});
 var over=S.budget?Object.keys(S.budget.cats).filter(function(c){return S.budget.cats[c]>0&&(c2[c]||0)>S.budget.cats[c]})[0]:null;
 var pend=S.txns.filter(function(t){return t.kind==="pay"&&t.status==="pending"&&Date.now()-t.ts<36e5}).sort(function(a,b){return b.ts-a.ts})[0];
 var last=S.txns.slice().sort(function(a,b){return b.ts-a.ts}).slice(0,3);
 $("v-home").innerHTML=(pend?'<div class="bn">Did your '+inr(pend.amt)+' payment to '+esc((person(pend.pid)||{}).name||pend.pn||pend.pa||"")+' go through?<div><button data-ok="'+pend.id+'">Yes, paid</button><button data-no="'+pend.id+'">Not paid</button></div></div>':"")+
 '<p class="mu" style="margin:0">Spent today</p><div class="big">'+inr(td)+'</div><p class="mu" style="margin-bottom:4px">'+inr(mt)+(S.budget&&S.budget.total?' of '+inr(S.budget.total)+' this month':' this month')+'</p>'+(S.budget&&S.budget.total?bar(mt/S.budget.total):'')+
 '<button class="st '+(over||dueN?"a":"")+'" data-go="'+(over?"me":"people")+'">'+(over?esc(over)+" is over budget":dueN?dueN+(dueN>1?" bills":" bill")+" due this week":"All clear")+'</button>'+
 '<button class="btn" id="scanb" style="margin:6px 0 8px">Scan &amp; pay</button><button class="btn o" data-go="pay" style="margin:0 0 18px">Pay someone saved</button>'+
 '<div class="card"><div class="row" style="border:0;padding:0 0 8px"><h2 style="margin:0">Recent</h2><button class="tg" data-go="hist">See all</button></div>'+(last.length?last.map(row).join(""):'<div class="empty">Nothing yet. Tap + to add your first expense.</div>')+'</div>';
 renderHist();
 $("v-people").innerHTML='<div class="card"><h2>People and billers</h2>'+(S.people.length?S.people.map(function(p){var sp=0;S.txns.forEach(function(t){if(t.pid===p.id&&t.status==="paid")sp+=t.amt});
  return '<div class="row"><div><b>'+esc(p.name)+'</b> <span class="tg">'+esc(p.cat)+'</span><small>'+esc(p.upi)+'</small>'+(p.due?'<small style="color:'+(due(p.due)<=5?"var(--wn)":"inherit")+'">Due day '+p.due+'</small>':"")+'<small>'+inr(sp)+' paid</small></div><div><button class="tg" data-pay="'+p.id+'">Pay</button> <button class="tg" aria-label="Delete" data-dp="'+p.id+'">✕</button></div></div>'}).join(""):'<div class="empty">Add someone you pay often.</div>')+'</div><button class="btn" id="addp">Add person or biller</button>';
 var dl=Math.max(0,Math.ceil(CONFIG.FREE_DAYS-(Date.now()-S.start)/864e5));
 $("v-me").innerHTML=meSync()+meBudget()+'<div class="card"><h2>Check-in streak</h2><div class="big">'+streak()+'</div><p class="mu">days in a row</p></div><div class="card"><h2>Plan</h2><p>'+(planOn()?"Paid plan, unlimited payments and entries.":(CONFIG.PRICING_ON?(dl>0?"Free month: "+dl+" days left.":"Free plan: 20 payments and 100 entries a month."):"Free beta: everything unlimited."))+'</p>'+(CONFIG.PRICING_ON&&!planOn()?'<button class="btn o" id="up">Upgrade for ₹'+CONFIG.PRICE+'/month</button>':"")+'</div><div class="card"><h2>Your data</h2><p class="mu">Stored on this device only. No ads, no trackers.</p><button class="btn o" id="csv">Export CSV</button><button class="btn o" id="wipe">Delete all data</button><p class="lg"><a href="/privacy.html">Privacy</a> · <a href="/terms.html">Terms</a> · <a href="/refund.html">Refunds</a> · <a href="/contact.html">Contact</a></p></div>';
 var pc=$("pp").value;$("pp").innerHTML=S.people.length?S.people.map(function(p){return '<option value="'+p.id+'">'+esc(p.name)+'</option>'}).join(""):'<option value="">Add a person first</option>';if(pc&&person(pc))$("pp").value=pc;renderPlans();gbtn();
}

function link(p,a,n,app,x){var q="pa="+encodeURIComponent(p.upi)+"&pn="+encodeURIComponent(p.name)+"&am="+a.toFixed(2)+"&cu=INR"+(n?"&tn="+encodeURIComponent(n):"");
 return({upi:"upi://pay?",gpay:"tez://upi/pay?",phonepe:"phonepe://pay?",paytm:"paytmmp://pay?"}[app]||"upi://pay?")+q+(x||"")}
$("go").onclick=function(){var p=person($("pp").value),a=parseFloat($("am").value);
 if(!p){$("pe").textContent="Add a person or biller first.";return}
 if(!(a>0)){$("pe").textContent="Enter an amount above 0.";return}
 if(gateBlocked()){$("du").showModal();return}
 $("pe").textContent="";var n=$("nt").value.trim();
 S.txns.push({id:uid(),kind:"pay",pid:p.id,amt:a,note:n,date:day(),ts:Date.now(),status:"pending"});save();
 $("am").value="";$("nt").value="";show("home");location.href=link(p,a,n,$("ap").value)};

function openQ(sid){$("qa").value="";$("qn").value="";$("qe").textContent="";
 $("qf").innerHTML='<option value="">General</option>'+S.spaces.map(function(x){return'<option value="'+x.id+'">'+esc(x.name)+'</option>'}).join("");
 $("qf").value=sid||"";drawChips(false);pbUpd();$("dq").showModal();$("qa").focus()}
$("fab").onclick=function(){openQ(view==="space"?curSpace:"")};
function drawChips(more){var sp=spaceById($("qf").value),l=sp?SC[sp.type]:CATS,sh=more?l:l.slice(0,6);
 if(l.indexOf(qcat)<0)qcat=l[0];if(sh.indexOf(qcat)<0)sh=sh.slice(0,5).concat(qcat);
 $("qc").innerHTML=sh.map(function(c){return'<button type="button" data-c="'+c+'" aria-pressed="'+(c===qcat)+'">'+c+'</button>'}).join("")+(!more&&l.length>6?'<button type="button" data-more="1">More</button>':"")}
$("qf").onchange=function(){drawChips(false);pbUpd()};

$("qc").onclick=function(e){if(e.target.dataset.more){drawChips(true);return}var c=e.target.dataset.c;if(!c)return;qcat=c;[].forEach.call($("qc").children,function(b){b.setAttribute("aria-pressed",b.dataset.c===c)})};
$("qx").onclick=function(){$("dq").close()};
$("qs").onclick=function(){var a=parseFloat($("qa").value);if(gateBlocked("exp")){$("dq").close();$("du").showModal();return}if(!(a>0)){$("qe").textContent="Enter an amount above 0.";return}
 S.txns.push({id:uid(),kind:"exp",cat:qcat,sid:$("qf").value,pb:$("qb").hidden?"":$("qb").value,amt:a,note:$("qn").value.trim(),date:day(),ts:Date.now()});save();$("dq").close();render()};

$("nx").onclick=function(){$("dp").close()};
$("ns").onclick=function(){var n=$("nn").value.trim(),u=$("nu").value.trim(),d=parseInt($("nd").value,10);
 if(!n){$("ne").textContent="Enter a name.";return}
 if(!/^[\w.\-]{2,}@[A-Za-z]{2,}$/.test(u)){$("ne").textContent="Enter a valid UPI ID, like name@bank.";return}
 S.people.push({id:uid(),name:n,upi:u,cat:$("nc").value,due:(d>=1&&d<=31)?d:null});save();
 $("nn").value=$("nu").value=$("nd").value="";$("ne").textContent="";$("dp").close();render()};

$("ux").onclick=function(){$("du").close()};
$("ub").onclick=function(){window.open(CONFIG.SUB_URL,"_blank","noopener");$("ue").textContent="After you subscribe, come back and tap I've subscribed."};
$("ud").onclick=function(){var e=$("ue");
 if(!T){if(CONFIG.GOOGLE_CLIENT_ID){e.textContent="Sign in first (Me tab) so your plan is saved.";return}
  S.plan=true;S.planUntil=Date.now()+35*864e5;save();$("du").close();render();return}
 var pid=$("ucl").value.trim();
 if(!pid){sync();$("ucl").hidden=false;e.textContent="Checking your plan. If it does not unlock, paste your payment ID (starts with pay_) and tap again.";return}
 fetch("/api/claim",{method:"POST",headers:{Authorization:"Bearer "+T,"Content-Type":"application/json"},body:JSON.stringify({payment_id:pid})}).then(function(r){return r.json()}).then(function(d){
  if(d.ok){S.plan=true;S.planUntil=0;$("du").close();$("ucl").value="";render();sync()}else e.textContent=d.error||"Could not verify that payment."}).catch(function(){e.textContent="Network error. Try again."})};

document.addEventListener("click",function(e){var b=e.target.closest("button");if(!b)return;var d=b.dataset;
 if(d.go)show(d.go);
 if(d.pay){$("pp").value=d.pay;show("pay");$("am").focus()}
 if(d.tog){S.txns.forEach(function(t){if(t.id===d.tog)t.status=t.status==="paid"?"pending":"paid"});save();render()}
 if(d.ok){S.txns.forEach(function(t){if(t.id===d.ok)t.status="paid"});save();render()}
 if(d.no){S.txns=S.txns.filter(function(t){return t.id!==d.no});save();render()}
 if(d.del){S.txns=S.txns.filter(function(t){return t.id!==d.del});save();render()}
 if(d.dp&&confirm("Delete this person? Past payments stay in History.")){S.people=S.people.filter(function(p){return p.id!==d.dp});save();render()}
 if(b.id==="addp")$("dp").showModal();
 if(b.id==="up")$("du").showModal();
 if(b.id==="wipe"&&confirm("Delete all data on this device?")){S={people:[],txns:[],start:Date.now(),plan:false,days:[day()],spaces:[],profile:null,budget:null,skip:false};save();render()}
 if(b.id==="csv"){var rows=[["Date","Type","Name","Amount","Status","Note"]].concat(S.txns.map(function(t){return[t.date,t.kind==="exp"?"Expense":"Payment",t.kind==="exp"?t.cat:(person(t.pid)||{}).name||"Removed",t.amt,t.status||"",t.note||""]}));
  var s=rows.map(function(r){return r.map(function(c){return '"'+String(c).replace(/"/g,'""')+'"'}).join(",")}).join("\n"),a=document.createElement("a");
  a.href=URL.createObjectURL(new Blob([s],{type:"text/csv"}));a.download="paydesk.csv";a.click()}});
function renderPlans(){
 $("v-plans").innerHTML='<div class="card"><h2>Trips, tours and events</h2>'+(S.spaces.length?S.spaces.map(function(x){var sp=spent(x.id);return'<button class="st" style="color:var(--ink)" data-sp="'+x.id+'"><div style="display:flex;justify-content:space-between"><span><b>'+esc(x.name)+'</b> <span class="tg">'+x.type+'</span></span><span class="n">'+inr(sp)+(x.budget?' / '+inr(x.budget):'')+'</span></div>'+(x.budget?bar(sp/x.budget):'')+'</button>'}).join(""):'<div class="empty">Plan a trip, tour or event to track its budget on its own.</div>')+'</div><button class="btn" id="adds">New plan</button>';
 renderSpace()}
function meBudget(){var b=S.budget,p=S.profile,h='<div class="card"><h2>Profile and budget</h2><p class="mu">'+(p?esc(p.type)+(p.name?' · '+esc(p.name):''):'Not set up yet')+'</p>';
 if(b)h+='<label>Monthly budget, ₹<input type="number" data-bt="1" value="'+b.total+'"></label><details><summary class="mu" style="cursor:pointer">Category budgets</summary>'+Object.keys(b.cats).map(function(c){return'<label>'+esc(c)+'<input type="number" data-bc="'+esc(c)+'" value="'+b.cats[c]+'"></label>'}).join("")+'</details>';
 return h+'<button class="btn o" id="epf">'+(p?'Edit profile':'Set up profile')+'</button></div>'}
$("px").onclick=function(){S.skip=true;save();$("dpf").close()};
$("ps").onclick=function(){var inc=parseFloat($("pi").value)||0,t=$("pt").value;S.profile={name:$("pn").value.trim(),type:t,income:inc};S.skip=true;
 if(inc>0){var tot=Math.round(inc*0.7/500)*500,c={};Object.keys(PCT[t]).forEach(function(k){c[k]=Math.round(tot*PCT[t][k]/100/100)*100});S.budget={total:tot,cats:c}}
 save();$("dpf").close();render()};
$("sx").onclick=function(){editS="";$("dsp").close()};
$("sv").onclick=function(){var n=$("sn").value.trim();if(!n){$("se").textContent="Enter a name.";return}
 var tr=$("sr").value.split(",").map(function(a){return a.trim()}).filter(Boolean).slice(0,12),x=editS?spaceById(editS):{id:uid(),lines:{}};
 x.name=n;x.type=$("st").value;x.budget=parseFloat($("sb").value)||0;x.people=parseInt($("sp").value,10)||0;x.start=$("s1").value;x.end=$("s2").value;x.trav=tr;
 if(!editS)S.spaces.push(x);curSpace=x.id;editS="";save();$("dsp").close();["sn","sb","sp","s1","s2","sr"].forEach(function(i){$(i).value=""});show("space")};
document.addEventListener("click",function(e){var b=e.target.closest("button");if(!b)return;var d=b.dataset;
 if(d.sp){curSpace=d.sp;show("space")}
 if(b.id==="adds"){editS="";$("sv").textContent="Create";$("dsp").showModal()}
 if(b.id==="addx")openQ(curSpace);
 if(d.delsp&&confirm("Delete this plan? Its expenses stay in History.")){S.spaces=S.spaces.filter(function(x){return x.id!==d.delsp});S.txns.forEach(function(t){if(t.sid===d.delsp)t.sid=""});save();curSpace="";show("plans")}
 if(b.id==="epf"){var p=S.profile||{};$("pn").value=p.name||"";$("pt").value=p.type||"Salaried";$("pi").value=p.income||"";$("dpf").showModal()}});
document.addEventListener("change",function(e){var t=e.target,v=parseFloat(t.value)||0;
 if(t.dataset.bt&&S.budget){S.budget.total=v;save();render()}
 if(t.dataset.bc&&S.budget){S.budget.cats[t.dataset.bc]=v;save();render()}});
/* ---- Trip planner ---- */
var editS="";
function trav(x){return x.trav&&x.trav.length>1?x.trav:[]}
function pbUpd(){var sp=spaceById($("qf").value),tr=sp?trav(sp):[];$("qb").hidden=!tr.length;$("qb").innerHTML=tr.map(function(a){return'<option value="'+esc(a)+'">Paid by '+esc(a)+'</option>'}).join("")}
function dnum(a,b){return Math.round((new Date(a+"T00:00:00")-new Date(b+"T00:00:00"))/864e5)}
function settle(T,C){var paid={},tot=0,cr=[],de=[],out=[];T.forEach(function(a){paid[a]=0});
 C.forEach(function(t){tot+=t.amt;paid[T.indexOf(t.pb)>=0?t.pb:T[0]]+=t.amt});var sh=tot/T.length;
 T.forEach(function(a){var d=paid[a]-sh;if(d>0.5)cr.push([a,d]);else if(d<-0.5)de.push([a,-d])});
 var f=function(a,b){return b[1]-a[1]};cr.sort(f);de.sort(f);var i=0,j=0;
 while(i<cr.length&&j<de.length){var m=Math.min(cr[i][1],de[j][1]);out.push(esc(de[j][0])+" pays "+esc(cr[i][0])+" <b>"+inr(m)+"</b>");cr[i][1]-=m;de[j][1]-=m;if(cr[i][1]<0.5)i++;if(de[j][1]<0.5)j++}
 return{out:out,sh:sh,paid:paid}}
function renderSpace(){var x=spaceById(curSpace);if(!x){$("v-space").innerHTML="";return}
 var tr=trav(x),n=tr.length||x.people||0,L=S.txns.filter(function(t){return t.sid===x.id}).sort(function(a,b){return b.ts-a.ts}),C=L.filter(counts),sp=0,cs={};
 C.forEach(function(t){sp+=t.amt;cs[t.cat]=(cs[t.cat]||0)+t.amt});
 var td=day(),st=x.start,en=x.end,ins="";
 if(st&&en){var tot=dnum(en,st)+1;
  if(td<st)ins="Starts "+st+" · "+tot+" days";
  else if(td>en)ins="Trip over · "+tot+" days · "+inr(sp/tot)+" a day";
  else{var el=dnum(td,st)+1,left=tot-el;ins="Day "+el+" of "+tot+(x.budget?(left>0?" · "+inr(Math.max(0,x.budget-sp)/left)+" left per day":" · last day"):"")+(sp>0?" · on track for "+inr(sp/el*tot):"")}}
 var lines=x.lines||{},ac=Array.from(new Set(Object.keys(lines).filter(function(c){return lines[c]>0}).concat(Object.keys(cs))));
 var pv=ac.length?ac.map(function(c){var a=cs[c]||0,p=lines[c]||0;return'<div style="margin-bottom:10px"><div style="display:flex;justify-content:space-between"><span>'+esc(c)+'</span><b class="n">'+inr(a)+(p?' / '+inr(p):'')+'</b></div>'+(p?bar(a/p):'')+'</div>'}).join(""):'<div class="empty">Set a budget by type, or add expenses.</div>';
 var bal="";if(tr.length){var r=settle(tr,C);bal='<div class="card"><h2>Who owes whom</h2><p class="mu">Equal share: '+inr(r.sh)+' each</p>'+(r.out.length?r.out.map(function(o){return'<div class="row">'+o+'</div>'}).join(""):'<div class="empty">All settled.</div>')+'<p class="mu" style="margin-top:8px">Paid so far: '+tr.map(function(a){return esc(a)+" "+inr(r.paid[a])}).join(" · ")+'</p></div>'}
 var byd={};L.forEach(function(t){(byd[t.date]=byd[t.date]||[]).push(t)});
 var days=Object.keys(byd).sort().reverse().map(function(d){var dt=0;byd[d].forEach(function(t){if(counts(t))dt+=t.amt});
  return'<div class="row" style="border:0;padding:12px 0 2px"><b>'+(st?"Day "+(dnum(d,st)+1)+" · ":"")+esc(d)+'</b><span class="n">'+inr(dt)+'</span></div>'+byd[d].map(row).join("")}).join("");
 $("v-space").innerHTML='<button class="tg" data-go="plans" style="margin-bottom:10px">← Plans</button><p class="mu" style="margin:0">'+esc(x.name)+' · '+x.type+(st?' · '+esc(st)+(en?' to '+esc(en):''):'')+'</p><div class="big">'+inr(sp)+'</div>'+
  '<p class="mu" style="margin-bottom:4px">'+(x.budget?(sp>x.budget?inr(sp-x.budget)+' over budget of '+inr(x.budget):inr(x.budget-sp)+' left of '+inr(x.budget)):'No budget set')+(n?' · '+inr(sp/n)+' per person':'')+'</p>'+(x.budget?bar(sp/x.budget):'')+(ins?'<p class="mu" style="margin:6px 0 0">'+ins+'</p>':'')+
  '<button class="btn" id="addx" style="margin:12px 0 8px">Add expense</button><button class="btn o" data-edsp="'+x.id+'" style="margin:0 0 16px">Edit plan</button>'+
  '<div class="card"><div class="row" style="border:0;padding:0 0 8px"><h2 style="margin:0">Plan vs actual</h2><button class="tg" data-lines="'+x.id+'">Set budget</button></div>'+pv+'</div>'+bal+
  '<div class="card"><h2>Day by day</h2>'+(L.length?days:'<div class="empty">No expenses yet.</div>')+'</div><button class="btn o" data-delsp="'+x.id+'">Delete this plan</button>'}
document.addEventListener("click",function(e){var b=e.target.closest("button");if(!b)return;var d=b.dataset;
 if(d.edsp){var x=spaceById(d.edsp);if(!x)return;editS=x.id;$("sn").value=x.name;$("st").value=x.type;$("sb").value=x.budget||"";$("sp").value=x.people||"";$("s1").value=x.start||"";$("s2").value=x.end||"";$("sr").value=(x.trav||[]).join(", ");$("sv").textContent="Save";$("dsp").showModal()}
 if(d.lines){var y=spaceById(d.lines);if(!y)return;editS=y.id;$("plb").innerHTML=SC[y.type].map(function(c){return'<label>'+esc(c)+' (₹)<input type="number" inputmode="numeric" min="0" data-pl="'+esc(c)+'" value="'+((y.lines||{})[c]||"")+'"></label>'}).join("");$("dpl").showModal()}});
$("plx").onclick=function(){editS="";$("dpl").close()};
$("pls").onclick=function(){var y=spaceById(editS);if(!y)return;y.lines={};var sum=0;[].forEach.call($("plb").querySelectorAll("input"),function(i){var v=parseFloat(i.value)||0;if(v>0){y.lines[i.dataset.pl]=v;sum+=v}});
 if(!y.budget)y.budget=sum;editS="";save();$("dpl").close();render()};

/* ---- History filters ---- */
var F={from:"",to:"",min:"",max:"",t1:"",t2:"",cat:"",st:"all",sid:"",q:"",g:"cat",open:false,lim:50};
function hm(ts){return new Date(ts).toLocaleTimeString("en-IN",{hour:"numeric",minute:"2-digit"})}
function pname(t){var p=person(t.pid);return t.kind==="exp"?"No payee":(p?p.name:(t.pn||t.pa||"Removed"))}
function inTime(t){if(!F.t1||!F.t2)return true;var d=new Date(t.ts),m=d.getHours()*60+d.getMinutes(),a=F.t1.split(":"),b=F.t2.split(":"),x=a[0]*60+ +a[1],y=b[0]*60+ +b[1];return x<=y?(m>=x&&m<=y):(m>=x||m<=y)}
function match(t){if(F.from&&t.date<F.from)return false;if(F.to&&t.date>F.to)return false;
 if(F.min!==""&&t.amt<+F.min)return false;if(F.max!==""&&t.amt>+F.max)return false;if(!inTime(t))return false;
 if(F.cat&&tcat(t)!==F.cat)return false;
 if(F.st==="paid"&&!counts(t))return false;if(F.st==="pending"&&!(t.kind==="pay"&&t.status==="pending"))return false;
 if(F.sid==="none"&&t.sid)return false;if(F.sid&&F.sid!=="none"&&t.sid!==F.sid)return false;
 if(F.q&&(pname(t)+" "+(t.pa||"")+" "+(t.note||"")+" "+tcat(t)).toLowerCase().indexOf(F.q.toLowerCase())<0)return false;return true}
function gkey(t){var h=new Date(t.ts).getHours();if(F.g==="payee")return pname(t);if(F.g==="day")return t.date;
 if(F.g==="wk")return["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][new Date(t.date+"T00:00:00").getDay()];
 if(F.g==="time")return h>=5&&h<12?"Morning":h>=12&&h<17?"Afternoon":h>=17&&h<21?"Evening":"Night";return tcat(t)}
function renderHist(){
 var all=S.txns.filter(match).sort(function(a,b){return b.ts-a.ts}),cnt=all.filter(counts),tot=0,big=null,g={},mx=0;
 cnt.forEach(function(t){tot+=t.amt;if(!big||t.amt>big.amt)big=t;var k=gkey(t);g[k]=(g[k]||0)+t.amt});
 var keys=Object.keys(g).sort(function(a,b){return F.g==="day"?b.localeCompare(a):g[b]-g[a]});keys.forEach(function(k){mx=Math.max(mx,g[k])});
 var n=["from","to","min","max","t1","cat","sid","q"].filter(function(k){return F[k]}).length+(F.st!=="all"?1:0);
 var o=function(v,l,c){return'<option value="'+esc(v)+'"'+(c===v?" selected":"")+'>'+esc(l)+'</option>'};
 var pre=function(l,k){return'<button class="tg" data-pre="'+k+'">'+l+'</button>'};
 var cats=Array.from(new Set(CATS.concat(S.txns.map(tcat)))).sort();
 var panel=F.open?'<div class="card"><div class="two"><label>From<input type="date" data-f="from" value="'+F.from+'"></label><label>To<input type="date" data-f="to" value="'+F.to+'"></label>'+
  '<label>Min ₹<input type="number" inputmode="decimal" data-f="min" value="'+F.min+'"></label><label>Max ₹<input type="number" inputmode="decimal" data-f="max" value="'+F.max+'"></label>'+
  '<label>Time from<input type="time" data-f="t1" value="'+F.t1+'"></label><label>Time to<input type="time" data-f="t2" value="'+F.t2+'"></label></div>'+
  '<div class="chips"><button class="tg" data-tc="05:00-11:59">Morning</button><button class="tg" data-tc="12:00-16:59">Afternoon</button><button class="tg" data-tc="17:00-20:59">Evening</button><button class="tg" data-tc="21:00-04:59">Night</button><button class="tg" data-tc="">Any time</button></div>'+
  '<label>Type<select data-f="cat">'+o("","All types",F.cat)+cats.map(function(c){return o(c,c,F.cat)}).join("")+'</select></label>'+
  '<label>Status<select data-f="st">'+o("all","All",F.st)+o("paid","Paid",F.st)+o("pending","Pending",F.st)+'</select></label>'+
  '<label>Plan<select data-f="sid">'+o("","All",F.sid)+o("none","No plan",F.sid)+S.spaces.map(function(x){return o(x.id,x.name,F.sid)}).join("")+'</select></label>'+
  '<label>Search payee or note<input data-f="q" value="'+esc(F.q)+'"></label><button class="btn o" data-fr="1">Clear filters</button></div>':"";
 $("v-hist").innerHTML='<div class="chips" style="margin:0 0 10px">'+pre("Today","t")+pre("7 days","w")+pre("This month","m")+pre("Last month","l")+pre("All","a")+'<button class="tg" data-fo="1">Filters'+(n?" ("+n+")":"")+'</button></div>'+panel+
  '<div class="card"><div class="tl"><div><span class="mu">Spent</span><b>'+inr(tot)+'</b></div><div><span class="mu">Payments</span><b>'+cnt.length+'</b></div><div><span class="mu">Average</span><b>'+inr(cnt.length?tot/cnt.length:0)+'</b></div><div><span class="mu">Biggest</span><b>'+inr(big?big.amt:0)+'</b></div></div>'+(big?'<p class="mu" style="margin:10px 0 0">Biggest: '+esc(pname(big))+' · '+esc(tcat(big))+' · '+esc(big.date)+'</p>':'')+'</div>'+
  '<div class="card"><div class="row" style="border:0;padding:0 0 8px"><h2 style="margin:0">Spent by</h2><select data-f="g" style="width:auto">'+o("cat","Type",F.g)+o("payee","Payee",F.g)+o("wk","Weekday",F.g)+o("time","Time of day",F.g)+o("day","Day",F.g)+'</select></div>'+
  (keys.length?keys.slice(0,12).map(function(k){return'<div style="margin-bottom:10px"><div style="display:flex;justify-content:space-between"><span>'+esc(k)+'</span><b class="n">'+inr(g[k])+'</b></div>'+bar(g[k]/mx)+'</div>'}).join(""):'<div class="empty">Nothing matches.</div>')+'</div>'+
  '<div class="card"><h2>Activity</h2>'+(all.length?all.slice(0,F.lim).map(row).join("")+(all.length>F.lim?'<button class="btn o" data-fm="1">Show more</button>':''):'<div class="empty">Nothing matches these filters.</div>')+'</div>'}
function pd(n){var d=new Date();d.setDate(d.getDate()-n);return day(d)}
document.addEventListener("click",function(e){var b=e.target.closest("button");if(!b)return;var d=b.dataset;
 if(d.fo){F.open=!F.open;render()}
 if(d.fm){F.lim+=50;render()}
 if(d.fr){var op=F.open;F={from:"",to:"",min:"",max:"",t1:"",t2:"",cat:"",st:"all",sid:"",q:"",g:F.g,open:op,lim:50};render()}
 if(d.tc!==undefined){var t=d.tc.split("-");F.t1=t[0]||"";F.t2=t[1]||"";render()}
 if(d.pre){var k=d.pre,n=new Date();F.lim=50;
  if(k==="t"){F.from=F.to=day()}else if(k==="w"){F.from=pd(6);F.to=day()}else if(k==="m"){F.from=day().slice(0,7)+"-01";F.to=day()}
  else if(k==="l"){var f=new Date(n.getFullYear(),n.getMonth()-1,1);F.from=day(f);F.to=day(new Date(n.getFullYear(),n.getMonth(),0))}else{F.from=F.to=""}
  render()}});
document.addEventListener("change",function(e){var k=e.target.dataset.f;if(!k)return;F[k]=e.target.value;F.lim=50;render()});

/* ---- Scan and pay ---- */
var stream=null,scanOn=false,det=null,cv=null,QP=null,qpcat="",qmore=false,QC=["Food","Transport","Stay","Shopping","Entertainment","Health","Fuel","Gifts","Other"];
function stopScan(){scanOn=false;if(stream){stream.getTracks().forEach(function(t){t.stop()});stream=null}}
function jsqrReady(cb){if(window.jsQR)return cb();var sc=document.createElement("script");sc.src="/jsQR.js";sc.onload=cb;sc.onerror=function(){$("sce").textContent="Could not load the scanner. Check your connection."};document.head.appendChild(sc)}
function parseUPI(t){var m=/^upi:\/\/pay\?(.*)$/i.exec(String(t).trim());if(!m)return null;var p=new URLSearchParams(m[1]),pa=p.get("pa");
 if(!pa||!/^[\w.\-]{2,}@[A-Za-z]{2,}$/.test(pa))return null;return{pa:pa,pn:p.get("pn")||"",am:parseFloat(p.get("am"))||0,tn:p.get("tn")||"",mc:p.get("mc")||"",tr:p.get("tr")||""}}
function startScan(){show("scan");$("sce").textContent="";
 if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){$("sce").textContent="Camera is not available here. Try “Use a photo instead”.";return}
 navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:"environment"}},audio:false}).then(function(s){
  if(view!=="scan"){s.getTracks().forEach(function(t){t.stop()});return}
  stream=s;var v=$("scv");v.srcObject=s;v.play();scanOn=true;
  if("BarcodeDetector" in window){try{det=new BarcodeDetector({formats:["qr_code"]})}catch(x){det=null}}
  if(det)loop();else jsqrReady(loop)}).catch(function(){$("sce").textContent="Camera permission is needed to scan. Allow it in your browser settings, or use a photo."})}
function loop(){if(!scanOn)return;var v=$("scv");
 if(v.readyState>=2&&v.videoWidth){
  if(det){det.detect(v).then(function(r){if(r&&r[0])got(r[0].rawValue);else setTimeout(loop,150)}).catch(function(){setTimeout(loop,200)});return}
  var c=cv||(cv=document.createElement("canvas")),w=Math.min(640,v.videoWidth),h=Math.round(v.videoHeight*w/v.videoWidth);c.width=w;c.height=h;
  var x=c.getContext("2d");x.drawImage(v,0,0,w,h);var q=jsQR(x.getImageData(0,0,w,h).data,w,h);if(q&&q.data){got(q.data);return}}
 setTimeout(loop,150)}
function got(text){var u=parseUPI(text);if(!u){$("sce").textContent="That isn't a UPI payment QR. Keep scanning.";setTimeout(loop,1500);return}
 stopScan();openQP(u)}
$("spic").onclick=function(){$("sfile").click()};
$("sfile").onchange=function(){var f=this.files[0];if(!f)return;var im=new Image(),inp=this;
 im.onload=function(){jsqrReady(function(){var c=document.createElement("canvas"),w=Math.min(1000,im.width),h=Math.round(im.height*w/im.width);c.width=w;c.height=h;
  var x=c.getContext("2d");x.drawImage(im,0,0,w,h);var q=jsQR(x.getImageData(0,0,w,h).data,w,h);if(q&&q.data)got(q.data);else $("sce").textContent="No QR found in that photo. Try again, closer."})};
 im.src=URL.createObjectURL(f);inp.value=""};
function drawQ(){var sh=qmore?QC:QC.slice(0,6);if(qpcat&&sh.indexOf(qpcat)<0)sh=sh.concat(qpcat);
 $("qpc").innerHTML=sh.map(function(c){return'<button type="button" data-qc="'+c+'" aria-pressed="'+(c===qpcat)+'">'+c+'</button>'}).join("")+(!qmore?'<button type="button" data-qm="1">More</button>':"")}
function openQP(u){var kp=S.people.filter(function(p){return p.upi.toLowerCase()===u.pa.toLowerCase()})[0];QP=u;QP.pid=kp?kp.id:"";
 $("qpw").innerHTML='<p style="margin:0"><b>'+esc(u.pn||"Unknown payee")+'</b></p><p class="mu">'+esc(u.pa)+(kp?" · in your People":"")+'</p>';
 $("qpa").value=u.am||"";$("qpn").value=u.tn||"";$("qpe").textContent="";qpcat="";qmore=false;drawQ();$("qps").checked=false;$("qpsl").hidden=!!kp;
 $("qpf").innerHTML='<option value="">General</option>'+S.spaces.map(function(x){return'<option value="'+x.id+'">'+esc(x.name)+'</option>'}).join("");
 var cur=spaceById(curSpace);if(cur)$("qpf").value=cur.id;show("qp")}
document.addEventListener("click",function(e){var b=e.target.closest("button");if(!b)return;var d=b.dataset;
 if(b.id==="scanb")startScan();
 if(d.qc){qpcat=d.qc;drawQ()}
 if(d.qm){qmore=true;drawQ()}});
$("qpg").onclick=function(){var a=parseFloat($("qpa").value),er=$("qpe");
 if(!(a>0)){er.textContent="Enter an amount above 0.";return}
 if(!qpcat){er.textContent="Pick why you're paying.";return}
 if(gateBlocked()){$("du").showModal();return}
 var pid=QP.pid;if($("qps").checked&&!pid){var np={id:uid(),name:QP.pn||QP.pa,upi:QP.pa,cat:"Other",due:null};S.people.push(np);pid=np.id}
 var n=$("qpn").value.trim();
 S.txns.push({id:uid(),kind:"pay",pid:pid,pn:QP.pn,pa:QP.pa,cat:qpcat,sid:$("qpf").value,amt:a,note:n,date:day(),ts:Date.now(),status:"pending"});save();
 var ex=(QP.mc?"&mc="+encodeURIComponent(QP.mc):"")+(QP.tr?"&tr="+encodeURIComponent(QP.tr):"");
 show("home");location.href=link({upi:QP.pa,name:QP.pn||QP.pa},a,n||qpcat,$("qpo").value,ex)};

/* ---- Account and sync (Cloudflare D1 backend) ---- */
var T="",EM="",LP=0,SENT={},stm,busy=false;
try{var A=JSON.parse(localStorage.getItem("paydesk.auth")||"{}");T=A.t||"";EM=A.e||"";LP=A.p||0;SENT=A.s||{}}catch(e){}
function saveAuth(){try{localStorage.setItem("paydesk.auth",JSON.stringify({t:T,e:EM,p:LP,s:SENT}))}catch(e){}}
function schedSync(){if(!T)return;clearTimeout(stm);stm=setTimeout(sync,4000)}
function blobs(){var o={},m={};S.txns.forEach(function(t){var k="tx:"+t.date.slice(0,7);(m[k]=m[k]||[]).push(t)});
 Object.keys(m).forEach(function(k){o[k]=JSON.stringify(m[k])});
 Object.keys(SENT).forEach(function(k){if(k!=="meta"&&!(k in o))o[k]="[]"});
 o.meta=JSON.stringify({people:S.people,spaces:S.spaces,profile:S.profile,budget:S.budget,start:S.start,days:S.days});return o}
function uni(a,b){var q={};a.forEach(function(x){q[x.id]=1});return a.concat(b.filter(function(x){return!q[x.id]}))}
function apply(k,v,dirty){var d=JSON.parse(v);
 if(k==="meta"){S.people=dirty?uni(S.people,d.people||[]):(d.people||[]);S.spaces=dirty?uni(S.spaces,d.spaces||[]):(d.spaces||[]);
  if(d.profile)S.profile=d.profile;if(d.budget)S.budget=d.budget;if(d.start)S.start=Math.min(S.start,d.start);
  S.days=Array.from(new Set(S.days.concat(d.days||[]))).sort().slice(-400);return}
 var mo=k.slice(3),mine=S.txns.filter(function(t){return t.date.slice(0,7)===mo}),rest=S.txns.filter(function(t){return t.date.slice(0,7)!==mo});
 S.txns=rest.concat(dirty?uni(mine,d):d)}
function sync(){if(!T||busy)return;busy=true;var b=blobs(),push={},first=!LP,again=false;
 if(!first)Object.keys(b).forEach(function(k){if(SENT[k]!==b[k])push[k]=b[k]});
 fetch("/api/sync",{method:"POST",headers:{Authorization:"Bearer "+T,"Content-Type":"application/json"},body:JSON.stringify({since:LP,blobs:push})})
 .then(function(r){if(r.status===401){T="";saveAuth();throw new Error("out")}return r.json()})
 .then(function(d){var lim=d.limit||[];Object.keys(push).forEach(function(k){if(lim.indexOf(k)<0)SENT[k]=push[k]});if(lim.length)$("du").showModal();
  Object.keys(d.blobs).forEach(function(k){var dirty=(blobs()[k]||"")!==(SENT[k]||"");apply(k,d.blobs[k],dirty);if(dirty)again=true;else SENT[k]=d.blobs[k]});
  LP=d.now;S.plan=d.plan;S.planUntil=0;saveAuth();try{localStorage.setItem(K,JSON.stringify(S))}catch(e){}busy=false;render();if(first||again)sync()})
 .catch(function(){busy=false;render()})}
function onCred(r){fetch("/api/auth",{method:"POST",body:JSON.stringify({credential:r.credential})}).then(function(x){return x.json()}).then(function(d){
 if(!d.token)throw 0;T=d.token;EM=d.email;LP=0;SENT={};saveAuth();sync()}).catch(function(){alert("Sign-in failed. Please try again.")})}
function gbtn(){var g=$("gbtn");if(!g||T||!window.google||!CONFIG.GOOGLE_CLIENT_ID)return;
 google.accounts.id.initialize({client_id:CONFIG.GOOGLE_CLIENT_ID,callback:onCred});google.accounts.id.renderButton(g,{theme:"outline",size:"large"})}
function meSync(){if(!CONFIG.GOOGLE_CLIENT_ID&&!T)return"";return'<div class="card"><h2>Back up and sync</h2>'+(T?'<p class="mu">Signed in as '+esc(EM)+'. Your data is backed up and works on your other devices.</p><button class="btn o" id="synco">Sync now</button><button class="btn o" id="signo">Sign out</button><button class="btn o" id="delacc">Delete account and cloud data</button>':'<p class="mu">Sign in to back up your data and use it on other phones. Optional.</p>'+(CONFIG.GOOGLE_CLIENT_ID?'<div id="gbtn"></div>':'<p class="mu">Sign-in is not set up yet.</p>'))+'</div>'}
document.addEventListener("click",function(e){var b=e.target.closest("button");if(!b)return;
 if(b.id==="synco")sync();
 if(b.id==="signo"){T="";EM="";LP=0;SENT={};saveAuth();render()}
 if(b.id==="delacc"&&confirm("Delete your account and all cloud data? Data on this phone stays.")){fetch("/api/delete",{method:"POST",headers:{Authorization:"Bearer "+T}}).then(function(){T="";EM="";LP=0;SENT={};S.plan=false;saveAuth();save();render()})}});
document.addEventListener("visibilitychange",function(){if(!document.hidden){render();sync()}});
if("serviceWorker" in navigator)navigator.serviceWorker.register("/sw.js").catch(function(){});
if(CONFIG.GOOGLE_CLIENT_ID){var gs=document.createElement("script");gs.src="https://accounts.google.com/gsi/client";gs.async=true;gs.onload=function(){render()};document.head.appendChild(gs)}
show("home");
if(T)sync();
if(!S.profile&&!S.skip)setTimeout(function(){$("dpf").showModal()},400);
