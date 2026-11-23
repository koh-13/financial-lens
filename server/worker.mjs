import{SignJWT,jwtVerify,createRemoteJWKSet}from'jose';
import{validCode,parseFinancialCSVs,readCSVZip}from'./financial.mjs';
const jwks=createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const secret=env=>new TextEncoder().encode(env.SESSION_SECRET);
const cookie=(req,name)=>req.headers.get('Cookie')?.split('; ').find(x=>x.startsWith(name+'='))?.slice(name.length+1);
const cookieHeader=(req,name,value,age)=>`${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${new URL(req.url).protocol==='https:'?'; Secure':''}`;
const sign=(payload,env,time)=>new SignJWT(payload).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime(time).sign(secret(env));
async function verify(value,env){if(!value||!env.SESSION_SECRET)return null;try{return(await jwtVerify(value,secret(env),{algorithms:['HS256']})).payload}catch{return null}}
async function identity(req,env){const s=await verify(cookie(req,'fl_session'),env);return s?.kind==='session'?s:null}
const settings=env=>({google:!!(env.GOOGLE_CLIENT_ID&&env.GOOGLE_CLIENT_SECRET&&env.SESSION_SECRET&&env.APP_ORIGIN),edinet:!!env.EDINET_API_KEY,storage:!!(env.DB&&env.BUCKET)});
const random=()=>crypto.randomUUID().replace(/-/g,'')+crypto.randomUUID().replace(/-/g,'');
const redirect=(location,headers={})=>new Response(null,{status:302,headers:{Location:location,'Cache-Control':'no-store',...headers}});
async function edinet(env,path,params){const url=new URL('https://api.edinet-fsa.go.jp/api/v2/'+path);for(const[k,v]of Object.entries({...params,'Subscription-Key':env.EDINET_API_KEY}))url.searchParams.set(k,v);const r=await fetch(url,{signal:AbortSignal.timeout(25000)});if(!r.ok)throw new Error('EDINETとの通信に失敗しました。しばらくしてから再試行してください。');return r}
export async function indexDate(env,date){const r=await edinet(env,'documents.json',{date,type:'2'});const body=await r.json();if(body.metadata?.status!=='200')throw new Error('EDINET APIの認証または書類一覧取得に失敗しました。');const operations=[];for(const f of body.results||[]){if(!f.secCode||!['120','130'].includes(f.docTypeCode))continue;if(f.withdrawalStatus!=='0'||f.disclosureStatus!=='0'){operations.push(env.DB.prepare('DELETE FROM filings WHERE doc_id = ?').bind(f.docID));continue}operations.push(env.DB.prepare('INSERT OR REPLACE INTO filings (doc_id,code,name,period_end,submitted,csv_flag,pdf_flag,doc_type) VALUES(?,?,?,?,?,?,?,?)').bind(f.docID,f.secCode.slice(0,4),f.filerName,f.periodEnd,f.submitDateTime,f.csvFlag,f.pdfFlag,f.docTypeCode))}operations.push(env.DB.prepare('INSERT OR REPLACE INTO indexed_dates(date) VALUES(?)').bind(date));for(let i=0;i<operations.length;i+=50)await env.DB.batch(operations.slice(i,i+50));}
async function findFiling(env,code,cursor){for(let n=cursor;n<Math.min(cursor+7,370);n++){const d=new Date();d.setUTCDate(d.getUTCDate()-n);const date=d.toISOString().slice(0,10);const indexed=await env.DB.prepare('SELECT date FROM indexed_dates WHERE date=?').bind(date).first();if(!indexed)await indexDate(env,date);const f=await env.DB.prepare('SELECT * FROM filings WHERE code=? AND doc_type = ? AND submitted >= ? ORDER BY period_end DESC, submitted DESC LIMIT 1').bind(code,'120',date).first();if(f)return{filing:f};}return cursor+7>=370?{}:{pending:true,cursor:cursor+7};}
async function api(req,env){const url=new URL(req.url),path=url.pathname;
 if(req.method==='POST'&&req.headers.get('Origin')!==url.origin)return json({error:'許可されていないリクエストです。'},403);
 if(path==='/api/config')return json(settings(env));
 if(path==='/auth/google'){
 if(!settings(env).google)return json({error:'Google認証が未設定です。'},503);
 const state=random(),nonce=random(),verifier=random();const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier));const challenge=btoa(String.fromCharCode(...new Uint8Array(hash))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
 const payload=await sign({kind:'oauth',state,nonce,verifier},env,'10m');const target=new URL('https://accounts.google.com/o/oauth2/v2/auth');Object.entries({client_id:env.GOOGLE_CLIENT_ID,redirect_uri:env.APP_ORIGIN+'/auth/callback',response_type:'code',scope:'openid email profile',state,nonce,code_challenge:challenge,code_challenge_method:'S256'}).forEach(([k,v])=>target.searchParams.set(k,v));return redirect(target.toString(),{'Set-Cookie':cookieHeader(req,'fl_oauth',payload,600)});
 }
 if(path==='/auth/callback'){
 try{const flow=await verify(cookie(req,'fl_oauth'),env);if(!flow||flow.kind!=='oauth'||flow.state!==url.searchParams.get('state')||!url.searchParams.get('code'))throw Error();const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({code:url.searchParams.get('code'),client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,redirect_uri:env.APP_ORIGIN+'/auth/callback',grant_type:'authorization_code',code_verifier:flow.verifier})});if(!r.ok)throw Error();const tokens=await r.json();const {payload}=await jwtVerify(tokens.id_token,jwks,{issuer:['https://accounts.google.com','accounts.google.com'],audience:env.GOOGLE_CLIENT_ID,algorithms:['RS256']});if(payload.nonce!==flow.nonce||!payload.sub||payload.email_verified!==true)throw Error();const session=await sign({kind:'session',sub:payload.sub,name:payload.name||payload.email},env,'7d');const headers=new Headers({Location:'/', 'Cache-Control':'no-store'});headers.append('Set-Cookie',cookieHeader(req,'fl_session',session,604800));headers.append('Set-Cookie',cookieHeader(req,'fl_oauth','',0));return new Response(null,{status:302,headers})}catch{return redirect('/?auth_error=1',{'Set-Cookie':cookieHeader(req,'fl_oauth','',0)})}
 }
 if(path==='/auth/logout'&&req.method==='POST')return jsonWithCookie(req);
 const user=await identity(req,env);
 if(path==='/api/me')return json({user:user?{name:user.name}:null});
 if(!user)return json({error:'Googleでログインしてください。'},401);
 if(!settings(env).storage)return json({error:'保存先が未設定です。'},503);
 if(path==='/api/analyses'&&req.method==='GET'){const rows=await env.DB.prepare('SELECT data FROM analyses WHERE user_id=? ORDER BY created_at DESC LIMIT 200').bind(user.sub).all();return json(rows.results.map(r=>JSON.parse(r.data)))}
 if(path==='/api/analyze'&&req.method==='POST'){
 if(!env.EDINET_API_KEY)return json({error:'EDINET APIが未設定です。'},503);
 const body=await req.json();const code=String(body.code||'').toUpperCase();const cursor=Number(body.cursor||0);if(!validCode(code)||!Number.isInteger(cursor)||cursor<0||cursor>364||cursor%7!==0)return json({error:'証券コードまたは検索範囲が正しくありません。'},400);
 const found=await findFiling(env,code,cursor);if(found.pending)return json(found);if(!found.filing)return json({error:'過去1年に有価証券報告書が見つかりませんでした。'},404);const f=found.filing;
 const correction=await env.DB.prepare('SELECT doc_id FROM filings WHERE code=? AND period_end=? AND doc_type=? LIMIT 1').bind(code,f.period_end,'130').first();if(correction)return json({error:'同じ決算期に訂正有価証券報告書があります。現在は訂正内容の自動照合に未対応のため、原本を確認してください。'},422);
 if(f.csv_flag!=='1'||f.pdf_flag!=='1')return json({error:'この書類はPDFまたは構造化データを取得できません。'},422);
 const csv=await edinet(env,`documents/${f.doc_id}`,{type:'5'});if(csv.headers.get('Content-Type')?.includes('json'))throw new Error('構造化データを取得できませんでした。');const bytes=new Uint8Array(await csv.arrayBuffer());if(bytes.length>20_000_000)throw new Error('データサイズが上限を超えています。');const values=parseFinancialCSVs(readCSVZip(bytes),f.period_end);
 const pdf=await edinet(env,`documents/${f.doc_id}`,{type:'2'});if(!pdf.headers.get('Content-Type')?.includes('application/pdf'))throw new Error('原本PDFを取得できませんでした。');await env.BUCKET.put(`pdf/${f.doc_id}.pdf`,pdf.body,{httpMetadata:{contentType:'application/pdf'}});
 const a={id:crypto.randomUUID(),code,name:f.name,period:f.period_end,docId:f.doc_id,createdAt:new Date().toISOString(),...values};await env.DB.prepare('INSERT INTO analyses (id,user_id,code,name,doc_id,data,created_at) VALUES(?,?,?,?,?,?,?)').bind(a.id,user.sub,code,a.name,a.docId,JSON.stringify(a),a.createdAt).run();return json({analysis:a});
 }
 const pdfPath=path.match(/^\/api\/analyses\/([a-f0-9-]+)\/pdf$/);if(pdfPath&&req.method==='GET'){const a=await env.DB.prepare('SELECT doc_id FROM analyses WHERE id=? AND user_id=?').bind(pdfPath[1],user.sub).first();if(!a)return json({error:'書類が見つかりません。'},404);const file=await env.BUCKET.get(`pdf/${a.doc_id}.pdf`);if(!file)return json({error:'PDFが見つかりません。'},404);return new Response(file.body,{headers:{'Content-Type':'application/pdf','Content-Disposition':`inline; filename="${a.doc_id}.pdf"`,'Cache-Control':'private, max-age=3600','X-Content-Type-Options':'nosniff'}})}
 return json({error:'ページが見つかりません。'},404);
}
function jsonWithCookie(req){return new Response('{"ok":true}',{headers:{'Content-Type':'application/json','Cache-Control':'no-store','Set-Cookie':cookieHeader(req,'fl_session','',0)}})}
export default{async fetch(req,env){try{const path=new URL(req.url).pathname;if(path.startsWith('/api/')||path.startsWith('/auth/'))return await api(req,env);return new Response('Not found',{status:404})}catch(e){return json({error:e.message?.includes('EDINET')||e.message?.includes('データ')||e.message?.includes('PDF')||e.message?.includes('上限')?e.message:'処理に失敗しました。時間をおいて再試行してください。'},502)}},async scheduled(event,env,ctx){if(!settings(env).edinet||!settings(env).storage)return;ctx.waitUntil((async()=>{for(let n=0;n<2;n++){const d=new Date();d.setUTCDate(d.getUTCDate()-n);await indexDate(env,d.toISOString().slice(0,10))}})())}};
