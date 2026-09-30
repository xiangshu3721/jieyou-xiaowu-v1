import systemPrompt from '../ai/system-prompt.md?raw';
import conversationRules from '../ai/conversation-rules.md?raw';
import issueTaxonomy from '../ai/issue-taxonomy.md?raw';
import routingRules from '../ai/routing-rules.md?raw';
import safetyRules from '../ai/safety-rules.md?raw';
import assessmentRules from '../ai/assessment-rules.md?raw';
import bookingSummary from '../ai/booking-summary.md?raw';

const trim = (value: string) => value.trim();

export const prompts = {
  chat: [systemPrompt, conversationRules, issueTaxonomy, routingRules, safetyRules, assessmentRules].map(trim).join('\n\n'),
  classifier: trim(issueTaxonomy),
  router: trim(routingRules),
  safety: trim(safetyRules),
  summary: trim(bookingSummary),
};

export const promptMetadata = {
  files: [
    'ai/system-prompt.md',
    'ai/conversation-rules.md',
    'ai/issue-taxonomy.md',
    'ai/routing-rules.md',
    'ai/safety-rules.md',
    'ai/assessment-rules.md',
    'ai/booking-summary.md',
    'ai/test-cases.json',
    'ai/changelog.md',
  ],
};
