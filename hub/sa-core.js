/* ================= Satış və Anbar — CORE =================
   The same code runs in two places:
   • on the Google Apps Script server (file Core.gs) — the real rules, enforced there;
   • in the app's demo mode (no server) — so the program can be tried without setup.
   saHandle(db,user,action,payload) reads the in-memory database and returns {res, ch}:
   res = answer for the app, ch = changed rows the caller must save. */
var SA_ROLES={isci:"İşçi (satış)",anbardar:"Anbardar",muhasib:"Mühasib",admin:"Rəhbər"};
var SA_ROLE_ALIASES={"işçi":"isci","isci":"isci","satış":"isci","anbardar":"anbardar","mühasib":"muhasib","muhasib":"muhasib","mühasibat":"muhasib","rəhbər":"admin","rehber":"admin","admin":"admin","müdir":"admin"};
/* ZUVAND Servis: a person's rights are the modules the manager ticked for them.
   role = "admin" (rəhbər, everything) or "p:satis,anbar,…"; the old role names still work. */
var SA_MODS={servis:"Servis hesabatları",tesdiq:"Təsdiq və tapşırıqlar",satis:"Satış (təkliflər)",anbar:"Anbar",muhasibat:"Mühasibat",xerc:"Xərclər və maaşlar"};
function saPerms(r){r=String(r||"");var o={};if(r==="admin"){for(var k in SA_MODS)o[k]=1;o.admin=1;return o}
  if(r.indexOf("p:")===0){r.slice(2).split(",").forEach(function(x){x=x.trim();if(SA_MODS[x])o[x]=1});return o}
  if(r==="isci")o.satis=1;else if(r==="anbardar")o.anbar=1;else if(r==="muhasib"){o.muhasibat=1;o.satis=1;o.xerc=1}return o}
function saHas(r){var P=saPerms(r);for(var i=1;i<arguments.length;i++)if(P[arguments[i]])return true;return !!P.admin}
var SA_CAN={
  seeCost:function(r){return saHas(r,"muhasibat")},           /* gəliş qiyməti, mənfəət */
  editItem:function(r){return saHas(r,"anbar","muhasibat")},
  setPrice:function(r){return saHas(r,"muhasibat")},          /* gəliş + satış qiyməti, hesab-ödəniş */
  moveStock:function(r){return saHas(r,"anbar")},             /* mədaxil / məxaric / düzəliş */
  seeMoves:function(r){return saHas(r,"anbar","muhasibat")},
  quote:function(r){return saHas(r,"satis","muhasibat")},
  invoice:function(r){return saHas(r,"muhasibat")},           /* qaiməni daxil edib təsdiqləmək */
  receive:function(r){return saHas(r,"anbar")},               /* qaimə üzrə malı anbarda qəbul etmək */
  contract:function(r){return saHas(r,"muhasibat")},          /* xidməti müqavilələr */
  seeContracts:function(r){return saHas(r,"satis","muhasibat")},
  editAnyQuote:function(r){return saHas(r,"muhasibat")},
  linePrice:function(r){return saHas(r,"muhasibat")},
  unlimitedDisc:function(r){return saHas(r,"muhasibat")},
  expense:function(r){return saHas(r,"xerc")},               /* ofis xərcləri, maaşlar, vergilər */
  admin:function(r){return saPerms(r).admin===1}
};
function saRoleLabel(r){r=String(r||"");if(SA_ROLES[r])return SA_ROLES[r];var P=saPerms(r);return Object.keys(SA_MODS).filter(function(k){return P[k]}).map(function(k){return SA_MODS[k]}).join(", ")||"—"}
var SA_STATUS={draft:"Qaralama",sent:"Göndərildi",accepted:"Qəbul edildi",rejected:"İmtina",done:"Təhvil verildi"};
var SA_KIND={in:"Mədaxil",out:"Məxaric",adj:"Düzəliş"};
/* company expenses (mühasibat): office, salaries, taxes, other */
var SA_EXP_CATS=["Ofis icarəsi","Kommunal (işıq, su, qaz)","İnternet və telefon","Maaş","Vergi və sosial ödənişlər","Nəqliyyat və yanacaq","Dəftərxana və ofis ləvazimatı","Bank xərcləri","Təmir və avadanlıq","Reklam","Anbar itkisi (silinmə)","Digər"];
var SA_EXP_PAY=["Köçürmə","Nağd","Kart"];
var SA_PERIOD={m:["Aylıq",1],q:["Rüblük",3],h:["Yarımillik",6],y:["İllik",12]};
/* "2026 — IV rüb", "Oktyabr 2026" … : which period of the contract a sale belongs to */
var SA_MONTHS=["Yanvar","Fevral","Mart","Aprel","May","İyun","İyul","Avqust","Sentyabr","Oktyabr","Noyabr","Dekabr"],SA_ROMAN=["I","II","III","IV"];
function saPeriodLabel(date,per){var m=/^(\d{4})-(\d{2})/.exec(String(date||""));if(!m)return "";var y=m[1],mo=+m[2]-1;
  if(per==="m")return SA_MONTHS[mo]+" "+y;if(per==="h")return y+" — "+(mo<6?"I":"II")+" yarımil";if(per==="y")return y+"-ci il";return y+" — "+SA_ROMAN[Math.floor(mo/3)]+" rüb"}
var SA_INV_STATUS={draft:"Qaralama",approved:"Anbarda yoxlanır",received:"Qəbul edildi"};
var SA_CATS=["UPS","Akkumulyator","Stabilizator","Dizel generator","Elektrik paneli / ATS","Ehtiyat hissə","Kabel və aksesuar","Xidmət"];
var SA_UNITS=["ədəd","dəst","metr","kq","litr","saat","xidmət"];
var SA_DEFAULTS={co:"ZUVAND Grand System",coaddr:"",cotel:"",coemail:"",covoen:"",bank:"",prefix:"TK",valid:15,vat:18,maxDisc:10,
  pay:"50% avans, qalan 50% təhvil-təslimdən sonra 5 iş günü ərzində",
  delivery:"Anbarda olan mallar — 3 iş günü; sifarişlə gətirilən mallar — 4–6 həftə",
  warranty:"Avadanlıq üçün istehsalçı zəmanəti — 12 ay; görülən işlərə — 6 ay",note:"",svcSheet:"",svcFrom:""};
var SA_SETTING_KEYS=Object.keys(SA_DEFAULTS);

function saNum(v){if(v===null||v===undefined||v==="")return 0;if(typeof v==="number")return isFinite(v)?v:0;
  var n=parseFloat(String(v).replace(/\s/g,"").replace(",","."));return isFinite(n)?n:0}
function saR2(n){return Math.round((n+Number.EPSILON)*100)/100}
function saId(p){return p+Date.now().toString(36)+Math.random().toString(36).slice(2,7)}
function saRole(v){var k=String(v||"").trim().toLowerCase();return SA_ROLE_ALIASES[k]||(SA_ROLES[k]?k:"")}
function saStr(v,max){return String(v==null?"":v).slice(0,max||500)}

function saLineSum(l){return saR2(saNum(l.qty)*saNum(l.price)*(1-saNum(l.disc)/100))}
function saTotals(q){var gross=0,net=0;(q.lines||[]).forEach(function(l){gross+=saR2(saNum(l.qty)*saNum(l.price));net+=saLineSum(l)});
  net=saR2(net);gross=saR2(gross);var rate=q.vat===false?0:saNum(q.vatRate);var vat=saR2(net*rate/100);
  return {gross:gross,disc:saR2(gross-net),net:net,rate:rate,vat:vat,total:saR2(net+vat)}}

/* stock: q = qalıq (in − out ± adj), r = rezerv (accepted quotes, not yet issued), a = mövcud */
function saIssued(db){var m={};db.moves.forEach(function(x){if(x.del||x.kind!=="out"||!x.quoteId)return;var k=x.quoteId+"|"+x.itemId;m[k]=(m[k]||0)+saNum(x.qty)});return m}
/* a quote line is goods ("mal": reserved and issued from the warehouse) or a service ("xid": installation, rack, labour — never touches stock) */
function saLineType(l,items){if(l.t==="mal"||l.t==="xid")return l.t;if(l.svc===1)return "xid";if(l.svc===2)return "mal";var it=l.itemId&&items?items[l.itemId]:null;if(it)return it.svc?"xid":"mal";return "xid"}
function saQuoteNeed(q,items){var need={};(q.lines||[]).forEach(function(l){if(!l.itemId)return;var it=items[l.itemId];if(!it||it.svc||saLineType(l,items)==="xid")return;need[l.itemId]=(need[l.itemId]||0)+saNum(l.qty)});return need}
function saStock(db){var S={},items={};db.items.forEach(function(i){items[i.id]=i;S[i.id]={q:0,r:0,a:0}});
  db.moves.forEach(function(m){if(m.del||!S[m.itemId])return;var n=saNum(m.qty);S[m.itemId].q+=m.kind==="out"?-n:n});
  var iss=saIssued(db);
  db.quotes.forEach(function(q){if(q.del||q.status!=="accepted")return;var need=saQuoteNeed(q,items);
    Object.keys(need).forEach(function(id){if(!S[id])return;S[id].r+=Math.max(0,need[id]-(iss[q.id+"|"+id]||0))})});
  Object.keys(S).forEach(function(id){var s=S[id];s.q=saR2(s.q);s.r=saR2(s.r);s.a=saR2(s.q-s.r)});return S}
function saRemaining(db,q){var items={};db.items.forEach(function(i){items[i.id]=i});var need=saQuoteNeed(q,items),iss=saIssued(db),out={};
  Object.keys(need).forEach(function(id){out[id]={need:need[id],issued:iss[q.id+"|"+id]||0,left:Math.max(0,saR2(need[id]-(iss[q.id+"|"+id]||0)))}});return out}

function saPubItem(i,role){var o={};for(var k in i)o[k]=i[k];if(!SA_CAN.seeCost(role)){delete o.cost}return o}
function saNormName(s){return String(s||"").toLocaleLowerCase("az").replace(/\u0307/g,"").replace(/ı/g,"i").replace(/ə/g,"e").replace(/ö/g,"o").replace(/ü/g,"u").replace(/ş/g,"s").replace(/ç/g,"c").replace(/ğ/g,"g").replace(/[^a-z0-9]+/g," ").trim()}
function saInvTotals(v){var net=0,vat=0;(v.lines||[]).forEach(function(l){var s=saR2(saNum(l.qty)*saNum(l.price));net+=s;vat+=saNum(l.vat)});net=saR2(net);vat=saR2(vat);return {net:net,vat:vat,total:saR2(net+vat)}}
function saPubInv(v,role){var o={};for(var k in v)o[k]=v[k];if(!SA_CAN.seeCost(role)){o.lines=(v.lines||[]).map(function(l){var c={};for(var k in l)if(k!=="price"&&k!=="vat"&&k!=="sum"&&k!=="fprice")c[k]=l[k];return c});delete o.net;delete o.vat;delete o.total;if(o.imp)o.imp={cur:o.imp.cur,gb:o.imp.gb}}
  else{var t=saInvTotals(v);o.net=t.net;o.vat=t.vat;o.total=t.total}return o}
function saPubMove(m,role){var o={};for(var k in m)o[k]=m[k];if(!SA_CAN.seeCost(role))delete o.cost;return o}
function saKindOf(q){return q.kind==="svc"||q.kind==="sale"?q.kind:(q.src&&q.src.type==="service"?"svc":"sale")}
function saSummary(q){var t=saTotals(q);return {id:q.id,no:q.no||"",kind:saKindOf(q),inv:(q.bill&&q.bill.inv)||"",date:q.date||"",status:q.status||"draft",client:(q.cl&&q.cl.name)||"",cl:q.cl||{},subj:q.subj||"",per:q.per||"",conId:q.conId||"",
  net:t.net,total:t.total,n:(q.lines||[]).length,author:q.author||"",by:q.by||"",updatedAt:q.updatedAt||0,svc:q.src?(q.src.repno||"servis"):"",site:q.src&&q.src.site?q.src.site:"",contractId:q.src?q.src.contractId:"",zero:(q.lines||[]).some(function(l){return !saNum(l.price)}),
  bill:(q.bill&&q.bill.st)||"",nocon:!!(q.src&&q.src.nocon&&!q.del),billDoc:(q.bill&&q.bill.doc)||"",due:!!((q.status==="accepted"||q.status==="done")&&!(q.bill&&q.bill.st==="paid")&&!(q.src&&q.src.nocon)&&!(q.src&&q.src.type==="service"&&q.src.contractId&&(q.billedIn||!(q.bill&&q.bill.st)))),
  wk:q.src&&q.src.type==="service"&&q.src.contractId?1:0,bin:q.billedIn?(q.billedIn.no||"✓"):"",binId:q.billedIn?q.billedIn.id:"",skey:q.src?String(q.src.skey!==undefined&&q.src.skey!==""?q.src.skey:(q.src.site||"")):"",sdate:(q.src&&q.src.date)||"",bmon:q.src&&q.src.type==="bill"?(q.src.month||""):"",nrec:q.src&&q.src.type==="bill"?(q.src.recs||[]).length:0,delAt:q.del?saNum(q.delAt||q.updatedAt):0,delBy:q.del?(q.delBy||q.by||""):"",rev:q.src&&q.src.rev?1:0,dup:q.src&&q.src.dup?(q.src.dup.no||"?"):""}}
/* purchase prices written on quote lines are seen only by accounting */
function saPubQuote(q,role){if(!q||SA_CAN.seeCost(role))return q;var o={};for(var k in q)o[k]=q[k];o.lines=(q.lines||[]).map(function(l){var c={};for(var k in l)if(k!=="cost")c[k]=l[k];return c});return o}
/* a quote that has gone further than a draft offer: deleting it needs the manager's deletion password */
function saProtected(db,q){if(q.status==="accepted"||q.status==="done"||q.bill||(q.src&&q.src.type==="service"))return true;
  return db.moves.some(function(m){return !m.del&&m.kind==="out"&&m.quoteId===q.id})}
/* contract price row for one serviced device: serial № first, then the object + device name */
function saTok(x){return String(x||"").toLowerCase().replace(/kva/g," kva ").split(/[^0-9a-zəöüğıçşа-я.]+/i).filter(function(t){return t&&t.length>1||/\d/.test(t)})}
var SA_GENERIC=["ups","kva","kw","generator","stabilizator","ats","avr","duzlendirici","kompensator","cihaz","online"];
function saKva(x){var m=/(\d+(?:[.,]\d+)?)\s*kva/i.exec(String(x||""));return m?parseFloat(m[1].replace(",",".")):null}
/* one word equals another, or differs by one letter (typos like "Socomee" / "Socomec") */
function saLev1(a,b){if(a===b)return true;if(a.length<5||b.length<5||Math.abs(a.length-b.length)>1||/\d/.test(a)||/\d/.test(b))return false;
  var i=0,j=0,d=0;while(i<a.length&&j<b.length){if(a.charAt(i)===b.charAt(j)){i++;j++;continue}if(++d>1)return false;if(a.length>b.length)i++;else if(b.length>a.length)j++;else{i++;j++}}return d+(a.length-i)+(b.length-j)<=1}
/* a row can be used as many times as its count (Say) */
function saRowCap(r){return Math.max(1,Math.round(saNum(r&&r.n))||1)}
/* the same "serial" in several rows is not a serial number (often the e-qaimə service code pasted by mistake) */
function saFakeSn(L){var c={},o={},snn=function(x){return String(x||"").toLowerCase().replace(/\s+/g,"")};L.forEach(function(r){var k=snn(r.sn);if(k)c[k]=(c[k]||0)+1});for(var k in c)if(c[k]>1)o[k]=1;return o}
function saPriceRow(con,site,d,used){var L=con.plist||[],i=d.info||d.ups||{},snn=function(x){return String(x||"").toLowerCase().replace(/\s+/g,"")},sn=snn(i.sn),best=-1,bs=0,fake=saFakeSn(L);
  var free=function(k){return (used[k]||0)<saRowCap(L[k])},rsn=function(r){var x=snn(r.sn);return fake[x]?"":x};
  if(sn)for(var k=0;k<L.length;k++)if(free(k)&&rsn(L[k])===sn)return k;
  var kv=i.kva!==undefined&&String(i.kva).trim()!==""?parseFloat(String(i.kva).replace(",",".")):null;
  var sites={};L.forEach(function(r){if(r.site)sites[saNormName(r.site)]=1});var multi=Object.keys(sites).length>1;
  var loc=String(d.loc||"").trim(),siteHit=function(r){return !r.site||(!site&&!loc)||saNameHit(r.site,site,true)||(loc&&saNameHit(r.site,loc,true))},kvaOk=function(r){var rk=saKva(r.name);return kv===null||isNaN(kv)||rk===null||Math.abs(rk-kv)<0.01};
  var dt=saTok([i.brand,i.model,kv!==null?kv+" kva":""].join(" ")).map(saNormName).filter(function(t){return SA_GENERIC.indexOf(t)<0});
  var hit=function(t,arr){for(var z=0;z<arr.length;z++)if(saLev1(t,arr[z]))return true;return false};
  for(var k2=0;k2<L.length;k2++){var r=L[k2];if(!free(k2)||!kvaOk(r))continue;var sh=siteHit(r);if(!sh&&multi)continue;
    var rt=saTok(r.name).map(saNormName).filter(function(t){return SA_GENERIC.indexOf(t)<0}),sc=rt.filter(function(t){return hit(t,dt)}).length+(r.site&&sh?0.5:0)-(sh?0:0.5)-(rsn(r)&&sn?0.6:0);
    if(sc>bs){bs=sc;best=k2}}
  if(best>=0&&bs>=1)return best;
  /* one device left for this object (same kVA if known): take it */
  var cand=[];for(var k3=0;k3<L.length;k3++){var r3=L[k3];if(free(k3)&&!(rsn(r3)&&sn)&&siteHit(r3)&&kvaOk(r3))cand.push(k3)}
  return cand.length===1?cand[0]:-1}
var SA_DEVTYPE={ups:"UPS",avr:"ATS AVR",gen:"generator",svr:"stabilizator",rect:"düzləndirici",pfc:"kompensator"};
function saDevName(d){var i=d.info||d.ups||{};return ([i.brand,i.model].filter(Boolean).join(" ")+(i.kva?" "+i.kva+" kVA":"")).trim()||SA_DEVTYPE[d.type]||"Cihaz"}
/* compact copy of the serviced devices, kept on the sale so it can be priced later from a contract */
function saDevsOf(devs){return devs.map(function(d){var i=d.info||d.ups||{};return {type:saStr(d.type,10),loc:saStr(d.loc,160),info:{brand:saStr(i.brand,60),model:saStr(i.model,80),kva:saStr(i.kva,20),sn:saStr(i.sn,60)}}})}
/* one service line per device, priced from the contract's device list (or one line at the contract's visit price) */
function saDevLine(d){var i=d.info||d.ups||{};return [i.sn?"SN "+saStr(i.sn,60):"",d.loc?saStr(d.loc,160):""].filter(Boolean).join(" · ")}
function saContractLines(con,site,devs,info){var cname="Texniki xidmət — "+SA_PERIOD[saObjPer(con,site)][0].toLowerCase()+" müqavilə"+(con.no?" № "+con.no:""),lines=[];
  if(con.plist&&con.plist.length){var used={};
    devs.forEach(function(d,di){var i=d.info||d.ups||{},k=saPriceRow(con,site,d,used),row=k>=0?con.plist[k]:null;if(k>=0)used[k]=(used[k]||0)+1;
      lines.push({id:saId("l"),itemId:"",svc:1,name:(row&&row.name?row.name:saDevName(d)),
        desc:[saDevLine(d),di===0&&info?info:"",row?cname:"Müqavilənin cihaz siyahısında tapılmadı — qiyməti yazın"].filter(Boolean).join("\n"),unit:"xidmət",qty:1,price:row?row.price:0,disc:0,crow:k,csn:saStr(i.sn,60)})})}
  if(!lines.length)lines.push({id:saId("l"),itemId:"",svc:1,name:cname,desc:info||"",unit:"xidmət",qty:1,price:con.plist&&con.plist.length?0:con.price,disc:0});
  return lines}
var SA_SVCLINE=/^(Texniki xidmət|Servis xidməti)/;
/* contract helpers */
function saAddMonths(iso,n){var m=/^(\d{4})-(\d{2})-(\d{2})/.exec(iso||"");if(!m)return "";var y=+m[1],mo=+m[2]-1+n,last=new Date(Date.UTC(y,mo+1,0)).getUTCDate();
  return new Date(Date.UTC(y,mo,Math.min(+m[3],last))).toISOString().slice(0,10)}
/* two names are the same company: equal after normalising, or (fallback) every word of the shorter one (6+ letters) is a word of the longer one */
function saNameHit(a,b,loose){a=saNormName(a);b=saNormName(b);if(!a||!b)return false;if(a===b)return true;if(!loose)return false;
  var s=a.length<=b.length?a:b,l=s===a?b:a;if(s.length<6)return false;var lt=l.split(" ");return s.split(" ").every(function(t){return lt.indexOf(t)>=0})}
function saContractFor(db,name,date,site){if(!saNormName(name))return null;
  /* one company with several contracts: the one that lists this object (sites / device list) wins */
  var bySite=function(L){if(!site||L.length<2)return L;var f=L.filter(function(c){return String(c.sites||"").split(/[,;\n]/).concat((c.plist||[]).map(function(x){return x.site})).some(function(x){return String(x||"").trim()&&saNameHit(x,site,true)})});return f.length?f:L};
  var live=(db.contracts||[]).filter(function(c){return !c.del&&c.kind!=="sale"&&c.active!==false&&!(date&&((c.start&&date<c.start)||(c.end&&date>c.end)))});
  var names=function(c){return [c.client].concat(String(c.aliases||"").split(/[,;\n]/)).concat(String(c.sites||"").split(/[,;\n]/)).filter(function(x){return String(x).trim()})};
  var pick=function(L){var best=null;L.forEach(function(c){if(!best||String(c.start)>String(best.start))best=c});return best};
  var exact=live.filter(function(c){return names(c).some(function(x){return saNameHit(x,name)})});if(exact.length)return pick(bySite(exact));
  /* loose match only when it points to one company */
  var loose=live.filter(function(c){return names(c).some(function(x){return saNameHit(x,name,true)})}),cl={};loose.forEach(function(c){cl[saNormName(c.client)]=1});
  return Object.keys(cl).length===1?pick(bySite(loose)):null}
function saObjPer(con,obj){var m=(con&&con.sitePer)||{};if(obj&&String(obj).trim()){var on=saNormName(obj);for(var k in m)if(SA_PERIOD[m[k]]&&(k===on||saNameHit(k,obj,true)))return m[k]}return con&&SA_PERIOD[con.period]?con.period:"q"}
/* payment picture for the service journal: each service report → its sale / monthly bill and whether it is paid; open amounts per client */
function saPayInfo(db){var Q=(db.quotes||[]).filter(function(q){return !q.del}),by={};Q.forEach(function(q){by[q.id]=q});
  var st=function(q){var b=q.bill&&q.bill.st;return b==="paid"?"paid":b==="inv"?"inv":"none"},reps={},items=[];
  Q.forEach(function(q){var s=q.src;if(!s||s.type!=="service"||!s.reportId)return;var amt=saTotals(q).total;
    if(q.status!=="accepted"&&q.status!=="done"){reps[s.reportId]={st:"draft",no:q.no||"",amount:amt,client:(q.cl&&q.cl.name)||"",site:s.site||""};return}
    var h=q.billedIn&&by[q.billedIn.id]?by[q.billedIn.id]:q,b=h.bill||{};
    reps[s.reportId]={st:st(h),no:q.no||"",bill:h!==q?(h.no||""):"",doc:b.doc||"",at:b.st==="paid"?saNum(b.at):0,amount:amt,client:(h.cl&&h.cl.name)||"",site:s.site||""}});
  Q.forEach(function(q){if(q.status!=="accepted"&&q.status!=="done")return;var s=q.src||{};if(s.nocon)return;
    if(s.type==="service"&&s.contractId&&q.billedIn&&by[q.billedIn.id])return;var t=st(q);if(t==="paid")return;
    items.push({client:(q.cl&&q.cl.name)||"",no:q.no||"",date:q.date||"",total:saTotals(q).total,st:t,site:s.site||(s.type==="bill"?"":""),kind:s.type==="bill"?"bill":s.type==="service"?"svc":"sale",doc:(q.bill&&q.bill.doc)||""})});
  return {reps:reps,items:items}}
function saPartItem(db,p){var code=String(p.code||"").trim().toLowerCase(),nn=saNormName(p.name);if(!code&&!nn)return null;
  var byCode=code?db.items.filter(function(it){return it.active!==false&&(String(it.code).toLowerCase()===code||(it.model&&saNormName(it.model)===saNormName(code)))}):[];
  if(byCode.length>1&&nn){var bn=byCode.filter(function(x){return saNormName(x.name)===nn||String(x.alias||"").split("|").indexOf(nn)>=0})[0];if(bn)return bn}
  if(byCode.length)return byCode[0];
  for(var j=0;j<db.items.length;j++){var x=db.items[j];if(x.active===false)continue;if(nn&&(saNormName(x.name)===nn||String(x.alias||"").split("|").indexOf(nn)>=0))return x}return null}
function saSettings(db){var s={};SA_SETTING_KEYS.forEach(function(k){s[k]=db.settings[k]!==undefined&&db.settings[k]!==""?db.settings[k]:SA_DEFAULTS[k]});
  ["valid","vat","maxDisc"].forEach(function(k){s[k]=saNum(s[k])});return s}

function saErr(code,extra){var e=new Error(code);e.code=code;if(extra)e.extra=extra;throw e}

function saHandle(db,u,action,p){
  p=p||{};db.invoices=db.invoices||[];db.contracts=db.contracts||[];db.expenses=db.expenses||[];var role=u.role,now=Date.now(),ch={items:[],moves:[],quotes:[],invoices:[],contracts:[],expenses:[],settings:null};
  var invById=function(id){for(var i=0;i<db.invoices.length;i++)if(db.invoices[i].id===id&&!db.invoices[i].del)return db.invoices[i];return null};
  var need=function(ok){if(!ok)saErr("forbidden")};
  var itemById=function(id){for(var i=0;i<db.items.length;i++)if(db.items[i].id===id)return db.items[i];
    var al=null;try{al=JSON.parse(String(db.settings.itemAlias||"{}"))}catch(e){al={}}var to=al&&al[id];if(to)for(var k=0;k<db.items.length;k++)if(db.items[k].id===to)return db.items[k];return null};
  var quoteById=function(id){for(var i=0;i<db.quotes.length;i++)if(db.quotes[i].id===id&&!db.quotes[i].del)return db.quotes[i];return null};
  var S=saSettings(db);
  switch(action){
  case "ping":return {res:{role:role,name:u.name},ch:ch};

  case "boot":{
    var items=db.items.filter(function(i){return i.active!==false||SA_CAN.editItem(role)}).map(function(i){return saPubItem(i,role)});
    var quotes=db.quotes.filter(function(q){return !q.del}).map(saSummary);
    var res={role:role,name:u.name,settings:S,items:items,stock:saStock(db),quotes:quotes,ts:now,conKinds:1,srv:3,hasDelPw:!!db.settings.delPw};
    if(SA_CAN.admin(role)){res.delPw=String(db.settings.delPw||"");var since=now-30*86400000;res.deleted=db.quotes.filter(function(q){return q.del&&saNum(q.delAt||q.updatedAt)>since}).map(saSummary)}
    if(SA_CAN.seeContracts(role))res.contracts=db.contracts.filter(function(c){return !c.del});
    if(SA_CAN.expense(role))res.expenses=db.expenses.filter(function(x){return !x.del});
    if(p.full&&SA_CAN.seeMoves(role)){
      res.moves=db.moves.filter(function(m){return !m.del}).sort(function(x,y){return String(y.date).localeCompare(String(x.date))||(saNum(y.at)-saNum(x.at))}).slice(0,1000).map(function(m){return saPubMove(m,role)});
      res.remaining={};db.quotes.forEach(function(q){if(!q.del&&q.status==="accepted")res.remaining[q.id]=saRemaining(db,q)});
      res.invoices=db.invoices.filter(function(v){return !v.del}).sort(function(a,b){return String(b.date).localeCompare(String(a.date))||(saNum(b.updatedAt)-saNum(a.updatedAt))}).slice(0,600).map(function(v){return saPubInv(v,role)})}
    return {res:res,ch:ch}}

  case "getQuotes":{var ids=(p.ids||[]).slice(0,40),out=[];ids.forEach(function(id){var q=quoteById(id);if(q)out.push(saPubQuote(q,role))});return {res:{quotes:out},ch:ch}}

  case "getQuote":{var q=quoteById(p.id);if(!q)saErr("notfound");
    return {res:{quote:saPubQuote(q,role),remaining:q.status==="accepted"||q.status==="done"?saRemaining(db,q):null},ch:ch}}

  case "saveQuote":{
    need(SA_CAN.quote(role));var inQ=p.quote||{};var old=inQ.id?quoteById(inQ.id):null;
    if(old){
      if(old.author!==u.name&&!SA_CAN.editAnyQuote(role))saErr("forbidden");
      if(old.status==="done"&&!SA_CAN.admin(role))saErr("locked");
      if(saNum(p.baseAt)&&saNum(old.updatedAt)>saNum(p.baseAt))saErr("conflict",{quote:old})}
    var q={id:old?old.id:(inQ.id||saId("q")),no:old?old.no:"",author:old?old.author:u.name,created:old?old.created:now,
      date:saStr(inQ.date,10),valid:Math.max(1,Math.round(saNum(inQ.valid))||S.valid),status:SA_STATUS[inQ.status]?inQ.status:"draft",
      subj:saStr(inQ.subj,300),cl:{},eng:saStr(inQ.eng,120),engpos:saStr(inQ.engpos,120),engtel:saStr(inQ.engtel,60),
      vat:inQ.vat!==false,vatRate:old?saNum(old.vatRate):S.vat,terms:{},lines:[],updatedAt:now,by:u.name};
    if(inQ.showCode!==undefined)q.showCode=!!inQ.showCode;else if(old&&old.showCode!==undefined)q.showCode=old.showCode;
    if(inQ.showDesc!==undefined)q.showDesc=!!inQ.showDesc;else if(old&&old.showDesc!==undefined)q.showDesc=old.showDesc;
    if(inQ.shortName!==undefined)q.shortName=!!inQ.shortName;else if(old&&old.shortName!==undefined)q.shortName=old.shortName;
    if(inQ.per!==undefined)q.per=saStr(inQ.per,60).trim();else if(old&&old.per)q.per=old.per;
    if(inQ.conId!==undefined)q.conId=saStr(inQ.conId,60);else if(old&&old.conId)q.conId=old.conId;
    if(old&&old.src)q.src=old.src;if(old&&old.billedIn)q.billedIn=old.billedIn;if(old&&old.bill)q.bill=old.bill;if(old&&old.fromInv)q.fromInv=old.fromInv;
    if(inQ.kind==="svc"||inQ.kind==="sale")q.kind=inQ.kind;else if(old&&old.kind)q.kind=old.kind;
    /* "Təhvil verildi" is set by the warehouse issue (or by the manager), not typed in */
    if(SA_CAN.editAnyQuote(role)&&inQ.vatRate!==undefined)q.vatRate=saNum(inQ.vatRate);
    ["name","voen","person","tel","email","addr"].forEach(function(k){q.cl[k]=saStr(inQ.cl&&inQ.cl[k],300)});
    ["pay","delivery","warranty","note"].forEach(function(k){q.terms[k]=saStr(inQ.terms&&inQ.terms[k],2000)});
    var oldLines={};if(old)(old.lines||[]).forEach(function(l){oldLines[l.id]=l});
    (inQ.lines||[]).slice(0,300).forEach(function(l){
      var it=l.itemId?itemById(l.itemId):null;
      var L={id:saStr(l.id||saId("l"),40),itemId:it?it.id:"",code:it?it.code:saStr(l.code,60),name:saStr(l.name||(it&&it.name),300),desc:saStr(l.desc,1000),
        unit:saStr(l.unit||(it&&it.unit)||"ədəd",20),qty:Math.max(0,saNum(l.qty)),price:Math.max(0,saR2(saNum(l.price))),disc:Math.min(100,Math.max(0,saNum(l.disc)))};
      if(l.svc)L.svc=l.svc===2?2:1;
      if(l.t==="mal"||l.t==="xid")L.t=l.t;
      /* purchase price of the line (free lines, imports): written by accounting, kept as it was for everybody else */
      if(SA_CAN.seeCost(role)){if(saNum(l.cost)>0)L.cost=saR2(saNum(l.cost))}else{var olc=oldLines[L.id];if(olc&&saNum(olc.cost)>0)L.cost=olc.cost}
      if(l.done&&saNum(l.done.at))L.done={at:saNum(l.done.at),by:saStr(l.done.by,120)};
      if(l.crow!==undefined&&l.crow!==null&&l.crow!=="")L.crow=Math.round(saNum(l.crow));if(l.csn)L.csn=saStr(l.csn,60);
      if(it&&!SA_CAN.linePrice(role)){var ol=oldLines[L.id];L.price=ol&&ol.itemId===it.id?saNum(ol.price):saNum(it.price)}
      if(!SA_CAN.unlimitedDisc(role)&&L.disc>S.maxDisc){var ol2=oldLines[L.id];L.disc=ol2&&ol2.itemId===L.itemId&&saNum(ol2.disc)===L.disc?L.disc:S.maxDisc}
      q.lines.push(L)});
    /* "Təhvil verildi" (job finished): the manager at any time, others once nothing is left to issue from the warehouse */
    if(q.status==="done"&&!(old&&old.status==="done")){var rq=saRemaining(db,q),lft=0;Object.keys(rq).forEach(function(id){lft+=rq[id].left});
      if(!old||lft>1e-9)q.status=old&&old.status!=="done"?old.status:"accepted"}
    q.hist=(old&&old.hist||[]).slice(-39);if(!old||old.status!==q.status)q.hist.push({at:now,by:u.name,st:q.status});
    if(!q.no){var y=(/^\d{4}/.test(q.date||"")?q.date:new Date(now).toISOString()).slice(0,4),key="seq"+y,n=saNum(db.settings[key])+1;db.settings[key]=n;
      q.no=(S.prefix||"TK")+"-"+y+"-"+("000"+n).slice(-4);ch.settings={};ch.settings[key]=n}
    if(JSON.stringify(q).length>45000)saErr("toolarge");
    if(old){for(var i=0;i<db.quotes.length;i++)if(db.quotes[i].id===q.id)db.quotes[i]=q}else db.quotes.push(q);
    ch.quotes.push(q);return {res:{quote:saPubQuote(q,role),summary:saSummary(q),stock:saStock(db)},ch:ch}}

  case "setBill":{need(SA_CAN.setPrice(role));var bq=quoteById(p.id);if(!bq||bq.del)saErr("notfound");var st=["","inv","paid"].indexOf(p.st)>=0?p.st:"";
    if(st)bq.bill={st:st,doc:saStr(p.doc!==undefined?p.doc:(bq.bill&&bq.bill.doc),80),by:u.name,at:now};else delete bq.bill;bq.updatedAt=now;bq.by=u.name;
    bq.hist=(bq.hist||[]).slice(-39);bq.hist.push({at:now,by:u.name,bill:st||"undo",doc:st?bq.bill.doc:""});ch.quotes.push(bq);return {res:{quote:saPubQuote(bq,role)},ch:ch}}
  case "delQuote":{need(SA_CAN.admin(role));var dq=quoteById(p.id);if(!dq)saErr("notfound");
    if(saProtected(db,dq)){if(!db.settings.delPw)saErr("nopw");if(String(p.pwh||"")!==String(db.settings.delPw))saErr("badpw")}
    dq.del=true;dq.delAt=now;dq.delBy=u.name;
    if(dq.src&&dq.src.type==="bill")(dq.src.recs||[]).forEach(function(id){var x=quoteById(id);if(x&&x.billedIn&&x.billedIn.id===dq.id){delete x.billedIn;x.updatedAt=now;ch.quotes.push(x)}});dq.updatedAt=now;dq.by=u.name;dq.hist=(dq.hist||[]).slice(-39);dq.hist.push({at:now,by:u.name,st:"deleted"});ch.quotes.push(dq);
    return {res:{stock:saStock(db)},ch:ch}}
  /* full copy of the data for a backup file (manager only) */
  case "backup":{need(SA_CAN.admin(role));var cpy=function(a){return JSON.parse(JSON.stringify(a||[]))};
    return {res:{db:{items:cpy(db.items),moves:cpy(db.moves),quotes:cpy(db.quotes),invoices:cpy(db.invoices),contracts:cpy(db.contracts),expenses:cpy(db.expenses),settings:JSON.parse(JSON.stringify(db.settings||{}))}},ch:ch}}
  /* one bill a month for a client / intermediary: the approved service visits of that month (each object with its own period) */
  case "svcBill":{need(SA_CAN.setPrice(role)||SA_CAN.contract(role));var bR=[];
    (p.recs||[]).slice(0,300).forEach(function(id){var x=quoteById(id);if(x&&x.src&&x.src.type==="service"&&!x.billedIn&&!(x.bill&&x.bill.st)&&x.status!=="rejected"&&bR.indexOf(x)<0)bR.push(x)});
    if(!bR.length)saErr("nothing");var mon=/^\d{4}-\d{2}$/.test(String(p.month||""))?String(p.month):String(bR[0].date||"").slice(0,7);
    var bc=null;db.contracts.forEach(function(c){if(!c.del&&c.id===bR[0].src.contractId)bc=c});
    bR.sort(function(a,b){var x=String(a.src.skey||a.src.site||""),y=String(b.src.skey||b.src.site||"");return x.localeCompare(y)||String(a.date).localeCompare(String(b.date))});
    var bl=[],objs={};bR.forEach(function(x){var s0=x.src||{},ob=s0.site||s0.skey||"";if(ob)objs[saNormName(ob)]=1;
      var hd=(ob?"Obyekt: "+ob+" · ":"")+"hesabat № "+(s0.repno||"")+", "+String(x.date||"").split("-").reverse().join(".")+" · "+(x.no||"");
      (x.lines||[]).forEach(function(l,li){var L={};for(var k in l)if(k!=="id"&&k!=="crow")L[k]=l[k];L.id=saId("l");L.t="xid";
        if(li===0&&String(L.desc||"").indexOf(String(s0.repno||"#"))<0)L.desc=hd+(L.desc?"\n"+L.desc:"");bl.push(L)})});
    var ym=mon.split("-"),mlab=SA_MONTHS[+ym[1]-1]+" "+ym[0],cl0=bR[0].cl||{};
    var cl1=bc?{name:bc.client,voen:bc.voen,person:bc.person,tel:bc.tel,addr:bc.addr}:{name:cl0.name,voen:cl0.voen,person:cl0.person,tel:cl0.tel,addr:cl0.addr};
    var ob=saHandle(db,u,"saveQuote",{quote:{date:p.date&&/^\d{4}-\d{2}-\d{2}$/.test(p.date)?p.date:new Date(now).toISOString().slice(0,10),valid:S.valid,status:"accepted",per:mlab,
      subj:"Servis xidməti — "+mlab+" — "+Math.max(1,Object.keys(objs).length)+" obyekt, "+bR.length+" servis"+(bc&&bc.no?" · müqavilə № "+bc.no:""),cl:cl1,vat:true,kind:"svc",
      terms:{pay:"Xidməti müqaviləyə uyğun",delivery:"",warranty:"",note:""},lines:bl}});
    var bq=ob.res.quote;bq.src={type:"bill",month:mon,recs:bR.map(function(x){return x.id}),contractId:bc?bc.id:""};bq.kind="svc";
    ob.ch.quotes.forEach(function(x){ch.quotes.push(x)});if(ob.ch.settings){ch.settings=ch.settings||{};for(var k7 in ob.ch.settings)ch.settings[k7]=ob.ch.settings[k7]}
    bR.forEach(function(x){x.billedIn={id:bq.id,no:bq.no};x.updatedAt=now;ch.quotes.push(x)});
    return {res:{quote:bq,summary:saSummary(bq),stock:saStock(db)},ch:ch}}
  /* deleted quotes stay 30 days in "Silinənlər" and can be brought back */
  case "restoreQuote":{need(SA_CAN.admin(role));var rq2=null;db.quotes.forEach(function(x){if(x.id===p.id)rq2=x});if(!rq2)saErr("notfound");if(!rq2.del)return {res:{quote:rq2,dup:true},ch:ch};
    rq2.del=false;delete rq2.delAt;delete rq2.delBy;
    if(rq2.src&&rq2.src.type==="bill")(rq2.src.recs||[]).forEach(function(id){var x=quoteById(id);if(x&&!x.billedIn&&!(x.bill&&x.bill.st)){x.billedIn={id:rq2.id,no:rq2.no};x.updatedAt=now;ch.quotes.push(x)}});rq2.updatedAt=now;rq2.by=u.name;rq2.hist=(rq2.hist||[]).slice(-39);rq2.hist.push({at:now,by:u.name,st:"restored"});ch.quotes.push(rq2);
    return {res:{quote:rq2,summary:saSummary(rq2),stock:saStock(db)},ch:ch}}
  /* the manager's password for deleting accepted / issued / invoiced / paid documents (only its SHA-256 is stored) */
  case "setDelPw":{need(SA_CAN.admin(role));if(db.settings.delPw&&String(p.old||"")!==String(db.settings.delPw))saErr("badpw");
    db.settings.delPw=saStr(p.pwh,100);ch.settings={delPw:db.settings.delPw};return {res:{hasDelPw:!!db.settings.delPw},ch:ch}}

  case "saveItem":{
    need(SA_CAN.editItem(role));var a=p.item||{},ex=a.id?itemById(a.id):null;
    var code=saStr(a.code,60).trim();if(!code)saErr("code");if(!saStr(a.name).trim())saErr("name");
    var nn0=saNormName(a.name);for(var j=0;j<db.items.length;j++){var o=db.items[j];if(String(o.code).toLowerCase()===code.toLowerCase()&&saNormName(o.name)===nn0&&(!ex||o.id!==ex.id)){
      if(ex)saErr("dupcode");
      /* a new card for goods that are already in the catalog: use the existing card (switched on again if it was off) */
      var mal={};try{mal=JSON.parse(String(db.settings.itemAlias||"{}"))||{}}catch(e){mal={}}if(a.id&&a.id!==o.id){mal[a.id]=o.id;var mk=Object.keys(mal);if(mk.length>500)mk.slice(0,mk.length-500).forEach(function(x){delete mal[x]});
        db.settings.itemAlias=JSON.stringify(mal);ch.settings=ch.settings||{};ch.settings.itemAlias=db.settings.itemAlias}
      if(o.active===false){o.active=true;o.updatedAt=now;o.by=u.name;ch.items.push(o)}
      return {res:{item:saPubItem(o,role),merged:true,stock:saStock(db)},ch:ch}}}
    var it2=ex||{id:(a.id&&/^[\w-]{4,60}$/.test(a.id))?a.id:saId("i"),cost:0,price:0,created:now};
    it2.code=code;it2.name=saStr(a.name,300).trim();it2.cat=saStr(a.cat,80);it2.brand=saStr(a.brand,80);it2.model=saStr(a.model,120);
    it2.unit=saStr(a.unit||"ədəd",20);it2.desc=saStr(a.desc,1000);it2.min=Math.max(0,saNum(a.min));it2.svc=!!a.svc;it2.active=a.active!==false;
    if(SA_CAN.setPrice(role)){it2.cost=Math.max(0,saR2(saNum(a.cost)));it2.price=Math.max(0,saR2(saNum(a.price)))}
    it2.updatedAt=now;it2.by=u.name;if(!ex)db.items.push(it2);ch.items.push(it2);
    return {res:{item:saPubItem(it2,role),stock:saStock(db)},ch:ch}}

  /* ZUVAND Servis: the manager removes goods from the catalog and the warehouse; a remaining balance is written off first so the movement history stays complete */
  case "delItems":{
    need(SA_CAN.admin(role));var ids=(p.ids||[]).slice(0,5000).map(String),stD=saStock(db),gone=0,today=new Date(now).toISOString().slice(0,10);
    ids.forEach(function(id){var it=itemById(id);if(!it)return;var q=stD[id]?saR2(stD[id].q):0;
      if(q&&!it.svc){var m={id:saId("m"),date:today,kind:"adj",itemId:it.id,code:it.code,name:it.name,qty:-q,cost:saNum(it.cost),doc:"Mal silindi",party:"",quoteId:"",quoteNo:"",note:"Mal kataloqdan silindi — qalıq silindi",by:u.name,at:now};db.moves.push(m);ch.moves.push(m)}
      db.items=db.items.filter(function(x){return x.id!==id});gone++});
    if(gone)ch.itemsGone=gone;
    return {res:{deleted:gone,stock:saStock(db)},ch:ch}}

  /* categories: one category for many goods at once (manual choice, rename, or the automatic split by name) */
  case "setCat":{
    need(SA_CAN.editItem(role));var cat=saStr(p.cat,80).trim(),cids=(p.ids||[]).slice(0,5000).map(String),nCat=0,outIt=[];
    cids.forEach(function(id){var it=itemById(id);if(!it||String(it.cat||"")===cat)return;it.cat=cat;it.updatedAt=now;it.by=u.name;ch.items.push(it);outIt.push(saPubItem(it,role));nCat++});
    return {res:{n:nCat,items:outIt},ch:ch}}

  case "importItems":{
    need(SA_CAN.setPrice(role));var added=0,updated=0,skipped=0,rows=(p.items||[]).slice(0,5000),cnt={},map=[];
    rows.forEach(function(a){var c=saStr(a.code,60).trim().toLowerCase();if(c)cnt[c]=(cnt[c]||0)+1});
    /* a row updates the catalog item with the same code and name; the code alone is enough only when it is used once on both sides */
    var findIt=function(code,name){var lc=code.toLowerCase(),nn=saNormName(name),same=db.items.filter(function(x){return String(x.code).toLowerCase()===lc});
      var bn=same.filter(function(x){return saNormName(x.name)===nn})[0];if(bn)return bn;return same.length===1&&cnt[lc]===1?same[0]:null};
    rows.forEach(function(a,ri){var code=saStr(a.code,60).trim(),name=saStr(a.name,300).trim();if(!code||!name){skipped++;return}
      var ex=findIt(code,name);
      var it=ex||{id:saId("i"),code:code,cost:0,price:0,min:0,svc:false,active:true,created:now,cat:"",brand:"",model:"",unit:"ədəd",desc:""};
      it.name=name;["cat","brand","model","unit","desc"].forEach(function(k){if(a[k]!==undefined&&a[k]!=="")it[k]=saStr(a[k],k==="desc"?1000:120)});
      ["cost","price","min"].forEach(function(k){if(a[k]!==undefined&&a[k]!=="")it[k]=Math.max(0,saR2(saNum(a[k])))});
      if(a.svc!==undefined&&a.svc!=="")it.svc=/^(1|true|bəli|beli|hə|he|x|yes|xidmət)$/i.test(String(a.svc).trim());
      it.updatedAt=now;it.by=u.name;if(ex)updated++;else{db.items.push(it);added++}ch.items.push(it);map[ri]=it});
    /* opening balances: "Qalıq" column creates a correction so stock equals the given number */
    var st=saStock(db);rows.forEach(function(a,ri){if(a.qty===undefined||a.qty==="")return;
      var it=map[ri];if(!it||it.svc)return;var d=saR2(saNum(a.qty)-st[it.id].q);if(!d)return;
      if(!SA_CAN.moveStock(role)&&!SA_CAN.setPrice(role))return;
      var m={id:saId("m"),date:new Date(now).toISOString().slice(0,10),kind:"adj",itemId:it.id,code:it.code,name:it.name,qty:d,cost:saNum(it.cost),doc:"Excel idxalı",party:"",quoteId:"",quoteNo:"",note:"Açılış qalığı / inventar",by:u.name,at:now};
      db.moves.push(m);ch.moves.push(m);st[it.id].q+=d});
    return {res:{added:added,updated:updated,skipped:skipped},ch:ch}}

  case "moves":{need(SA_CAN.seeMoves(role));var lim=Math.min(3000,saNum(p.limit)||800);
    var list=db.moves.filter(function(m){return !m.del}).sort(function(x,y){return String(y.date).localeCompare(String(x.date))||(saNum(y.at)-saNum(x.at))}).slice(0,lim).map(function(m){return saPubMove(m,role)});
    return {res:{moves:list},ch:ch}}

  case "addMoves":{
    need(SA_CAN.moveStock(role));var kind=p.kind;if(!SA_KIND[kind])saErr("kind");
    var opId=/^[\w-]{4,60}$/.test(String(p.opId||""))?String(p.opId):"";
    if(opId&&db.moves.some(function(m){return m.id===opId+"_0"}))return {res:{dup:true,stock:saStock(db)},ch:ch};
    var lines=(p.lines||[]).filter(function(l){return l&&l.itemId&&saNum(l.qty)!==0});if(!lines.length)saErr("empty");
    if(kind==="adj"&&!saStr(p.note).trim())saErr("note");
    var qq=p.quoteId?quoteById(p.quoteId):null;if(p.quoteId&&!qq)saErr("notfound");
    if(qq&&kind==="out"&&qq.status!=="accepted")saErr("notaccepted");
    var st2=saStock(db),rem=qq?saRemaining(db,qq):null,sum={};
    lines.forEach(function(l){var it=itemById(l.itemId);if(!it)saErr("notfound");if(it.svc)saErr("service",{name:it.name});
      var n=saNum(l.qty);if(kind!=="adj"&&n<=0)saErr("qty",{name:it.name});sum[it.id]=(sum[it.id]||0)+n});
    Object.keys(sum).forEach(function(id){var it=itemById(id),n=sum[id];
      if(kind==="out"){if(n>st2[id].q+1e-9)saErr("nostock",{name:it.name,have:st2[id].q});
        if(rem&&(!rem[id]||n>rem[id].left+1e-9))saErr("overquote",{name:it.name,left:rem[id]?rem[id].left:0})}
      if(kind==="adj"&&st2[id].q+n<-1e-9)saErr("nostock",{name:it.name,have:st2[id].q})});
    var date=saStr(p.date,10)||new Date(now).toISOString().slice(0,10),made=[];
    var reason=kind==="out"&&!qq&&(p.reason==="use"||p.reason==="loss")?p.reason:"";
    lines.forEach(function(l){var it=itemById(l.itemId);
      var m={id:opId?opId+"_"+made.length:saId("m"),date:date,kind:kind,itemId:it.id,code:it.code,name:it.name,qty:saR2(saNum(l.qty)),cost:0,doc:saStr(p.doc,80),party:saStr(p.party,200),
        quoteId:qq?qq.id:"",quoteNo:qq?qq.no:"",note:saStr(p.note,500),by:u.name,at:now};if(reason)m.reason=reason;
      if(kind==="in"&&SA_CAN.seeCost(role)&&saNum(l.cost)>0){m.cost=saR2(saNum(l.cost));it.cost=m.cost;it.updatedAt=now;it.by=u.name;ch.items.push(it)}
      else if(kind!=="in")m.cost=saNum(it.cost);
      db.moves.push(m);ch.moves.push(m);made.push(m)});
    if(reason){var amt=0,nm=[];made.forEach(function(m){amt+=Math.abs(saNum(m.qty))*saNum(m.cost);nm.push(m.name+" × "+m.qty)});
      var xp={id:"x_"+made[0].id,date:date,cat:reason==="loss"?"Anbar itkisi (silinmə)":(saStr(p.expCat,80).trim()||"Dəftərxana və ofis ləvazimatı"),amount:saR2(amt),
        payee:saStr(p.party,200).trim()||(reason==="loss"?"Silinmə (yararsız / itki)":"Daxili istifadə"),per:"",method:"Anbardan",doc:saStr(p.doc,80),note:nm.join("; ").slice(0,500),
        src:"stock",moveIds:made.map(function(m){return m.id}),created:now,author:u.name,updatedAt:now,by:u.name};
      made.forEach(function(m){m.expId=xp.id});db.expenses.push(xp);ch.expenses.push(xp)}
    if(qq&&kind==="out"){var r2=saRemaining(db,qq),left=0;Object.keys(r2).forEach(function(id){left+=r2[id].left});
      if(left<=1e-9){qq.status="done";qq.updatedAt=now;qq.by=u.name;qq.hist=(qq.hist||[]).slice(-39);qq.hist.push({at:now,by:u.name,st:"done"});ch.quotes.push(qq)}}
    return {res:{moves:made.map(function(m){return saPubMove(m,role)}),stock:saStock(db)},ch:ch}}

  case "setCost":{need(SA_CAN.seeCost(role));var mv=null;db.moves.forEach(function(m){if(m.id===p.id&&!m.del)mv=m});if(!mv)saErr("notfound");
    if(mv.kind!=="in")saErr("kind");mv.cost=Math.max(0,saR2(saNum(p.cost)));ch.moves.push(mv);
    var latest=db.moves.filter(function(m){return !m.del&&m.kind==="in"&&m.itemId===mv.itemId&&saNum(m.cost)>0}).sort(function(a,b){return String(b.date).localeCompare(String(a.date))||(b.at-a.at)})[0];
    var itc=itemById(mv.itemId);if(itc&&latest&&latest.id===mv.id){itc.cost=mv.cost;itc.updatedAt=now;itc.by=u.name;ch.items.push(itc)}
    return {res:{move:mv},ch:ch}}

  case "delMove":{need(SA_CAN.admin(role));var dm=null;db.moves.forEach(function(m){if(m.id===p.id&&!m.del)dm=m});if(!dm)saErr("notfound");
    var st3=saStock(db);if(dm.kind!=="out"&&st3[dm.itemId]&&st3[dm.itemId].q-saNum(dm.qty)<-1e-9)saErr("nostock",{name:dm.name,have:st3[dm.itemId].q});
    dm.del=true;ch.moves.push(dm);
    if(dm.expId)db.expenses.forEach(function(x){if(x.id!==dm.expId||x.del)return;var lm=db.moves.filter(function(m){return m.expId===x.id&&!m.del});
      if(!lm.length)x.del=true;else x.amount=saR2(lm.reduce(function(a,m){return a+Math.abs(saNum(m.qty))*saNum(m.cost)},0));x.updatedAt=now;x.by=u.name;ch.expenses.push(x)});
    if(dm.kind==="out"&&dm.quoteId){var dq2=quoteById(dm.quoteId);if(dq2&&dq2.status==="done"){dq2.status="accepted";dq2.updatedAt=now;dq2.by=u.name;ch.quotes.push(dq2)}}
    return {res:{stock:saStock(db)},ch:ch}}

  /* ---------- supplier invoices (qaimə): mühasib enters & approves → anbardar checks & receives ---------- */
  case "saveInvoice":{
    need(SA_CAN.invoice(role));var a=p.invoice||{},ex=a.id?invById(a.id):null,dir=a.dir==="out"||(ex&&ex.dir==="out")?"out":"";
    if(ex&&(ex.status==="received"||(dir==="out"&&ex.status!=="draft")))saErr("locked");
    var no=saStr(a.no,60).trim();if(!no)saErr("invno");var sup=saStr(a.supplier,200).trim();if(!sup)saErr("supplier");
    var voen=saStr(a.voen,20).replace(/\D/g,"");
    db.invoices.forEach(function(o){if(!o.del&&(!ex||o.id!==ex.id)&&(o.dir||"")===dir&&o.no.toLowerCase()===no.toLowerCase()&&(dir==="out"||(voen&&o.voen===voen)||saNormName(o.supplier)===saNormName(sup)))saErr("dupinv",{no:no})});
    var v=ex||{id:(a.id&&/^[\w-]{4,60}$/.test(a.id))?a.id:saId("v"),status:"draft",created:now,author:u.name};
    v.no=no;v.supplier=sup;v.voen=voen;v.date=saStr(a.date,10);v.note=saStr(a.note,1000);if(a.pdfUrl)v.pdfUrl=saStr(a.pdfUrl,500);
    if(a.imp&&typeof a.imp==="object")v.imp={cur:saStr(a.imp.cur,6),rate:Math.max(0,saNum(a.imp.rate)),gb:saStr(a.imp.gb,60),
      costs:(Array.isArray(a.imp.costs)?a.imp.costs:[]).slice(0,20).map(function(c){var o={name:saStr(c&&c.name,80),amt:Math.max(0,saR2(saNum(c&&c.amt)))};if(c&&c.fx)o.fx=1;return o}).filter(function(c){return c.name||c.amt})};else delete v.imp;
    if(dir==="out"){v.dir="out";v.con=a.con&&typeof a.con==="object"?{no:saStr(a.con.no,60),date:saStr(a.con.date,10),kind:a.con.kind==="svc"?"svc":a.con.kind==="sale"?"sale":""}:null;v.per=saStr(a.per,120);v.basis=saStr(a.basis,600)}
    v.lines=[];if(dir==="out"){(a.lines||[]).slice(0,500).forEach(function(l){var it=l.itemId?itemById(l.itemId):null;
        v.lines.push({id:saStr(l.id||saId("l"),40),itemId:it?it.id:"",code:it?it.code:saStr(l.srcCode,60),name:it?it.name:saStr(l.srcName||l.name,300),srcName:saStr(l.srcName,300),srcCode:saStr(l.srcCode,60),unit:saStr(l.unit||(it&&it.unit)||"ədəd",20),
          qty:Math.max(0,saR2(saNum(l.qty))),price:Math.max(0,saR2(saNum(l.price))),vat:Math.max(0,saR2(saNum(l.vat))),t:it&&!it.svc&&l.t!=="xid"?"mal":"xid"})})}
    else (a.lines||[]).slice(0,500).forEach(function(l){var it=itemById(l.itemId);if(!it)saErr("invitem",{name:saStr(l.srcName||l.name,120)});
      v.lines.push({id:saStr(l.id||saId("l"),40),itemId:it.id,code:it.code,name:it.name,srcName:saStr(l.srcName,300),srcCode:saStr(l.srcCode,60),unit:saStr(l.unit||it.unit,20),
        qty:Math.max(0,saR2(saNum(l.qty))),price:Math.max(0,saR2(saNum(l.price))),vat:Math.max(0,saR2(saNum(l.vat))),recv:null});if(v.imp)v.lines[v.lines.length-1].fprice=Math.max(0,saNum(l.fprice))});
    if(!v.lines.length)saErr("empty");
    if(ex&&ex.status==="approved"&&!p.keepStatus)v.status="draft";
    v.updatedAt=now;v.by=u.name;if(!ex)db.invoices.push(v);ch.invoices.push(v);return {res:{invoice:saPubInv(v,role)},ch:ch}}

  /* sales invoice → the sale it bills (found or made from the invoice), its goods leave the warehouse if not issued yet, the contract is taken from the invoice */
  case "postSaleInvoice":{need(SA_CAN.invoice(role));var sv=invById(p.id);if(!sv||sv.dir!=="out")saErr("notfound");if(sv.status!=="draft")return {res:{invoice:sv,dup:true},ch:ch};
    var items0={};db.items.forEach(function(i){items0[i.id]=i});
    var conFor=function(kind){var cn=sv.con&&sv.con.no?saNormName(sv.con.no):"",best=null;db.contracts.forEach(function(c){if(c.del)return;if((c.kind==="sale"?"sale":"svc")!==kind)return;
      var nm=saNameHit(c.client,sv.supplier,true)||(sv.voen&&c.voen===sv.voen)||String(c.aliases||"").split(/[,;\n]/).some(function(x){return saNameHit(x,sv.supplier,true)});
      if(cn&&saNormName(c.no)===cn&&(nm||!sv.supplier))best=c;else if(!best&&!cn&&nm&&c.active!==false)best=c});return best};
    var allX=sv.lines.every(function(l){return l.t!=="mal"}),svcLike=sv.lines.some(function(l){return /(aylıq|rüblük|rubluk|yarımillik|illik)\s+texniki\s+xidm/i.test(l.name||"")});
    var ck=p.conKind==="svc"||p.conKind==="sale"?p.conKind:(svcLike?"svc":(sv.con&&sv.con.kind)||"sale"),con=conFor(ck),madeCon=null;
    /* contract from the invoice: number, date, client and (service) the device list with prices */
    if(p.mkCon&&sv.con&&sv.con.no&&(!con||(ck==="svc"&&!(con.plist||[]).length))){var perK=/aylıq/i.test(sv.lines.map(function(l){return l.name}).join(" "))?"m":/yarımillik/i.test(sv.lines.map(function(l){return l.name}).join(" "))?"h":/illik/i.test(sv.lines.map(function(l){return l.name}).join(" "))&&!/rüblük/i.test(sv.lines.map(function(l){return l.name}).join(" "))?"y":"q";
      var dn=function(nm){return String(nm||"").replace(/\s+(UPS\s+)?(cihazına|cihazina|requlatora|regulyatora|stabilizatora|generatora|qurğusuna|avadanlığına)?\s*(aylıq|rüblük|yarımillik|illik)?\s*texniki\s+xidmət.*$/i,"").trim()||nm};
      var base=con?JSON.parse(JSON.stringify(con)):{kind:ck,no:sv.con.no,client:sv.supplier,voen:sv.voen,period:perK,start:sv.con.date||sv.date,end:saAddMonths(sv.con.date||sv.date,12),price:0,active:true,note:"Qaimə "+sv.no+" əsasında"};
      if(ck==="svc")base.plist=sv.lines.map(function(l){return {site:"",name:dn(l.name),sn:"",price:saNum(l.price),n:Math.max(1,Math.round(saNum(l.qty)))}});
      else base.devices=base.devices||sv.lines.map(function(l){return l.name}).join("; ").slice(0,900);
      var oc=saHandle(db,{name:u.name,role:"admin"},"saveContract",{contract:base});oc.ch.contracts.forEach(function(x){ch.contracts.push(x)});oc.ch.quotes.forEach(function(x){ch.quotes.push(x)});madeCon=oc.res.contract;if(!con)con=madeCon}
    var q=p.quoteId&&p.quoteId!=="new"?quoteById(p.quoteId):null;
    if(!q){var ql=sv.lines.map(function(l){return {id:saId("l"),itemId:l.t==="mal"?l.itemId:"",code:l.code||"",name:l.name,desc:"",unit:l.unit,qty:l.qty,price:l.price,disc:0,t:l.t}});
      var oq=saHandle(db,{name:u.name,role:"admin"},"saveQuote",{quote:{date:sv.date||new Date(now).toISOString().slice(0,10),status:"accepted",kind:allX?"svc":"sale",subj:"Qaimə "+sv.no+(sv.per?" · "+sv.per:""),
        cl:{name:sv.supplier,voen:sv.voen},vat:true,per:sv.per||"",conId:con?con.id:"",terms:{pay:S.pay,delivery:"",warranty:"",note:sv.basis?"Əsas: "+sv.basis:""},lines:ql}});
      oq.ch.quotes.forEach(function(x){ch.quotes.push(x)});if(oq.ch.settings){ch.settings=ch.settings||{};for(var k0 in oq.ch.settings)ch.settings[k0]=oq.ch.settings[k0]}
      q=quoteById(oq.res.quote.id);q.fromInv=sv.id}
    /* a service contract billed by this invoice: the visit counts for the next-service date */
    if(con&&con.kind!=="sale"&&allX&&String(sv.date||"")>String(con.lastSvc||"")){con.lastSvc=sv.date;con.updatedAt=now;ch.contracts.push(con)}
    q.bill={st:"inv",doc:sv.no,by:u.name,at:now,inv:sv.id};q.hist=(q.hist||[]).slice(-39);q.hist.push({at:now,by:u.name,bill:"inv",doc:sv.no});
    /* what still has to leave the warehouse: invoice quantity minus what was already issued for this sale */
    var iss=saIssued(db),left={},toShip=0;sv.lines.forEach(function(l){l.ship=0;var it=items0[l.itemId];if(l.t!=="mal"||!it||it.svc)return;var k=q.id+"|"+it.id;if(left[k]===undefined)left[k]=saNum(iss[k]);
      var take=Math.min(left[k],saNum(l.qty));left[k]-=take;l.ship=saR2(saNum(l.qty)-take);toShip+=l.ship});
    sv.quoteId=q.id;sv.quoteNo=q.no;sv.approvedBy=u.name;sv.approvedAt=now;sv.status=toShip>1e-9?"approved":"received";if(madeCon)sv.conId=madeCon.id;else if(con)sv.conId=con.id;
    if(toShip<=1e-9&&q.status==="accepted"){var rr=saRemaining(db,q),lf=0;Object.keys(rr).forEach(function(id){lf+=rr[id].left});if(lf<=1e-9){q.status="done";q.hist.push({at:now,by:u.name,st:"done"})}}
    q.updatedAt=now;q.by=u.name;sv.updatedAt=now;sv.by=u.name;ch.quotes.push(q);ch.invoices.push(sv);
    return {res:{invoice:sv,quote:saPubQuote(q,role),summary:saSummary(q),contract:madeCon,stock:saStock(db)},ch:ch}}
  /* the warehouse hands over the goods of a sales invoice */
  case "shipInvoice":{need(SA_CAN.moveStock(role));var shv=invById(p.id);if(!shv||shv.dir!=="out")saErr("notfound");if(shv.status==="received")return {res:{dup:true,stock:saStock(db)},ch:ch};if(shv.status!=="approved")saErr("notapproved");
    var sq=shv.quoteId?quoteById(shv.quoteId):null,give={},st4=saStock(db),need4={},op4=/^[\w-]{4,60}$/.test(String(p.opId||""))?String(p.opId):saId("o"),k4=0,d4=saStr(p.date,10)||new Date(now).toISOString().slice(0,10);
    (p.lines||[]).forEach(function(l){give[l.id]=Math.max(0,saR2(saNum(l.qty)))});
    shv.lines.forEach(function(l){if(!saNum(l.ship))return;var q4=give[l.id]!==undefined?Math.min(give[l.id],saNum(l.ship)):saNum(l.ship);l.give=q4;need4[l.itemId]=(need4[l.itemId]||0)+q4});
    Object.keys(need4).forEach(function(id){var it=itemById(id);if(!it)saErr("notfound");if(need4[id]>st4[id].q+1e-9)saErr("nostock",{name:it.name,have:st4[id].q})});
    shv.lines.forEach(function(l){var q4=saNum(l.give);delete l.give;if(!q4)return;var it=itemById(l.itemId);
      var m={id:op4+"_"+(k4++),date:d4,kind:"out",itemId:it.id,code:it.code,name:it.name,qty:q4,cost:saNum(it.cost),doc:shv.no,party:shv.supplier,quoteId:sq?sq.id:"",quoteNo:sq?sq.no:"",invoiceId:shv.id,note:"Satış qaiməsi "+shv.no,by:u.name,at:now};
      l.shipped=q4;db.moves.push(m);ch.moves.push(m)});
    shv.status="received";shv.receivedBy=u.name;shv.receivedAt=now;shv.updatedAt=now;shv.by=u.name;ch.invoices.push(shv);
    if(sq&&sq.status==="accepted"){var r5=saRemaining(db,sq),l5=0;Object.keys(r5).forEach(function(id){l5+=r5[id].left});if(l5<=1e-9){sq.status="done";sq.hist=(sq.hist||[]).slice(-39);sq.hist.push({at:now,by:u.name,st:"done"});sq.updatedAt=now;ch.quotes.push(sq)}}
    return {res:{invoice:saPubInv(shv,role),stock:saStock(db)},ch:ch}}
  /* goods that were not in stock went from the supplier straight to the client: receipt + issue together (stock unchanged, cost recorded) */
  case "directSupply":{need(SA_CAN.moveStock(role));var dq3=quoteById(p.quoteId);if(!dq3)saErr("notfound");var rm3=saRemaining(db,dq3),op5=/^[\w-]{4,60}$/.test(String(p.opId||""))?String(p.opId):saId("o");
    if(op5&&db.moves.some(function(m){return m.id===op5+"_i0"}))return {res:{dup:true,stock:saStock(db)},ch:ch};
    var d5=saStr(p.date,10)||new Date(now).toISOString().slice(0,10),k5=0,sup5=saStr(p.supplier,200).trim(),doc5=saStr(p.doc,80);
    (p.lines||[]).forEach(function(l){var it=itemById(l.itemId),q5=saR2(saNum(l.qty));if(!it||it.svc||q5<=0)return;if(!rm3[it.id]||q5>rm3[it.id].left+1e-9)saErr("overquote",{name:it.name,left:rm3[it.id]?rm3[it.id].left:0});
      var c5=SA_CAN.seeCost(role)&&saNum(l.cost)>0?saR2(saNum(l.cost)):saNum(it.cost),k=k5++;
      var mi={id:op5+"_i"+k,date:d5,kind:"in",itemId:it.id,code:it.code,name:it.name,qty:q5,cost:SA_CAN.seeCost(role)?c5:0,doc:doc5,party:sup5,quoteId:"",quoteNo:"",note:"Birbaşa təchizatçıdan müştəriyə ("+dq3.no+")",by:u.name,at:now,direct:1};
      var mo={id:op5+"_o"+k,date:d5,kind:"out",itemId:it.id,code:it.code,name:it.name,qty:q5,cost:c5,doc:doc5,party:(dq3.cl&&dq3.cl.name)||"",quoteId:dq3.id,quoteNo:dq3.no,note:"Birbaşa təchizatçıdan ("+(sup5||"—")+")",by:u.name,at:now+1,direct:1};
      if(SA_CAN.seeCost(role)&&saNum(l.cost)>0){it.cost=c5;it.updatedAt=now;it.by=u.name;ch.items.push(it)}
      db.moves.push(mi,mo);ch.moves.push(mi,mo)});
    var r6=saRemaining(db,dq3),l6=0;Object.keys(r6).forEach(function(id){l6+=r6[id].left});if(l6<=1e-9&&dq3.status==="accepted"){dq3.status="done";dq3.hist=(dq3.hist||[]).slice(-39);dq3.hist.push({at:now,by:u.name,st:"done"});dq3.updatedAt=now;ch.quotes.push(dq3)}
    return {res:{stock:saStock(db),remaining:r6},ch:ch}}
  /* everything sold to one client: sales with their lines, sales invoices, contracts */
  case "custHist":{need(SA_CAN.quote(role)||SA_CAN.seeContracts(role)||SA_CAN.invoice(role));var cn2=saStr(p.name,200),cv=saStr(p.voen,20).replace(/\D/g,"");
    var mine=function(name,voen){return (cv&&voen&&String(voen)===cv)||saNameHit(name,cn2)};
    var cons=db.contracts.filter(function(c){return !c.del&&(mine(c.client,c.voen)||String(c.aliases||"").split(/[,;\n]/).some(function(x){return saNameHit(x,cn2)}))});
    var qs=db.quotes.filter(function(q){return !q.del&&(q.status==="accepted"||q.status==="done")&&q.cl&&(mine(q.cl.name,q.cl.voen)||cons.some(function(c){return q.src&&q.src.contractId===c.id||q.conId===c.id}))}).slice(-400).map(function(q){return saPubQuote(q,role)});
    var ivs=db.invoices.filter(function(v){return !v.del&&v.dir==="out"&&mine(v.supplier,v.voen)}).map(function(v){return saPubInv(v,role)});
    return {res:{quotes:qs,invoices:ivs,contracts:cons},ch:ch}}
  case "approveInvoice":{need(SA_CAN.invoice(role));var av=invById(p.id);if(!av)saErr("notfound");if(av.dir==="out")saErr("kind");if(av.status!=="draft")return {res:{invoice:saPubInv(av,role),dup:true},ch:ch};
    av.status="approved";av.approvedBy=u.name;av.approvedAt=now;av.returnNote="";av.updatedAt=now;av.by=u.name;
    av.lines.forEach(function(l){var it=itemById(l.itemId);if(!it)return;var changed=false;
      if(p.updateCost!==false&&saNum(l.price)>0&&saNum(it.cost)!==saNum(l.price)){it.cost=saNum(l.price);changed=true}
      var al=(it.alias?String(it.alias).split("|"):[]),nn=saNormName(l.srcName);if(nn&&nn!==saNormName(it.name)&&al.indexOf(nn)<0){al.push(nn);it.alias=al.slice(-20).join("|");changed=true}
      if(changed){it.updatedAt=now;it.by=u.name;ch.items.push(it)}});
    ch.invoices.push(av);return {res:{invoice:saPubInv(av,role)},ch:ch}}

  case "returnInvoice":{need(SA_CAN.receive(role)||SA_CAN.invoice(role));var rv=invById(p.id);if(!rv)saErr("notfound");if(rv.status!=="approved"||rv.dir==="out")saErr("locked");
    rv.status="draft";rv.returnNote=saStr(p.note,500);rv.returnedBy=u.name;rv.updatedAt=now;rv.by=u.name;ch.invoices.push(rv);return {res:{invoice:saPubInv(rv,role)},ch:ch}}

  case "receiveInvoice":{need(SA_CAN.receive(role));var iv=invById(p.id);if(!iv||iv.dir==="out")saErr("notfound");
    if(iv.status==="received")return {res:{dup:true,stock:saStock(db)},ch:ch};if(iv.status!=="approved")saErr("notapproved");
    var opId2=/^[\w-]{4,60}$/.test(String(p.opId||""))?String(p.opId):saId("o"),recv={};(p.lines||[]).forEach(function(l){recv[l.id]=Math.max(0,saR2(saNum(l.recv)))});
    var date2=saStr(p.date,10)||new Date(now).toISOString().slice(0,10),k2=0,diff=0;
    iv.lines.forEach(function(l){var it=itemById(l.itemId);var q=recv[l.id]!==undefined?recv[l.id]:saNum(l.qty);l.recv=q;if(Math.abs(q-saNum(l.qty))>1e-9)diff++;
      if(!it||it.svc||q<=0)return;
      var m={id:opId2+"_"+(k2++),date:date2,kind:"in",itemId:it.id,code:it.code,name:it.name,qty:q,cost:saNum(l.price),doc:iv.no,party:iv.supplier,quoteId:"",quoteNo:"",invoiceId:iv.id,
        note:saStr(p.note,300)||("Qaimə "+iv.no),by:u.name,at:now};db.moves.push(m);ch.moves.push(m)});
    iv.status="received";iv.receivedBy=u.name;iv.receivedAt=now;iv.recvNote=saStr(p.note,500);iv.diff=diff;iv.updatedAt=now;iv.by=u.name;ch.invoices.push(iv);
    return {res:{invoice:saPubInv(iv,role),stock:saStock(db)},ch:ch}}

  /* ZUVAND Servis: an invoice approved or received by mistake goes back to draft for correction; its stock receipts are cancelled (kept in history as deleted) */
  case "reopenInvoice":{need(SA_CAN.invoice(role)||SA_CAN.admin(role));var ov=invById(p.id);if(!ov||ov.del)saErr("notfound");if(ov.dir==="out")saErr("locked");if(ov.status==="draft")return {res:{invoice:saPubInv(ov,role),dup:true},ch:ch};
    var cancelled=0;if(ov.status==="received")db.moves.forEach(function(m){if(m.invoiceId===ov.id&&!m.del){m.del=true;m.delBy=u.name;m.delAt=now;m.note=(m.note?m.note+" · ":"")+"qaimə düzəliş üçün açıldı";ch.moves.push(m);cancelled++}});
    ov.lines.forEach(function(l){l.recv=null});ov.status="draft";ov.reopenedBy=u.name;ov.reopenedAt=now;ov.reopenNote=saStr(p.note,500);ov.diff=0;ov.updatedAt=now;ov.by=u.name;ch.invoices.push(ov);
    return {res:{invoice:saPubInv(ov,role),cancelled:cancelled,stock:saStock(db)},ch:ch}}

  /* an invoice already received / posted: the manager deletes it with the deletion password; its stock moves are cancelled and the linked sale is put back */
  case "delInvoice":{need(SA_CAN.invoice(role)||SA_CAN.admin(role));var dv=invById(p.id);if(!dv)saErr("notfound");
    var posted=dv.status==="received"||(dv.dir==="out"&&dv.status!=="draft");
    if(posted){need(SA_CAN.admin(role));if(!db.settings.delPw)saErr("nopw");if(String(p.pwh||"")!==String(db.settings.delPw))saErr("badpw");
      db.moves.forEach(function(m){if(m.invoiceId===dv.id&&!m.del){m.del=true;m.delBy=u.name;m.delAt=now;m.note=(m.note?m.note+" · ":"")+"qaimə silindi";ch.moves.push(m)}});
      if(dv.dir==="out"&&dv.quoteId){var lq=quoteById(dv.quoteId);if(lq){lq.hist=(lq.hist||[]).slice(-39);
        if(lq.fromInv===dv.id){lq.del=true;lq.delAt=now;lq.delBy=u.name;lq.hist.push({at:now,by:u.name,st:"deleted"})}
        else{if(lq.bill&&lq.bill.inv===dv.id){delete lq.bill;lq.hist.push({at:now,by:u.name,bill:"undo"})}
          if(lq.status==="done"){var r7=saRemaining(db,lq),l7=0;Object.keys(r7).forEach(function(id){l7+=r7[id].left});if(l7>1e-9){lq.status="accepted";lq.hist.push({at:now,by:u.name,st:"accepted"})}}}
        lq.updatedAt=now;lq.by=u.name;ch.quotes.push(lq)}}}
    dv.del=true;dv.updatedAt=now;dv.by=u.name;ch.invoices.push(dv);return {res:{},ch:ch}}

  case "setInvoicePdf":{need(SA_CAN.invoice(role));var pv=invById(p.id);if(!pv)saErr("notfound");pv.pdfUrl=saStr(p.url,500);pv.updatedAt=now;ch.invoices.push(pv);return {res:{},ch:ch}}

  /* ---------- service contracts & service reports ---------- */
  case "saveContract":{need(SA_CAN.contract(role));var a=p.contract||{},ex=null;db.contracts.forEach(function(c){if(c.id===a.id&&!c.del)ex=c});
    var client=saStr(a.client,200).trim();if(!client)saErr("client");var per=SA_PERIOD[a.period]?a.period:"q";
    var old0=ex?JSON.parse(JSON.stringify(ex)):null;
    var c=ex||{id:(a.id&&/^[\w-]{4,60}$/.test(a.id))?a.id:saId("c"),created:now,author:u.name};
    /* two kinds: "svc" — service contract (service visits are billed from it), "sale" — sales contract (alqı-satqı: goods / parts sold) */
    c.kind=a.kind==="sale"||a.kind==="svc"?a.kind:(ex&&ex.kind)||"svc";
    c.no=saStr(a.no,60);c.client=client;c.voen=saStr(a.voen,20).replace(/\D/g,"");c.aliases=saStr(a.aliases,500);c.period=per;
    c.start=saStr(a.start,10);c.end=saStr(a.end,10);c.price=Math.max(0,saR2(saNum(a.price)));c.devices=saStr(a.devices,1000);c.note=saStr(a.note,1000);
    c.sites=saStr(a.sites,2000);
    c.sitePer={};var sp0=(a.sitePer&&typeof a.sitePer==="object")?a.sitePer:{};for(var sk in sp0){var skk=saNormName(sk);if(skk&&SA_PERIOD[sp0[sk]])c.sitePer[skk]=sp0[sk]}c.lastSvc=/^\d{4}-\d{2}-\d{2}$/.test(String(a.lastSvc||""))?String(a.lastSvc):"";
    /* price list per device: [{site,name,sn,price}] — one service visit is billed device by device */
    c.plist=(Array.isArray(a.plist)?a.plist:[]).slice(0,400).map(function(x){var o={site:saStr(x&&x.site,200).trim(),name:saStr(x&&x.name,200).trim(),sn:saStr(x&&x.sn,80).trim(),price:Math.max(0,saR2(saNum(x&&x.price)))},n=Math.round(saNum(x&&x.n));if(n>1)o.n=n;return o}).filter(function(x){return x.name||x.sn});c.person=saStr(a.person,120);c.tel=saStr(a.tel,60);c.addr=saStr(a.addr,300);c.active=a.active!==false;c.updatedAt=now;c.by=u.name;
    /* change history: period, dates, number, prices, device list */
    var tot=function(x){return (x.plist||[]).reduce(function(a,r){return a+saNum(r.price)*saRowCap(r)},0)},chg=[];
    if(ex&&old0){if(old0.period!==c.period)chg.push("dövr: "+SA_PERIOD[old0.period][0]+" → "+SA_PERIOD[c.period][0]);
      if(JSON.stringify(old0.sitePer||{})!==JSON.stringify(c.sitePer||{}))chg.push("obyektlərin dövrü: "+(Object.keys(c.sitePer).map(function(k){return k+" — "+SA_PERIOD[c.sitePer[k]][0].toLowerCase()}).join(", ")||"hamısı müqavilənin dövrü ilə"));
      if(old0.no!==c.no)chg.push("№: "+(old0.no||"—")+" → "+(c.no||"—"));if(old0.start!==c.start||old0.end!==c.end)chg.push("müddət: "+(c.start||"")+" – "+(c.end||""));
      if(String(old0.lastSvc||"")!==c.lastSvc)chg.push("son servis tarixi: "+(c.lastSvc||"—"));
      if(saNum(old0.price)!==saNum(c.price))chg.push("səfər qiyməti: "+saNum(old0.price)+" → "+saNum(c.price));
      var cnt=function(x){return (x.plist||[]).reduce(function(a,r){return a+saRowCap(r)},0)},on=cnt(old0),nn=cnt(c);if(on!==nn)chg.push("cihaz sayı: "+on+" → "+nn);
      if(saR2(tot(old0))!==saR2(tot(c)))chg.push("cihaz qiymətləri cəmi: "+saR2(tot(old0))+" → "+saR2(tot(c)))}
    c.hist=(old0&&old0.hist||[]).slice(-49);c.hist.push({at:now,by:u.name,what:ex?(chg.join("; ")||"məlumat yeniləndi"):"müqavilə yaradıldı"});
    while(JSON.stringify(c).length>45000&&c.hist.length>1)c.hist.shift();if(JSON.stringify(c).length>45000)saErr("toolarge");
    if(!ex)db.contracts.push(c);ch.contracts.push(c);
    /* sales waiting for this contract (approved planned service, no contract at the time) are priced from it now */
    var applied=[];db.quotes.forEach(function(q){if(q.del||!q.src||!q.src.nocon||q.status!=="draft")return;var cn=saContractFor(db,q.cl.name,q.src.date)||saContractFor(db,q.src.site||q.cl.name,q.src.date);if(!cn||cn.id!==c.id)return;
      var o=saHandle(db,u,"applyContract",{id:q.id,contractId:c.id});o.ch.quotes.forEach(function(x){ch.quotes.push(x)});applied.push(q.no)});
    return {res:{contract:c,applied:applied},ch:ch}}
  /* the accountant picked the contract row for a device that was not found: the price is taken from it and the device's serial is remembered on the row */
  case "conLearn":{need(SA_CAN.contract(role)||SA_CAN.setPrice(role));var lc=null;db.contracts.forEach(function(x){if(x.id===p.id&&!x.del)lc=x});if(!lc)saErr("notfound");
    var row=(lc.plist||[])[Math.round(saNum(p.k))];if(!row)saErr("notfound");var fk=saFakeSn(lc.plist),sn0=String(row.sn||"").toLowerCase().replace(/\s+/g,""),nsn=saStr(p.sn,80).trim();
    if(nsn&&saRowCap(row)===1&&(!sn0||fk[sn0])){row.sn=nsn;lc.hist=(lc.hist||[]).slice(-49);lc.hist.push({at:now,by:u.name,what:"cihaz öyrənildi: "+row.name+" → SN "+nsn});lc.updatedAt=now;lc.by=u.name;ch.contracts.push(lc)}
    return {res:{contract:lc},ch:ch}}
  /* the manager corrects a customer's name everywhere (sales, invoices, contracts, warehouse moves); the old spelling stays as an alias of the contract */
  case "renameClient":{need(SA_CAN.admin(role));var rf=saStr(p.from,200).trim(),rt=saStr(p.to,200).trim(),rdry=!!p.dry;if(!rf||!rt)saErr("bad_name");
    var core=function(x){return saNormName(x).replace(/\b(mmc|asc|qsc|ojsc|llc|ltd|mehdud mesuliyyetli cemiyyeti|aciq sehmdar cemiyyeti|qapali sehmdar cemiyyeti)\b/g," ").replace(/\s+/g," ").trim()},nf=core(rf);if(!nf)saErr("bad_name");
    var hit=function(x){return !!String(x||"").trim()&&core(x)===nf&&String(x).trim()!==rt},cnt={quotes:0,invoices:0,contracts:0,moves:0},names={},seen=function(x){names[String(x).trim()]=(names[String(x).trim()]||0)+1};
    db.quotes.forEach(function(q){var c=0;if(q.cl&&hit(q.cl.name)){c=1;seen(q.cl.name);if(!rdry)q.cl.name=rt}if(q.src&&hit(q.src.site)){c=1;if(!rdry)q.src.site=rt}
      if(c){cnt.quotes++;if(!rdry){q.updatedAt=now;q.by=u.name;q.hist=(q.hist||[]).slice(-39);q.hist.push({at:now,by:u.name,st:"renamed",what:"müştəri adı: "+rt});ch.quotes.push(q)}}});
    db.invoices.forEach(function(v){if(hit(v.supplier)){cnt.invoices++;seen(v.supplier);if(!rdry){v.supplier=rt;v.updatedAt=now;v.by=u.name;ch.invoices.push(v)}}});
    db.contracts.forEach(function(c){var k=0;if(hit(c.client)){k=1;seen(c.client);if(!rdry){var al=String(c.aliases||"").split(/[,;\n]/).map(function(x){return x.trim()}).filter(Boolean);
        if(!al.some(function(x){return x===c.client}))al.push(c.client);c.client=rt;c.aliases=al.join(", ")}}
      var st=String(c.sites||"").split("\n");if(st.some(hit)){k=1;if(!rdry)c.sites=st.map(function(x){return hit(x)?rt:x}).join("\n")}
      if(k){cnt.contracts++;if(!rdry){c.updatedAt=now;c.by=u.name;c.hist=(c.hist||[]).slice(-49);c.hist.push({at:now,by:u.name,what:"müştəri adı dəyişdirildi: "+rt});ch.contracts.push(c)}}});
    db.moves.forEach(function(m){if(hit(m.party)){cnt.moves++;seen(m.party);if(!rdry){m.party=rt;ch.moves.push(m)}}});
    return {res:{counts:cnt,names:names,dry:rdry},ch:ch}}
  case "mergeSvc":{need(SA_CAN.quote(role)||SA_CAN.contract(role));var ms=quoteById(p.id),mt=quoteById(p.target);
    if(!ms||ms.del||!ms.src||ms.src.type!=="service"||!mt||mt.del||mt.id===ms.id)saErr("notfound");
    if((ms.bill&&ms.bill.st)||ms.billedIn||mt.status==="rejected"||(mt.bill&&mt.bill.st==="paid")||mt.billedIn)saErr("locked");
    var mrep=String(ms.src.repno||""),mtag="Servis hesabatı № "+(mrep||"—")+(ms.src.date?", "+String(ms.src.date).split("-").reverse().join("."):"")+(ms.src.stype?" ("+ms.src.stype+")":"");
    var ml=(ms.lines||[]).map(function(l){var c=JSON.parse(JSON.stringify(l));c.id=saId("l");delete c.crow;if(!mrep||String(c.desc||"").indexOf(mrep)<0)c.desc=[c.desc,mtag].filter(function(x){return String(x||"").trim()}).join("\n");return c});
    if(!ml.length)ml.push({id:saId("l"),itemId:"",svc:1,name:"Servis işi"+(ms.src.stype?" — "+ms.src.stype:""),desc:mtag,unit:"xidmət",qty:1,price:0,disc:0});
    mt.lines=(mt.lines||[]).concat(ml);mt.svcRefs=(mt.svcRefs||[]).concat([{repno:mrep,reportId:ms.src.reportId||"",date:ms.src.date||"",from:ms.no||"",at:now,by:u.name}]);
    mt.hist=(mt.hist||[]).slice(-39);mt.hist.push({at:now,by:u.name,st:"merged",what:"servis hesabatı birləşdirildi: "+(mrep||ms.no)});mt.updatedAt=now;mt.by=u.name;
    ms.del=true;ms.delAt=now;ms.delBy=u.name;ms.mergedInto=mt.id;ms.updatedAt=now;ms.by=u.name;
    ch.quotes.push(mt);ch.quotes.push(ms);return {res:{quote:mt,stock:saStock(db)},ch:ch}}
  case "applyContract":{need(SA_CAN.contract(role));var aq=quoteById(p.id);if(!aq||aq.del||!aq.src)saErr("notfound");if(aq.status!=="draft"&&aq.status!=="sent")saErr("locked");
    var acon=null;db.contracts.forEach(function(x){if(x.id===p.contractId&&!x.del)acon=x});if(!acon)acon=saContractFor(db,aq.cl.name,aq.src.date)||saContractFor(db,aq.src.site||aq.cl.name,aq.src.date);if(!acon)saErr("nocontract");
    var asite=aq.src.site||aq.cl.name,adevs=aq.src.devs&&aq.src.devs.length?aq.src.devs:[{type:"",info:{}}];
    var keep=(aq.lines||[]).filter(function(l){return l.svc===2||(!l.svc&&!(!l.itemId&&SA_SVCLINE.test(l.name||"")))});
    var first=(aq.lines||[])[0],ainfo=first?String(first.desc||"").replace(/\nMüqavilə yoxdur.*$/,""):"";
    aq.lines=saContractLines(acon,asite,adevs,ainfo).concat(keep);aq.status="accepted";aq.src.contractId=acon.id;delete aq.src.nocon;
    aq.cl={name:acon.client,voen:acon.voen||"",person:acon.person||aq.cl.person||"",tel:acon.tel||aq.cl.tel||"",email:aq.cl.email||"",addr:acon.addr||aq.cl.addr||""};
    aq.subj="Servis xidməti"+(aq.src.site?" — obyekt: "+aq.src.site:"")+" — hesabat № "+(aq.src.repno||"")+(acon.no?" · müqavilə № "+acon.no:"");aq.terms.pay="Xidməti müqaviləyə uyğun";
    aq.updatedAt=now;aq.by=u.name;ch.quotes.push(aq);return {res:{quote:aq,stock:saStock(db)},ch:ch}}
  case "saveExpense":{need(SA_CAN.expense(role));var xa=p.expense||{},xe=null;db.expenses.forEach(function(x){if(x.id===xa.id&&!x.del)xe=x});
    var amt=saR2(saNum(xa.amount));if(!(amt>0))saErr("amount");var xd=saStr(xa.date,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(xd))saErr("date");
    var x=xe||{id:(xa.id&&/^[\w-]{4,60}$/.test(xa.id))?xa.id:saId("x"),created:now,author:u.name};
    x.date=xd;x.cat=saStr(xa.cat,80).trim()||"Digər";x.amount=amt;x.payee=saStr(xa.payee,200).trim();x.per=saStr(xa.per,7);x.method=saStr(xa.method,30);x.doc=saStr(xa.doc,80);x.note=saStr(xa.note,500);
    x.updatedAt=now;x.by=u.name;if(!xe)db.expenses.push(x);ch.expenses.push(x);return {res:{expense:x},ch:ch}}
  case "delExpense":{need(SA_CAN.admin(role));var dx=null;db.expenses.forEach(function(x){if(x.id===p.id)dx=x});if(!dx)saErr("notfound");dx.del=true;dx.updatedAt=now;dx.by=u.name;ch.expenses.push(dx);return {res:{},ch:ch}}
  case "delContract":{need(SA_CAN.contract(role));var dc=null;db.contracts.forEach(function(c){if(c.id===p.id)dc=c});if(!dc)saErr("notfound");dc.del=true;dc.updatedAt=now;ch.contracts.push(dc);return {res:{},ch:ch}}

  /* service journal reports → a sale per visit (accepted, so its parts wait for the warehouse to issue them) */
  case "serviceImport":{need(SA_CAN.contract(role));var made2=[],skipped=0,nocon=0,exists={},bad=[],revoked=[],warned=[];
    /* the newest sale made from each report (a deleted one too: it is re-created only when the report is approved again) */
    db.quotes.forEach(function(q){if(q.src&&q.src.reportId){var e=exists[q.src.reportId];if(!e||(e.del&&!q.del)||saNum(q.created)>saNum(e.created))exists[q.src.reportId]=q}});
    var issued=saIssued(db),updated=[];
    var done=[],cur=null,push=function(qd,src){var old=cur,ex=old&&!old.del;
      if(ex){qd.id=old.id;qd.author=old.author;
        /* the accountant's work is kept: prices written for the same service line / item, lines added by hand,
           and subject, client and terms once someone other than the import has edited the sale */
        var key=function(l){return l.itemId||("n:"+saNormName(l.name))},op={};(old.lines||[]).forEach(function(l){op[key(l)]=l});
        var nk={};qd.lines.forEach(function(l){nk[key(l)]=1;var o=op[key(l)];if(o&&(saNum(o.price)||l.itemId)&&(!saNum(l.price)||l.itemId||qd.status==="draft")){l.price=o.price;l.disc=o.disc}});
        (old.lines||[]).forEach(function(l){if(!l.svc&&!nk[key(l)])qd.lines.push(l)});
        if(old.by&&old.by!==u.name){qd.subj=old.subj;qd.cl=old.cl;qd.terms=old.terms;qd.valid=old.valid}
        if(qd.status==="draft"&&(old.status==="sent"||old.status==="accepted"))qd.status=old.status}
      var out=saHandle(db,u,"saveQuote",{quote:qd});var nq=out.res.quote;nq.src=src;if(!ex)nq.author="Servis (avtomatik)";
      out.ch.quotes.forEach(function(x){ch.quotes.push(x)});if(out.ch.settings){ch.settings=ch.settings||{};for(var k in out.ch.settings)ch.settings[k]=out.ch.settings[k]}
      (ex?updated:made2).push(nq.no)};
    (p.reports||[]).forEach(function(r){try{
      /* only reports approved by the manager / service head become sales */
      if(!r||!r.id||!r.svc||!r.cl){skipped++;return}
      /* the manager took the approval back: the sale goes too; if it is already invoiced / paid / issued it stays, with a warning */
      if(!(r.appr&&saNum(r.appr.at))){var rq=exists[r.id];
        if(rq&&!rq.del&&rq.src&&saNum(rq.src.apprAt)&&!rq.src.rev){
          var billed=rq.status==="done"||!!(rq.bill&&(rq.bill.st||rq.bill.inv))||(db.invoices||[]).some(function(v){return !v.del&&v.quoteId===rq.id})||Object.keys(issued).some(function(k){return k.indexOf(rq.id+"|")===0});
          var rs={};for(var k5 in rq.src)rs[k5]=rq.src[k5];rs.rev={at:saNum(r.updatedAt)||now,billed:billed?1:0};rq.src=rs;rq.updatedAt=now;rq.hist=(rq.hist||[]).slice(-39);
          if(billed){rq.hist.push({at:now,by:"Servis Jurnalı",st:"rev-warn"});warned.push(rq.no)}
          else{rq.del=true;rq.delAt=now;rq.delBy="Servis Jurnalı — təsdiq geri alındı";rs.revDel=1;rq.hist.push({at:now,by:"Servis Jurnalı",st:"deleted"});revoked.push(rq.no)}
          ch.quotes.push(rq)}
        skipped++;done.push(r.id);return}
      cur=exists[r.id]||null;var apAt=saNum(r.appr.at),repAt=saNum(r.updatedAt);
      /* approved again: a sale removed because of the withdrawn approval comes back with the same number; a kept one loses its warning */
      if(cur&&cur.del&&cur.src&&cur.src.revDel&&apAt>saNum(cur.src.rev&&cur.src.rev.at)){cur.del=false;delete cur.delAt;delete cur.delBy;cur.hist=(cur.hist||[]).slice(-39);cur.hist.push({at:now,by:"Servis Jurnalı",st:"restored"})}
      if(cur&&!cur.del&&cur.src&&cur.src.rev){var rs2={};for(var k6 in cur.src)if(k6!=="rev"&&k6!=="revDel")rs2[k6]=cur.src[k6];cur.src=rs2;cur.updatedAt=now;ch.quotes.push(cur)}
      if(cur&&cur.mergedInto){skipped++;done.push(r.id);return}
      if(cur){var s0=cur.src||{};
        /* already made: deleted → only a new approval brings it back; otherwise follow later edits until the warehouse issued something */
        if(cur.del?!(apAt>saNum(cur.updatedAt)):(cur.status==="done"||cur.status==="rejected"||(saNum(s0.repAt)>=repAt&&saNum(s0.apprAt)===apAt)||Object.keys(issued).some(function(k){return k.indexOf(cur.id+"|")===0}))){skipped++;done.push(r.id);return}}
      var date=saStr(r.svc.date,10),apD=new Date(apAt).toISOString().slice(0,10);if(p.from&&apD<p.from){skipped++;done.push(r.id);return}
      var site=saStr(r.cl.name,200).trim(),payer=saStr(r.cl.payer,200).trim();if(payer&&saNameHit(payer,site))payer="";
      /* only a planned service is a contract visit; diagnostics, repairs, call-outs etc. come as a draft for the accountant to price */
      var stype=String(r.svc.type||"").trim(),planned=!stype||/planl|profilakt/i.test(stype);
      var con=payer?saContractFor(db,payer,date,site):saContractFor(db,site,date,saStr(r.cl.obj,120));
      /* who gets the bill: the contract holder, else the intermediary named in the report, else the client itself */
      var billTo=con?con.client:(payer||site);
      var via=!!payer||(!!con&&!saNameHit(con.client,site,true)&&!String(con.aliases||"").split(/[,;\n]/).some(function(x){return saNameHit(x,site,true)}));
      var cc=con||(payer?saContractFor(db,payer,"",site):null);
      var devs=(Array.isArray(r.devices)&&r.devices.length?r.devices:[r]).filter(function(d){return d&&typeof d==="object"}),dn=[];
      devs.forEach(function(d){var i=d.info||d.ups||{};var nm=[i.brand,i.model].filter(Boolean).join(" ");if(nm)dn.push(nm+(i.sn?" (SN "+i.sn+")":"")+(d.loc?" — "+d.loc:""))});
      var info=[via?"Obyekt: "+site+(r.cl.obj?", "+saStr(r.cl.obj,120):""):(r.cl.obj?"Obyekt: "+saStr(r.cl.obj,120):""),"Servis hesabatı № "+(r.svc.repno||"—")+", "+date.split("-").reverse().join("."),saStr(stype,80),dn.join("; "),r.appr.by?"Təsdiqlədi: "+saStr(r.appr.by,120):""].filter(Boolean).join("\n");
      var parts=[];devs.forEach(function(d){(Array.isArray(d.parts)?d.parts:[]).forEach(function(pt){if(!pt||!String(pt.name||pt.code||"").trim())return;var it=saPartItem(db,pt),q=saNum(pt.qty)>0?saNum(pt.qty):1;
        parts.push(it?{id:saId("l"),itemId:it.id,svc:2,name:it.name,desc:pt.note?saStr(pt.note,200):"",unit:it.unit,qty:q,price:saNum(it.price),disc:0}
          :{id:saId("l"),itemId:"",svc:2,code:saStr(pt.code,60),name:saStr(pt.name||pt.code,300),desc:"Kataloqda tapılmadı — kataloqdan seçin və qiymət yazın",unit:"ədəd",qty:q,price:0,disc:0})})});
      var cl=cc?{name:cc.client,voen:cc.voen,person:cc.person,tel:cc.tel,addr:cc.addr}:via?{name:billTo}:{name:site,person:saStr(r.cl.person,120),tel:saStr(r.cl.tel,60),addr:saStr(r.cl.addr,300)};
      if(!via&&cc){cl.person=r.cl.person||cc.person;cl.tel=r.cl.tel||cc.tel;cl.addr=r.cl.addr||cc.addr}
      var src={type:"service",reportId:r.id,repno:saStr(r.svc.repno,40),contractId:"",date:date,site:via?site:"",apprBy:saStr(r.appr.by,120),apprAt:apAt,repAt:repAt,stype:saStr(stype,60),devs:saDevsOf(devs),skey:saStr(via?site:(r.cl.obj||""),200)};
      if(r.forkOf)src.forkOf=saStr(r.forkOf,60);
      /* the same work billed twice? (a copy of an already sold report, another sale for the same contract + object + period, or the same serials in another sale of this period) */
      var per0=con&&planned?saPeriodLabel(date,saObjPer(con,via?site:(r.cl.obj||site))):(planned?saPeriodLabel(date,({1:"m",3:"q",6:"h",12:"y"})[Math.round(saNum(r.svc.interval))]||"q"):"");
      var sns=devs.map(function(d){var i=d.info||d.ups||{};return String(i.sn||"").trim()}).filter(function(x){return x.length>=5});
      var dupQ=null,dupWhy="";
      if(r.forkOf&&r.forkOf!==r.id&&exists[r.forkOf]&&!exists[r.forkOf].del){dupQ=exists[r.forkOf];dupWhy="fork"}
      if(!dupQ&&per0)db.quotes.forEach(function(q){if(dupQ||q.del||q===cur||q.status==="rejected"||(q.src&&q.src.reportId===r.id)||q.per!==per0)return;
        if(con&&q.src&&q.src.contractId===con.id&&saNormName(q.src.skey!==undefined?q.src.skey:(q.src.site||""))===saNormName(src.skey)){dupQ=q;dupWhy="per";return}
        if(sns.length&&saNameHit(q.cl&&q.cl.name,cl.name,true)){var txt=(q.lines||[]).map(function(l){return (l.name||"")+" "+(l.desc||"")+" "+(l.csn||"")}).join(" ");if(sns.some(function(x){return txt.indexOf(x)>=0})){dupQ=q;dupWhy="sn"}}});
      if(dupQ)src.dup={no:saStr(dupQ.no,40),id:dupQ.id,repno:saStr(dupQ.src&&dupQ.src.repno,40),why:dupWhy};
      if(con&&planned){
        var lines=saContractLines(con,site,devs,info).concat(parts);src.contractId=con.id;
        push({date:date,valid:S.valid,status:dupQ?"draft":"accepted",per:per0,subj:"Servis xidməti"+(via?" — obyekt: "+site:"")+" — hesabat № "+(r.svc.repno||"")+(con.no?" · müqavilə № "+con.no:""),
          cl:cl,eng:saStr(r.svc.eng,120),vat:true,terms:{pay:"Xidməti müqaviləyə uyğun",delivery:"",warranty:"",note:""},lines:lines},src);
        done.push(r.id);return}
      /* not a contract visit: approved work becomes a draft (no reservation yet) */
      if(!con)nocon++;var dl;
      if(!con&&planned){src.nocon=1;
        /* no contract with this client yet: one line per device so the accountant can price them and make the contract from this list */
        dl=devs.map(function(d,di){var i=d.info||d.ups||{};return {id:saId("l"),itemId:"",svc:1,name:saDevName(d),csn:saStr(i.sn,60),desc:[saDevLine(d),di===0?info+"\nMüqavilə yoxdur — müqavilə bağlamaq lazımdır":""].filter(Boolean).join("\n"),unit:"xidmət",qty:1,price:0,disc:0}}).concat(parts)}
      else dl=[{id:saId("l"),itemId:"",svc:1,name:(stype||"Servis xidməti")+(via?" — obyekt: "+site:""),desc:info+(con&&!planned?"\nMüqavilə səfəri sayılmır ("+stype+")":""),unit:"xidmət",qty:1,price:0,disc:0}].concat(parts);
      push({date:date,valid:S.valid,status:"draft",per:per0,subj:(stype||"Servis")+(via?" — obyekt: "+site:"")+" — hesabat № "+(r.svc.repno||""),cl:cl,eng:saStr(r.svc.eng,120),vat:true,
        terms:{pay:S.pay||"",delivery:"",warranty:"",note:""},lines:dl},src);
      done.push(r.id)}
    /* one broken report must not stop the others */
    catch(e){if(e&&e.code&&e.code!=="toolarge")throw e;skipped++;bad.push(String(r&&r.id||"?")+": "+(e&&e.message||e))}});
    return {res:{created:made2,updated:updated,skipped:skipped,nocontract:nocon,done:done,bad:bad,revoked:revoked,warned:warned,stock:saStock(db)},ch:ch}}

  case "settings":{need(SA_CAN.admin(role));var s=p.settings||{};ch.settings={};
    if(s.svcSheet&&!db.settings.svcFrom&&!s.svcFrom)s.svcFrom=new Date(now).toISOString().slice(0,10);
    SA_SETTING_KEYS.forEach(function(k){if(s[k]!==undefined){db.settings[k]=["valid","vat","maxDisc"].indexOf(k)>=0?saNum(s[k]):saStr(s[k],2000);ch.settings[k]=db.settings[k]}});
    return {res:{settings:saSettings(db)},ch:ch}}
  }
  saErr("action")}

/* demo-mode helper: merge changed rows into an in-memory db */
function saApply(db,ch){db.invoices=db.invoices||[];db.contracts=db.contracts||[];db.expenses=db.expenses||[];["items","moves","quotes","invoices","contracts","expenses"].forEach(function(k){(ch[k]||[]).forEach(function(r){var f=false;for(var i=0;i<db[k].length;i++)if(db[k][i].id===r.id){db[k][i]=r;f=true}if(!f)db[k].push(r)})});
  if(ch.settings)for(var k in ch.settings)db.settings[k]=ch.settings[k];return db}

module.exports={saHandle:saHandle,saApply:saApply,saSettings:saSettings,saStock:saStock,SA_CAN:SA_CAN,saPerms:saPerms,saNormName:saNormName,saPayInfo:saPayInfo,saObjPer:saObjPer};
