import { get } from 'node:https';
import { lookup } from 'node:dns';
import { isIP } from 'node:net';
import { createHash } from 'node:crypto';
import { validatePageUrl } from './url-analysis-orchestrator.js';

export const atendimentoUrl = 'https://banco.bradesco/html/classic/atendimento/atendimento.shtm';
export const publicPageLimit = 2_000_000;
/** Initial public migration scope: one explicitly selected document, no crawler or endpoint probing. */
export function validatePublicDiscoveryUrl(input: string): string {
  const url=validatePageUrl(input);
  if(url!==atendimentoUrl) throw Error('PUBLIC_SOURCE_NOT_APPROVED');
  return url;
}
export function publicIPv4(address: string): boolean {
  if(isIP(address)!==4) return false;
  const [a,b,c]=address.split('.').map(Number);
  return !(a===0 || a===10 || a===127 || a>=224 || a===169&&b===254 || a===172&&b>=16&&b<=31 ||
    a===192&&(b===168 || b===0 || b===2 || b===88&&c===99) || a===100&&b>=64&&b<=127 ||
    a===198&&(b===18 || b===19 || b===51&&c===100) || a===203&&b===0&&c===113);
}
export function assertPublicResponse(status: number | undefined, contentType: string, encoding='identity') {
  if(status!==undefined && status>=300 && status<400) throw Error('PUBLIC_SOURCE_REDIRECT_REQUIRES_REVIEW');
  if(status!==200) throw Error(status===401||status===403?'PUBLIC_SOURCE_ACCESS_DENIED':'PUBLIC_SOURCE_HTTP_ERROR');
  if(!/^text\/html(?:\s*;|$)/i.test(contentType)) throw Error('PUBLIC_SOURCE_NOT_HTML');
  if(encoding!=='identity') throw Error('PUBLIC_SOURCE_ENCODING_UNSUPPORTED');
}
/** Keep transport categories separate; ENOTFOUND alone cannot prove a sandbox denial. */
export function classifyPublicSourceError(error: NodeJS.ErrnoException, phase: 'dns' | 'transport' = 'transport'): Error {
  const code=error.code??'';
  if(code.startsWith('PUBLIC_SOURCE_'))return error;
  const category=code.startsWith('PUBLIC_SOURCE_')?code:
    ['EPERM','EACCES'].includes(code)?'PUBLIC_SOURCE_NETWORK_PERMISSION_DENIED':
    ['ETIMEDOUT','ESOCKETTIMEDOUT'].includes(code)?'PUBLIC_SOURCE_TIMEOUT':
    /CERT|TLS|SSL/.test(code)||['UNABLE_TO_VERIFY_LEAF_SIGNATURE','DEPTH_ZERO_SELF_SIGNED_CERT'].includes(code)?'PUBLIC_SOURCE_TLS_ERROR':
    phase==='dns'||['ENOTFOUND','EAI_AGAIN','EAI_FAIL'].includes(code)?'PUBLIC_SOURCE_DNS_UNAVAILABLE':'PUBLIC_SOURCE_NETWORK_UNAVAILABLE';
  return Object.assign(Error(category),{code:category, diagnostic:{phase,nativeCode:code||null}});
}
/** Native fetch with a minimal dispatcher backed by node:https, keeping DNS pinning and
 * TLS hostname verification. No proxy, redirects, cookies or implicit decompression. */
export async function readPublicPage(input: string): Promise<{html: string; capturedAt: string}> {
  const url=validatePublicDiscoveryUrl(input);
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),15000);
  let transportError:Error|undefined;
  const dispatcher={dispatch(options:any,handler:any) {
    const request=get(url,{agent:false,headers:options.headers,
      lookup(host,lookupOptions,callback) {
        lookup(host,{all:true,family:4},(error,addresses)=>{
          if(error)return callback(classifyPublicSourceError(error,'dns'),'',4);
          if(!addresses.length||addresses.some(a=>!publicIPv4(a.address)))return callback(Object.assign(Error('PUBLIC_SOURCE_PRIVATE_ADDRESS'),{code:'PUBLIC_SOURCE_PRIVATE_ADDRESS'}),'',4);
          if(typeof lookupOptions==='object'&&lookupOptions.all)(callback as Function)(null,[addresses[0]]);
          else callback(null,addresses[0].address,4);
        });
      }
    },response=>{
      // Check before fetch can transparently decompress the response.
      try {assertPublicResponse(response.statusCode,String(response.headers['content-type']??''),String(response.headers['content-encoding']??'identity'));}
      catch(e){transportError=e as Error;response.destroy();handler.onError(e);return;}
      handler.onHeaders(response.statusCode,response.rawHeaders.map(h=>Buffer.from(h)),()=>response.resume(),response.statusMessage);
      let size=0;
      response.on('data',(chunk:Buffer)=>{
        size+=chunk.length;
        if(size>publicPageLimit){transportError=Error('PUBLIC_SOURCE_SIZE_LIMIT');response.destroy(transportError);return;}
        if(handler.onData(chunk)===false)response.pause();
      });
      response.on('end',()=>handler.onComplete([]));
      response.on('error',(e)=>{transportError??=Error('PUBLIC_SOURCE_STREAM_FAILED');handler.onError(e);});
    });
    handler.onConnect((reason:Error)=>request.destroy(reason));
    request.on('error',(e:NodeJS.ErrnoException)=>{transportError??=classifyPublicSourceError(e);handler.onError(e);});
    return true;
  }};
  try {
    const response=await fetch(url,{dispatcher,redirect:'manual',credentials:'omit',signal:controller.signal,
      headers:{Accept:'text/html','Accept-Encoding':'identity','User-Agent':'Migration-Maestro-Public-ReadOnly/1.0'}} as RequestInit);
    const charset=/charset\s*=\s*["']?([\w-]+)/i.exec(response.headers.get('content-type')??'')?.[1]?.toLowerCase()??'utf-8';
    if(!['utf-8','utf8','iso-8859-1','windows-1252'].includes(charset))throw Error('PUBLIC_SOURCE_CHARSET_UNSUPPORTED');
    const bytes=await response.arrayBuffer();
    let html:string;
    try {html=new TextDecoder(charset,{fatal:true}).decode(bytes);}catch{throw Error('PUBLIC_SOURCE_CHARSET_UNSUPPORTED');}
    return {html,capturedAt:new Date().toISOString()};
  } catch(e) {
    if(controller.signal.aborted)throw Error('PUBLIC_SOURCE_TIMEOUT');
    if(transportError)throw transportError;
    if(e instanceof Error&&e.message.startsWith('PUBLIC_SOURCE_'))throw e;
    throw classifyPublicSourceError((e as Error & {cause?:NodeJS.ErrnoException}).cause??e as NodeJS.ErrnoException);
  } finally {clearTimeout(timer);}
}

const text=(value:string)=>value.replace(/<[^>]*>/g,' ').replace(/&#(x[0-9a-f]+|\d+);/gi,(_,n:string)=>{
  const code=n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n);
  return code>0&&code<=0x10ffff?String.fromCodePoint(code):'';
}).replace(/&(amp|nbsp|lt|gt|quot|apos);/gi,(_,n:string)=>({amp:'&',nbsp:' ',lt:'<',gt:'>',quot:'"',apos:"'"}[n.toLowerCase()]!)).replace(/\s+/g,' ').trim();
const attr=(tag:string,name:string)=>new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,'i').exec(tag)?.slice(1).find(x=>x!==undefined)??'';
const folded=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
/** Conservative static inventory, not a DOM/browser or semantic parity audit. Never executes markup. */
export function inspectPublicHtml(html:string,url=atendimentoUrl) {
  validatePublicDiscoveryUrl(url);
  if(typeof html!=='string' || Buffer.byteLength(html)>publicPageLimit)throw Error('PUBLIC_SOURCE_SIZE_LIMIT');
  if(!/<html\b/i.test(html) || !/<body\b/i.test(html))throw Error('PUBLIC_SOURCE_DOCUMENT_INVALID');
  const sourceDigest=createHash('sha256').update(html).digest('hex');
  const inert=html.replace(/<!--[\s\S]*?-->/g,'').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,'');
  const headings=[...inert.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi)].slice(0,200).map(m=>({level:Number(m[1]),text:text(m[2]).slice(0,160)}));
  const bodyText=folded(text(inert));
  const links=[...inert.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)].slice(0,1000).flatMap(m=>{
    try {
      const href=new URL(text(attr(m[1],'href')),url);
      if(!['https:','http:','tel:','mailto:'].includes(href.protocol) || href.username || href.password)return [];
      href.search=''; // No query values, tokens, or identifiers in the compact report.
      return [{label:text(m[2]).slice(0,120),url:href.href,followed:false as const}];
    }catch{return [];}
  });
  const categories=['Cartões','Investimentos','Consórcios','Fone Fácil','Bradescard','Renegociação de Dívidas'];
  const observedCategories=categories.filter(c=>headings.some(h=>folded(h.text)===folded(c)));
  const forms=[...inert.matchAll(/<form\b([^>]*)>/gi)].map((m,i)=>({index:i,method:attr(m[1],'method').toUpperCase()||'GET',submitted:false}));
  const sensitive=[
    {kind:'account-access',observed:/acessar sua conta|agencia|internet banking/.test(bodyText)},
    {kind:'personal-data-form',observed:/<input\b/i.test(inert)&&/\bcpf\b|\bcnpj\b|nome completo/.test(bodyText)},
    {kind:'chat',observed:/\bchat\b/.test(bodyText)},
    {kind:'whatsapp',observed:/whatsapp/.test(bodyText)||links.some(l=>/wa\.me|whatsapp/.test(l.url))},
    {kind:'cancellation',observed:/cancelamento|cancelar/.test(bodyText)},
    {kind:'financial-transaction',observed:/\bpix\b|transferencia|renegociacao|pagamento/.test(bodyText)},
    {kind:'embedded-integration',observed:/<(?:iframe|script)\b/i.test(html)},
  ].map(item=>({...item,operationExecuted:false,requiresSeparateIntegrationAuthorization:true}));
  const candidates=[
    {sourceId:'service-navigation',kind:'navigation',observed:links.some(l=>/ouvidoria|centrais|rede de atendimento/.test(folded(l.label))),fields:['items[].label','items[].href','items[].description']},
    {sourceId:'bia-content',kind:'structured-content',observed:/\bbia\b/.test(bodyText)&&/whatsapp/.test(bodyText),fields:['heading','description','groups[].title','groups[].items[]','cta.label','cta.href']},
    {sourceId:'faq',kind:'categorized-faq',observed:/perguntas frequentes/.test(bodyText),fields:['categories[].id','categories[].title','categories[].items[].question','categories[].items[].answer']},
    {sourceId:'institutional-links',kind:'link-list',observed:links.some(l=>/correspondentes|financiamentos|expresso|seguranca/.test(folded(l.label+' '+l.url))),fields:['heading','links[].label','links[].href']},
  ].map(c=>({...c,universalEditor:'candidate-requires-contract' as const,resourceType:null,reuseVerified:false}));
  return {url,sourceDigest,digestBasis:'decoded-html-utf8',title:text(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(inert)?.[1]??'').slice(0,200),
    headings,links,faq:{observedCategories,categoryCoverage:'static-heading-observation',answersMigrated:false},forms,sensitive,candidates,
    limitations:['Static HTML only; no scripts, browser interaction, assets, links or form submissions.',
      'Candidate fields are proposed requirements, not verified AEM/React/Universal Editor contracts.',
      'Hidden or dynamically loaded content, behavior and accessibility require a separately authorized validation.']};
}
