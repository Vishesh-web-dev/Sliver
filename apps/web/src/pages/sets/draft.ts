import {
  questionSetInputSchema,
  type Difficulty,
  type QuestionSetDetail,
  type QuestionSetInput,
  type StoredQuestion,
} from '@sliver/shared';

/**
 * The editor's working copy. It keeps both the options (multiple choice) and
 * the accepted answers (typed answer) for every question, so switching a
 * question's type back and forth never throws away what the host typed.
 */
export interface DraftQuestion {
  key: string;
  id?: string;
  type: 'MCQ' | 'SHORT';
  difficulty: Difficulty;
  prompt: string;
  options: string[];
  correctOption: number | null;
  acceptedAnswers: string[];
  caseSensitive: boolean;
  explanation: string;
  /** '' = use the game's points table. */
  points: string;
}

export interface DraftSet {
  name: string;
  description: string;
  questions: DraftQuestion[];
}

const newKey = () => (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`).toString();

export function blankQuestion(type: 'MCQ' | 'SHORT', difficulty: Difficulty = 50): DraftQuestion {
  return {
    key: newKey(),
    type,
    difficulty,
    prompt: '',
    options: ['', '', '', ''],
    correctOption: null,
    acceptedAnswers: [''],
    caseSensitive: false,
    explanation: '',
    points: '',
  };
}

export function fromStored(q: StoredQuestion): DraftQuestion {
  const base = blankQuestion(q.type, q.difficulty);
  return {
    ...base,
    id: q.id,
    prompt: q.prompt,
    explanation: q.explanation ?? '',
    points: q.points === null ? '' : String(q.points),
    ...(q.type === 'MCQ'
      ? { options: q.options, correctOption: q.correctOption }
      : { acceptedAnswers: q.acceptedAnswers, caseSensitive: q.caseSensitive }),
  };
}

export function fromDetail(set: QuestionSetDetail): DraftSet {
  return { name: set.name, description: set.description ?? '', questions: set.questions.map(fromStored) };
}

export function emptySet(): DraftSet {
  return { name: '', description: '', questions: [blankQuestion('MCQ', 90)] };
}

export function duplicateQuestion(q: DraftQuestion): DraftQuestion {
  const { id: _id, ...rest } = q;
  return { ...rest, key: newKey(), options: [...q.options], acceptedAnswers: [...q.acceptedAnswers] };
}

/** The shape the API expects (before schema parsing/sanitising). */
export function toRawInput(draft: DraftSet) {
  return {
    name: draft.name,
    description: draft.description || null,
    questions: draft.questions.map((q) => {
      const common = {
        ...(q.id ? { id: q.id } : {}),
        difficulty: q.difficulty,
        prompt: q.prompt,
        explanation: q.explanation || null,
        points: q.points.trim() === '' ? null : Number(q.points),
      };
      return q.type === 'MCQ'
        ? { ...common, type: 'MCQ' as const, options: q.options, correctOption: q.correctOption ?? -1 }
        : {
            ...common,
            type: 'SHORT' as const,
            acceptedAnswers: q.acceptedAnswers.filter((a) => a.trim() !== ''),
            caseSensitive: q.caseSensitive,
          };
    }),
  };
}

export type DraftErrors = Map<string, string>;

/**
 * Validates with the same schema the server uses. Errors are keyed by path,
 * e.g. "name", "questions.2.prompt", "questions.0.options.3".
 */
export function validateDraft(draft: DraftSet): { input: QuestionSetInput | null; errors: DraftErrors } {
  const result = questionSetInputSchema.safeParse(toRawInput(draft));
  const errors: DraftErrors = new Map();
  if (result.success) return { input: result.data, errors };
  for (const issue of result.error.issues) {
    const key = issue.path.join('.');
    if (!errors.has(key)) errors.set(key, issue.message);
  }
  return { input: null, errors };
}

/** Errors for one question, as "field" → message (path prefix stripped). */
export function questionErrors(errors: DraftErrors, index: number): Map<string, string> {
  const prefix = `questions.${index}.`;
  const own = new Map<string, string>();
  for (const [key, message] of errors) {
    if (key.startsWith(prefix)) own.set(key.slice(prefix.length), message);
    else if (key === `questions.${index}`) own.set('', message);
  }
  return own;
}
