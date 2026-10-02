import systemPrompt from '../ai/system-prompt.md?raw';
import conversationRules from '../ai/conversation-rules.md?raw';
import issueTaxonomy from '../ai/issue-taxonomy.md?raw';
import routingRules from '../ai/routing-rules.md?raw';
import safetyRules from '../ai/safety-rules.md?raw';
import assessmentRules from '../ai/assessment-rules.md?raw';
import naturalnessRules from '../ai/naturalness-rules.md?raw';
import issueLifecycleRules from '../ai/issue-lifecycle-rules.md?raw';
import bookingSummary from '../ai/booking-summary.md?raw';
import conversationReviewer from '../ai/conversation-reviewer.md?raw';

const trim = (value: string) => value.trim();

export const prompts = {
  chat: [systemPrompt, conversationRules, naturalnessRules, issueLifecycleRules, issueTaxonomy, routingRules, safetyRules, assessmentRules].map(trim).join('\n\n'),
  classifier: trim(issueTaxonomy),
  router: trim(routingRules),
  safety: trim(safetyRules),
  summary: trim(bookingSummary),
  reviewer: trim(conversationReviewer),
};

export const promptMetadata = {
  files: [
    'ai/system-prompt.md',
    'ai/conversation-rules.md',
    'ai/issue-taxonomy.md',
    'ai/routing-rules.md',
    'ai/safety-rules.md',
    'ai/assessment-rules.md',
    'ai/naturalness-rules.md',
    'ai/issue-lifecycle-rules.md',
    'ai/booking-summary.md',
    'ai/conversation-reviewer.md',
    'ai/test-cases.json',
    'ai/changelog.md',
  ],
};
