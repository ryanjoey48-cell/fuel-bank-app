import { supabase } from '@/lib/supabase';
export async function expensesRequest(path = '', init: RequestInit = {}) {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error('SESSION_REQUIRED');
  let response: Response;
  try { response = await fetch(`/api/expenses-centre${path}`, { ...init, signal:init.signal||AbortSignal.timeout(45000), headers: { ...(init.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...init.headers, Authorization: `Bearer ${data.session.access_token}` }, cache: 'no-store' }); }
  catch { throw new Error('REQUEST_UNCONFIRMED'); }
  const result = await response.json().catch(()=>{throw new Error(response.status===413?'FILE_SIZE':'REQUEST_UNCONFIRMED');});
  if (!response.ok) throw new Error(result.error || 'EXPENSES_ERROR');
  return result;
}

/** Reports transferred bytes, then waits for server storage verification before resolving. */
export async function uploadExpenseReceipt(id: string, file: File, onProgress?: (percent:number)=>void) {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error('SESSION_REQUIRED');
  const form = new FormData(); form.append('expense_id',id); form.append('file',file);
  return new Promise<import('./expenses').ExpenseAttachment>((resolve,reject)=>{
    const xhr = new XMLHttpRequest();
    xhr.open('POST','/api/expenses-centre/attachments'); xhr.timeout=180000;
    xhr.setRequestHeader('Authorization',`Bearer ${data.session!.access_token}`);
    xhr.upload.onprogress=e=>{if(e.lengthComputable)onProgress?.(Math.min(99,Math.round(e.loaded/e.total*100)));};
    xhr.onerror=()=>reject(new Error('UPLOAD_FAILED_RETRY'));
    xhr.ontimeout=()=>reject(new Error('UPLOAD_TIMEOUT_RETRY'));
    xhr.onabort=()=>reject(new Error('UPLOAD_INTERRUPTED_RETRY'));
    xhr.onload=()=>{
      try { const result=JSON.parse(xhr.responseText);if(xhr.status<200||xhr.status>=300)throw new Error(result.error||'UPLOAD_FAILED_RETRY');if(result.state!=='ready')throw new Error('UPLOAD_PENDING_RETRY');onProgress?.(100);resolve(result); }
      catch(error){reject(error instanceof SyntaxError?new Error(xhr.status===413?'FILE_SIZE':'UPLOAD_FAILED_RETRY'):error);}
    };
    xhr.send(form);
  });
}
