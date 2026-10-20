'use client';
import {useEffect,useRef} from 'react';
const inertLocks=new WeakMap<HTMLElement,{count:number;original:boolean}>();
let openDialogs=0,originalOverflow='';

// Shared only by Maintenance dialogs: one active layer, keyboard containment and return focus.
export function useMaintenanceDialog(active:boolean,onClose:()=>void){
 const ref=useRef<HTMLElement>(null),close=useRef(onClose);close.current=onClose;
 useEffect(()=>{
  if(!active||!ref.current)return;
  const dialog=ref.current,previous=document.activeElement as HTMLElement|null;
  const background:HTMLElement[]=[];
  let branch:HTMLElement=dialog;
  while(branch.parentElement){
   for(const sibling of Array.from(branch.parentElement.children))if(sibling!==branch&&sibling instanceof HTMLElement){const lock=inertLocks.get(sibling)??{count:0,original:sibling.inert};lock.count++;inertLocks.set(sibling,lock);sibling.inert=true;background.push(sibling);}
   branch=branch.parentElement;
   if(branch===document.body)break;
  }
  if(openDialogs++===0)originalOverflow=document.body.style.overflow;
  document.body.style.overflow='hidden';
  const focusable=()=>Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,[tabindex="0"]')).filter(el=>el.getClientRects().length);
  (focusable()[0]??dialog).focus();
  const key=(e:KeyboardEvent)=>{
   if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close.current();}
   if(e.key==='Tab'){
    const elements=focusable(),first=elements[0],last=elements.at(-1);
    if(!first){e.preventDefault();dialog.focus();}
    else if(e.shiftKey&&(document.activeElement===first||document.activeElement===dialog||!dialog.contains(document.activeElement))){e.preventDefault();last?.focus();}
    else if(!e.shiftKey&&(document.activeElement===last||!dialog.contains(document.activeElement))){e.preventDefault();first.focus();}
   }
  };
  // Saving can replace the focused form control. Keep Escape/Tab working even
  // during that brief focus gap, while only this active modal owns the handler.
  document.addEventListener('keydown',key,true);
  return()=>{document.removeEventListener('keydown',key,true);background.forEach(el=>{const lock=inertLocks.get(el);if(lock&&--lock.count===0){el.inert=lock.original;inertLocks.delete(el);}});if(--openDialogs===0){document.body.style.overflow=originalOverflow;if(previous?.isConnected)previous.focus();}};
 },[active]);
 return ref;
}
