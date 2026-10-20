import { supabase } from '@/lib/supabase';

export type ProblemStatus = 'reported' | 'scheduled' | 'at_garage' | 'awaiting_verification' | 'closed';
export type ProblemPriority = 'normal' | 'urgent' | 'safety';
export type VehicleProblem = {
 id:string; vehicle_id:string; reported_on:string; description:string; reported_by:string|null;
 priority:ProblemPriority; status:ProblemStatus; garage:string|null; action_notes:string|null;
 verification_note:string|null; verified_at:string|null; created_at:string; updated_at:string;
};
export const problemStatuses: ProblemStatus[] = ['reported','scheduled','at_garage','awaiting_verification','closed'];
export async function getVehicleProblems():Promise<VehicleProblem[]>{
 const {data,error}=await supabase.from('ees_vehicle_problems').select('*').order('updated_at',{ascending:false}).limit(500);
 if(error)throw error; return data as VehicleProblem[];
}
export async function createVehicleProblem(value:{vehicle_id:string;description:string;reported_by:string;priority:ProblemPriority;reported_on:string}){
 const {error}=await supabase.from('ees_vehicle_problems').insert(value); if(error)throw error;
}
export async function updateVehicleProblem(p:VehicleProblem,next:ProblemStatus,note:string,garage:string){
 if(next==='closed' && (p.status!=='awaiting_verification'||!note.trim()))throw new Error('Verify the repair and enter a verification note before closing.');
 const patch={status:next,garage:garage.trim()||null,action_notes:next==='closed'?p.action_notes:note.trim()||null,
  ...(next==='closed'?{verification_note:note.trim()}:{})};
 const {data,error}=await supabase.from('ees_vehicle_problems').update(patch).eq('id',p.id).eq('updated_at',p.updated_at).select('id');
 if(error)throw error; if(!data?.length)throw new Error('This problem was changed by someone else. Refresh and try again.');
}
export type VehicleProblemEvent = {id:string;old_status:string|null;new_status:string;note:string|null;created_at:string};
export async function getVehicleProblemEvents(problemId:string):Promise<VehicleProblemEvent[]>{
 const {data,error}=await supabase.from('ees_vehicle_problem_events').select('id,old_status,new_status,note,created_at').eq('problem_id',problemId).order('created_at',{ascending:false}).limit(50);
 if(error)throw error; return data as VehicleProblemEvent[];
}
