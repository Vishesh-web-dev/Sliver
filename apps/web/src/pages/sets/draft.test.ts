import { describe, expect, it } from 'vitest';
import { blankQuestion, questionErrors, toRawInput, validateDraft, type DraftSet } from './draft';

const set = (questions: DraftSet['questions']): DraftSet => ({ name: 'Friday', description: '', questions });

describe('question set drafts', () => {
  it('keeps both answer kinds so switching type loses nothing, but sends only the active one', () => {
    const q = { ...blankQuestion('MCQ'), prompt: 'Q', options: ['a', 'b'], correctOption: 1, acceptedAnswers: ['kept'] };
    const raw = toRawInput(set([{ ...q, type: 'SHORT' }]));
    expect(raw.questions[0]).toMatchObject({ type: 'SHORT', acceptedAnswers: ['kept'] });
    expect(raw.questions[0]).not.toHaveProperty('options');
  });

  it('reports problems per question and field, using the server schema', () => {
    const q = { ...blankQuestion('MCQ'), prompt: '', options: ['a', 'b'], correctOption: null };
    const { input, errors } = validateDraft(set([q]));
    expect(input).toBeNull();
    const own = questionErrors(errors, 0);
    expect(own.get('prompt')).toBe('Question text is required');
    expect(own.get('correctOption')).toBe('Mark the correct option');
  });

  it('treats an empty points field as "use the points table"', () => {
    const q = { ...blankQuestion('SHORT'), prompt: 'Q', acceptedAnswers: ['x', ''] };
    const { input } = validateDraft(set([q]));
    expect(input?.questions[0]).toMatchObject({ points: null, acceptedAnswers: ['x'] });
  });
});
