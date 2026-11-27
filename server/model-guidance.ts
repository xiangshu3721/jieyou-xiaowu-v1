import type { ConversationAnalysis } from '../src/shared.js';

/**
 * Keep the model-facing control plane small. The full analysis remains on the
 * server for routing, auditing, booking and safety; repeating it in every
 * prompt adds cost without giving the model a new instruction.
 */
export function modelGuidanceFor(analysis: ConversationAnalysis) {
  return {
    current_issue_id: analysis.current_issue_id,
    issue_status: analysis.issue_status,
    user_intent: analysis.user_intent,
    response_goal: analysis.response_goal,
    reply_length: analysis.reply_length,
    ask_question: analysis.ask_question,
    no_more_questions: analysis.no_more_questions,
    // `ask_question` is only the server's suggested structured gap. When it is
    // false but `no_more_questions` is also false, the model may still ask one
    // natural, context-specific open question if that is the most useful move.
    open_question_allowed: !analysis.no_more_questions,
    response_strategy: analysis.primary_response_strategy,
    autonomy_boundary: '普通对话不得给答案、步骤、练习、行动清单或替用户决定；即使用户要求方法，也先镜像已知处境，帮助其看见感受、矛盾、需要或可选方向。普通探索仍优先提出一个基于最新表达的开放问题；不要用二选一、是不是或未经确认的动机解释。只在安全、专业边界或明确预约时遵循相应服务义务。',
    next_question: analysis.ask_question ? analysis.next_question : null,
    routing: analysis.routing,
    safety_status: analysis.safety_status,
    assessment: analysis.assessment,
    handoff_mode: analysis.handoff_mode,
    handoff_state: analysis.handoff_state,
    booking_preference: analysis.booking_preference,
    show_booking_button: analysis.show_booking_button,
    booking_button_text: analysis.booking_button_text,
    known_facts: analysis.known_facts,
    asked_fields: analysis.asked_fields,
    unresolved_fields: analysis.unresolved_fields,
    confirmed_goal: analysis.confirmed_goal,
    // JTBD-03：帮助进展信号，模型据此调整回应
    // PROGRESS：肯定用户说出的具体变化，不庆功
    // NO_HELP：改变帮助方式，不重复盘问
    // UNDETERMINED：不宣称已有进展或问题解决
    help_progress: analysis.help_progress,
  };
}
