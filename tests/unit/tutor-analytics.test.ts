import { expect,it } from 'vitest';
import { analytics } from '../../src/tutor-analytics';
import { newLesson, type LessonStatus } from '../../src/tutor-lessons';
import { studentForm } from '../../src/tutor-model';
it('считает все шесть статусов и разбивает время и выручку по выбранному признаку',()=>{
  const start=new Date(2026,10,1),end=new Date(2026,10,2);
  const s=studentForm({name:'Лена'},'s',1);
  const lessons=(['paid','unpaid','current','scheduled','rescheduled','cancelled'] as LessonStatus[]).map((status,i)=>({...newLesson(s,String(i),+start+i,1),status}));
  for(const detail of ['student','total','subject'] as const){
    const r=analytics([s],[...lessons,{...lessons[0],start_at:+end}],start,end,true,detail);
    expect(r.total).toEqual({plan:8000,fact:2000,debt:2000,count:2,minutes:120,cancelled:2000,moved:2000});
    expect(r.bins).toHaveLength(24);expect([...r.bins[0].groups.values()][0].fact).toBe(2000);
    expect(r.ranking[0].student.color).toBe(s.color);
  }
});
