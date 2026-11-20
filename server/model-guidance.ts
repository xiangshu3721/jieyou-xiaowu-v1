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
  };
}
