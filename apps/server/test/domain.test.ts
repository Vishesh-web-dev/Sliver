import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GAME_SETTINGS,
  isShortAnswerCorrect,
  normalizeRoomCode,
  parseNumericAnswer,
  questionInputSchema,
  resolveQuestionPoints,
  ROOM_CODE_PATTERN,
} from '@sliver/shared';
import { rankStandings, winnersOf } from '../src/domain/ranking.js';
import { isAllowedOrigin } from '../src/http/app.js';
import { generateRoomCode } from '../src/domain/roomCode.js';
import { remainingFraction, scoreAnswer, type ScorableQuestion } from '../src/domain/scoring.js';

const scoring = DEFAULT_GAME_SETTINGS.scoring;
const window = { startedAt: new Date(0), endsAt: new Date(30_000) };
const at = (seconds: number) => new Date(seconds * 1000);

describe('room codes', () => {
  it('generates 5-character codes without look-alike characters', () => {
    for (let i = 0; i < 500; i++) expect(generateRoomCode()).toMatch(ROOM_CODE_PATTERN);
  });

  it('normalises what people type', () => {
    expect(normalizeRoomCode(' ab7-kq ')).toBe('AB7KQ');
    expect(normalizeRoomCode('AB7K')).toBeNull();
    expect(normalizeRoomCode('AB0KQ')).toBeNull(); // 0 is never used
  });
});

describe('short-answer matching', () => {
  const ok = (answer: string, accepted: string[], caseSensitive = false) =>
    isShortAnswerCorrect(answer, accepted, { caseSensitive });

  it('ignores case, surrounding whitespace and punctuation', () => {
    expect(ok('  BaNaNa! ', ['banana'])).toBe(true);
    expect(ok('thirty two', ['thirty-two'])).toBe(true);
    expect(ok('thirtytwo', ['thirty-two'])).toBe(true);
    expect(ok("o'clock", ['oclock'])).toBe(true);
  });

  it('strips accents', () => {
    expect(ok('Cafe', ['café'])).toBe(true);
  });

  it('compares numbers by value', () => {
    expect(ok('32', ['32'])).toBe(true);
    expect(ok('32.0', ['32'])).toBe(true);
    expect(ok('1,000', ['1000'])).toBe(true);
    expect(ok('7.5', ['7.50'])).toBe(true);
    expect(ok('33', ['32'])).toBe(false);
    expect(parseNumericAnswer('5 minutes')).toBeNull();
  });

  it('accepts any listed alternative but nothing else', () => {
    expect(ok('Tue', ['Tuesday', 'Tue'])).toBe(true);
    expect(ok('Wednesday', ['Tuesday', 'Tue'])).toBe(false);
    expect(ok('', ['anything'])).toBe(false);
    expect(ok('!!!', ['anything'])).toBe(false);
  });

  it('respects case-sensitive questions', () => {
    expect(ok('PH', ['pH'], true)).toBe(false);
    expect(ok('pH', ['pH'], true)).toBe(true);
  });
});

describe('scoring', () => {
  const mcq: ScorableQuestion = {
    type: 'MCQ',
    correctOption: 2,
    acceptedAnswers: [],
    caseSensitive: false,
    points: 30,
  };
  const short: ScorableQuestion = {
    type: 'SHORT',
    correctOption: null,
    acceptedAnswers: ['32'],
    caseSensitive: false,
    points: 20,
  };

  it('awards full points for a correct answer and none for a wrong one', () => {
    expect(scoreAnswer(mcq, { optionIndex: 2, textAnswer: null, submittedAt: at(5) }, window, scoring)).toMatchObject({
      isCorrect: true,
      points: 30,
    });
    expect(scoreAnswer(mcq, { optionIndex: 1, textAnswer: null, submittedAt: at(5) }, window, scoring)).toMatchObject({
      isCorrect: false,
      points: 0,
    });
    expect(
      scoreAnswer(short, { optionIndex: null, textAnswer: ' 32 ', submittedAt: at(29) }, window, scoring),
    ).toMatchObject({ isCorrect: true, points: 20 });
  });

  it('does not reward speed by default', () => {
    const fast = scoreAnswer(mcq, { optionIndex: 2, textAnswer: null, submittedAt: at(1) }, window, scoring);
    const slow = scoreAnswer(mcq, { optionIndex: 2, textAnswer: null, submittedAt: at(29) }, window, scoring);
    expect(fast.points).toBe(slow.points);
  });

  it('supports an optional speed bonus (basePoints + speedBonus)', () => {
    const withBonus = { ...scoring, speedBonus: { enabled: true, maxPoints: 10 } };
    const r = scoreAnswer(mcq, { optionIndex: 2, textAnswer: null, submittedAt: at(15) }, window, withBonus);
    expect(r).toMatchObject({ basePoints: 30, speedBonus: 5, points: 35 });
    expect(remainingFraction(window, at(45))).toBe(0);
  });

  it('only subtracts points when the optional penalty is configured', () => {
    const harsh = { ...scoring, wrongAnswerPenaltyPercent: 50 };
    const r = scoreAnswer(mcq, { optionIndex: 0, textAnswer: null, submittedAt: at(5) }, window, harsh);
    expect(r).toMatchObject({ isCorrect: false, penalty: 15, points: -15 });
  });

  it('resolves points from the difficulty table unless overridden', () => {
    const table = scoring.difficultyPoints;
    expect(resolveQuestionPoints(null, 90, table)).toBe(10);
    expect(resolveQuestionPoints(null, 1, table)).toBe(150);
    expect(resolveQuestionPoints(500, 1, table)).toBe(500);
  });
});

describe('ranking', () => {
  const row = (name: string, score: number, correct = 0, incorrect = 0, unanswered = 0) => ({
    playerId: name,
    name,
    score,
    correct,
    incorrect,
    unanswered,
  });

  it('orders by score and gives ties the same rank', () => {
    const ranked = rankStandings([row('Kunal', 120), row('Rahul', 185), row('Sneha', 140), row('Anjali', 185)]);
    expect(ranked.map((r) => [r.name, r.rank])).toEqual([
      ['Anjali', 1],
      ['Rahul', 1],
      ['Sneha', 3],
      ['Kunal', 4],
    ]);
    expect(winnersOf(ranked)).toEqual(['Anjali', 'Rahul']);
  });

  it('computes accuracy over the questions a player faced', () => {
    const [r] = rankStandings([row('A', 50, 3, 1, 0)]);
    expect(r?.accuracy).toBe(0.75);
    const [none] = rankStandings([row('B', 0)]);
    expect(none?.accuracy).toBe(0);
  });
});

describe('question validation', () => {
  it('rejects an MCQ whose correct option does not exist', () => {
    const r = questionInputSchema.safeParse({
      type: 'MCQ',
      difficulty: 50,
      prompt: 'Q',
      options: ['a', 'b'],
      correctOption: 2,
    });
    expect(r.success).toBe(false);
  });

  it('rejects unknown difficulty levels', () => {
    const r = questionInputSchema.safeParse({
      type: 'SHORT',
      difficulty: 45,
      prompt: 'Q',
      acceptedAnswers: ['x'],
    });
    expect(r.success).toBe(false);
  });

  it('sanitises control characters out of text', () => {
    const r = questionInputSchema.parse({
      type: 'SHORT',
      difficulty: 50,
      prompt: '  What\u0000 is​ this?  ',
      acceptedAnswers: [' x '],
    });
    expect(r.prompt).toBe('What is this?');
    expect(r.type === 'SHORT' && r.acceptedAnswers).toEqual(['x']);
  });
});

describe('CORS origins', () => {
  const allowed = ['https://sliver.vercel.app', 'https://*.vercel.app', 'http://localhost:5173'];
  it('allows exact origins and wildcard subdomains only', () => {
    expect(isAllowedOrigin('https://sliver.vercel.app', allowed)).toBe(true);
    expect(isAllowedOrigin('https://sliver-git-main-me.vercel.app', allowed)).toBe(true);
    expect(isAllowedOrigin('http://localhost:5173', allowed)).toBe(true);
    expect(isAllowedOrigin('https://vercel.app.evil.com', allowed)).toBe(false);
    expect(isAllowedOrigin('https://evilvercel.app', allowed)).toBe(false);
    expect(isAllowedOrigin('http://sliver.vercel.app', allowed)).toBe(false);
  });
});
