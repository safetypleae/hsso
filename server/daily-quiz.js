import { json, errorResponse } from './auth-session.js';
import { authenticate } from './documents.js';

const UUID=/^[a-f0-9-]{36}$/i;
const OPTIONS=new Set(['A','B','C','D']);
export const kstDate=(time=Date.now())=>new Date(time+9*3600000).toISOString().slice(0,10);
const optionText=(quiz,key)=>quiz['option_'+key.toLowerCase()];
function guard(request,methods){if(!methods.includes(request.method))return json({ok:false,error:'METHOD_NOT_ALLOWED'},405,{Allow:methods.join(', ')});const origin=request.headers.get('Origin');if(request.method==='POST'&&origin!==null&&origin!==new URL(request.url).origin)return errorResponse('ORIGIN_NOT_ALLOWED',403);}
async function quizForToday(env){return env.DB.prepare("SELECT * FROM daily_quizzes WHERE quiz_date=? AND is_active=1 ORDER BY created_at,id LIMIT 1").bind(kstDate()).first();}
function publicQuiz(quiz){return{id:quiz.id,quizDate:quiz.quiz_date,category:quiz.category||'',difficulty:quiz.difficulty||'',question:quiz.question,options:{A:quiz.option_a,B:quiz.option_b,C:quiz.option_c,D:quiz.option_d}};}

export async function dailyQuiz({request,env}){
  const rejected=guard(request,['GET','POST']);if(rejected)return rejected;
  try{
    const quiz=await quizForToday(env);
    if(request.method==='GET'){
      if(!quiz)return json({ok:true,quiz:null});
      const userId=await authenticate(request,env);
      if(!userId)return json({ok:true,quiz:publicQuiz(quiz),attempt:null});
      const attempt=await env.DB.prepare('SELECT selected_option,is_correct FROM quiz_attempts WHERE quiz_id=? AND user_id=?').bind(quiz.id,userId).first();
      return json({ok:true,quiz:publicQuiz(quiz),attempt:attempt?{selectedOption:attempt.selected_option,isCorrect:Boolean(attempt.is_correct),correctOption:quiz.correct_option,correctAnswer:optionText(quiz,quiz.correct_option),explanation:quiz.explanation,pointsAwarded:attempt.is_correct?10:0}:null});
    }
    const userId=await authenticate(request,env);if(!userId)return errorResponse('UNAUTHENTICATED',401);
    let input;try{input=await request.json();}catch{return errorResponse('INVALID_JSON',400);}
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length!==2||!UUID.test(input.quizId||'')||!OPTIONS.has(input.selectedOption))return errorResponse('INVALID_ATTEMPT',400);
    if(!quiz||quiz.id!==input.quizId)return errorResponse('QUIZ_NOT_AVAILABLE',409);
    if(await env.DB.prepare('SELECT id FROM quiz_attempts WHERE quiz_id=? AND user_id=?').bind(quiz.id,userId).first())return errorResponse('ALREADY_ATTEMPTED',409);
    const correct=input.selectedOption===quiz.correct_option,now=new Date().toISOString(),attemptId=crypto.randomUUID();
    try{
      const statements=[env.DB.prepare('INSERT INTO quiz_attempts (id,quiz_id,user_id,selected_option,is_correct,attempted_at) VALUES (?,?,?,?,?,?)').bind(attemptId,quiz.id,userId,input.selectedOption,correct?1:0,now)];
      if(correct)statements.push(env.DB.prepare("INSERT INTO point_ledger (id,user_id,amount,reason,reference_type,reference_id,created_at) VALUES (?,?,10,'quiz_correct','daily_quiz',?,?)").bind(crypto.randomUUID(),userId,quiz.id,now));
      const results=await env.DB.batch(statements);if(results.some(result=>!result.success||result.meta?.changes!==1))throw new Error('write');
    }catch(error){if(String(error.message).toLowerCase().includes('unique'))return errorResponse('ALREADY_ATTEMPTED',409);throw error;}
    return json({ok:true,result:{selectedOption:input.selectedOption,isCorrect:correct,correctOption:quiz.correct_option,correctAnswer:optionText(quiz,quiz.correct_option),explanation:quiz.explanation,pointsAwarded:correct?10:0}});
  }catch{return errorResponse('INTERNAL_SERVER_ERROR',500);}
}

export async function points({request,env}){
  if(request.method!=='GET')return json({ok:false,error:'METHOD_NOT_ALLOWED'},405,{Allow:'GET'});
  try{const userId=await authenticate(request,env);if(!userId)return errorResponse('UNAUTHENTICATED',401);
    const total=await env.DB.prepare('SELECT COALESCE(SUM(amount),0) AS total FROM point_ledger WHERE user_id=?').bind(userId).first();
    const rows=await env.DB.prepare("SELECT id,amount,reason,reference_type AS referenceType,reference_id AS referenceId,created_at AS createdAt FROM point_ledger WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 10").bind(userId).all();
    return json({ok:true,total:Number(total.total),entries:rows.results});
  }catch{return errorResponse('INTERNAL_SERVER_ERROR',500);}
}
