import type { QuestionSetInput } from '@sliver/shared';

/**
 * Built-in demo sets. Original wording; classic public-domain riddles and
 * reasoning puzzles, one question per difficulty level from 90% to 1%.
 * Short answers list the variants a fair judge would accept.
 */

export interface BuiltinSet {
  id: string;
  set: QuestionSetInput;
}

export const BUILTIN_SETS: BuiltinSet[] = [
  {
    id: '5a1f0000-0000-4000-8000-000000000001',
    set: {
      name: 'Sliver Starter',
      description: 'A balanced first game: twelve questions from easy (90%) to brutal (1%).',
      questions: [
        {
          type: 'MCQ',
          difficulty: 90,
          prompt: 'Which of these is the odd one out?',
          options: ['Apple', 'Banana', 'Carrot', 'Mango'],
          correctOption: 2,
          explanation: 'Carrot is the only vegetable; the rest are fruits.',
          points: null,
        },
        {
          type: 'MCQ',
          difficulty: 80,
          prompt: 'Which month has 28 days?',
          options: ['February', 'January', 'All of them', 'December'],
          correctOption: 2,
          explanation: 'Every month has at least 28 days.',
          points: null,
        },
        {
          type: 'SHORT',
          difficulty: 70,
          prompt: 'What comes next?\n\n2, 4, 8, 16, ?',
          acceptedAnswers: ['32', 'thirty-two'],
          caseSensitive: false,
          explanation: 'Each number doubles the one before it.',
          points: null,
        },
        {
          type: 'MCQ',
          difficulty: 60,
          prompt:
            'A red house is made of red bricks and a blue house is made of blue bricks. What is a greenhouse made of?',
          options: ['Green bricks', 'Glass', 'Grass', 'Wood'],
          correctOption: 1,
          explanation: 'A greenhouse is a glass building for growing plants.',
          points: null,
        },
        {
          type: 'MCQ',
          difficulty: 50,
          prompt:
            'A bat and a ball cost ₹110 in total. The bat costs ₹100 more than the ball. How much does the ball cost?',
          options: ['₹10', '₹5', '₹1', '₹55'],
          correctOption: 1,
          explanation: 'Ball ₹5 + bat ₹105 = ₹110. With a ₹10 ball the bat would be ₹110 and the total ₹120.',
          points: null,
        },
        {
          type: 'MCQ',
          difficulty: 40,
          prompt: 'You are running a race and you overtake the person in second place. What place are you in now?',
          options: ['First', 'Second', 'Third', "Can't tell"],
          correctOption: 1,
          explanation: 'You took their place: second. The leader is still ahead of you.',
          points: null,
        },
        {
          type: 'SHORT',
          difficulty: 30,
          prompt:
            'It takes 5 machines 5 minutes to make 5 widgets. How many minutes would it take 100 machines to make 100 widgets?',
          acceptedAnswers: ['5', 'five', '5 minutes', 'five minutes', '5 mins', '5 min'],
          caseSensitive: false,
          explanation: 'Each machine makes one widget in 5 minutes, so 100 machines make 100 widgets in 5 minutes.',
          points: null,
        },
        {
          type: 'MCQ',
          difficulty: 20,
          prompt: 'How many animals of each kind did Moses take on the ark?',
          options: ['1', '2', '7', 'None'],
          correctOption: 3,
          explanation: 'It was Noah who built the ark, not Moses.',
          points: null,
        },
        {
          type: 'SHORT',
          difficulty: 15,
          prompt:
            'A snail at the bottom of a 10 m well climbs up 3 m every day and slips back 2 m every night. On which day does it reach the top?',
          acceptedAnswers: ['8', 'eight', 'day 8', 'day eight', '8th', 'eighth', 'the 8th day', 'the eighth day'],
          caseSensitive: false,
          explanation: 'After 7 days and nights it is 7 m up. On day 8 it climbs 3 m and reaches the top before slipping.',
          points: null,
        },
        {
          type: 'SHORT',
          difficulty: 10,
          prompt: 'What is the next letter?\n\nO, T, T, F, F, S, S, E, ?',
          acceptedAnswers: ['N'],
          caseSensitive: false,
          explanation: 'They are the first letters of One, Two, Three, Four, Five, Six, Seven, Eight… Nine.',
          points: null,
        },
        {
          type: 'SHORT',
          difficulty: 5,
          prompt: 'If 1 = 5, 2 = 25, 3 = 125 and 4 = 625, then 5 = ?',
          acceptedAnswers: ['1', 'one'],
          caseSensitive: false,
          explanation: 'Read the first line again: 1 = 5, so 5 = 1.',
          points: null,
        },
        {
          type: 'SHORT',
          difficulty: 1,
          prompt: 'Remove six letters from BSAINXLAENTTEARS to leave a familiar word. What is the word?',
          acceptedAnswers: ['banana'],
          caseSensitive: false,
          explanation: 'Remove the letters S-I-X-L-E-T-T-E-R-S ("six letters") and BANANA is what remains.',
          points: null,
        },
      ],
    },
  },
  {
    id: '5a1f0000-0000-4000-8000-000000000002',
    set: {
      name: 'Brain Benders',
      description: 'Trickier wording, sneakier patterns. Read every word.',
      questions: [
        {
          type: 'MCQ',
          difficulty: 90,
          prompt: 'Which weighs more: a kilogram of feathers or a kilogram of iron?',
          options: ['The feathers', 'The iron', 'They weigh the same', 'It depends on the weather'],
          correctOption: 2,
          explanation: 'A kilogram is a kilogram.',
          points: null,
        },
        {
          type: 'MCQ',
          difficulty: 80,
          prompt: 'A plane crashes exactly on the border between two countries. Where are the survivors buried?',
          options: ['In the first country', 'In the second country', 'Half in each', 'Nowhere — survivors are alive'],
          correctOption: 3,
          explanation: "You don't bury survivors.",
          points: null,
        },
        {
          type: 'SHORT',
          difficulty: 70,
          prompt:
            "Johnny's mother had three children. The first was named April and the second was named May. What was the third child's name?",
          acceptedAnswers: ['Johnny'],
          caseSensitive: false,
          explanation: "It's in the question: Johnny's mother.",
          points: null,
        },
        {
          type: 'SHORT',
          difficulty: 60,
          prompt: 'What comes next?\n\nJ, F, M, A, M, J, J, ?',
          acceptedAnswers: ['A', 'August'],
          caseSensitive: false,
          explanation: 'January, February, March, April, May, June, July… August.',
          points: null,
        },
        {
          type: 'MCQ',
          difficulty: 50,
          prompt: 'Which sentence is correct?',
          options: ['The yolk of an egg are white', 'The yolk of an egg is white', 'Both', 'Neither'],
          correctOption: 3,
          explanation: 'Egg yolks are yellow.',
          points: null,
        },
        {
          type: 'SHORT',
          difficulty: 40,
          prompt: 'Which number replaces the question mark?\n\n2, 6, 12, 20, 30, ?',
          acceptedAnswers: ['42', 'forty-two'],
          caseSensitive: false,
          explanation: 'The gaps grow by two each time: +4, +6, +8, +10, +12.',
          points: null,
        },
        {
          type: 'SHORT',
          difficulty: 30,
          prompt:
            'A patch of lily pads doubles in size every day. It covers the whole pond on day 48. On which day did it cover half of the pond?',
          acceptedAnswers: ['47', 'forty-seven', 'day 47', '47th', 'the 47th day'],
          caseSensitive: false,
          explanation: 'It doubles overnight, so it was half the size one day earlier: day 47.',
          points: null,
        },
        {
          type: 'MCQ',
          difficulty: 20,
          prompt: 'Divide 30 by half and add 10. What do you get?',
          options: ['25', '40', '50', '70'],
          correctOption: 3,
          explanation: 'Dividing by ½ doubles: 30 ÷ ½ = 60, and 60 + 10 = 70.',
          points: null,
        },
        {
          type: 'MCQ',
          difficulty: 15,
          prompt:
            'A doctor gives you 3 pills and tells you to take one every half hour. How long until you have taken them all?',
          options: ['30 minutes', '60 minutes', '90 minutes', '2 hours'],
          correctOption: 1,
          explanation: 'First pill now, second at 30 minutes, third at 60 minutes.',
          points: null,
        },
        {
          type: 'SHORT',
          difficulty: 10,
          prompt: 'A clock takes 5 seconds to strike 6 o\'clock. How many seconds does it take to strike 12 o\'clock?',
          acceptedAnswers: ['11', 'eleven', '11 seconds', 'eleven seconds', '11 s', '11 sec'],
          caseSensitive: false,
          explanation: 'Six strikes have five gaps of 1 second. Twelve strikes have eleven gaps: 11 seconds.',
          points: null,
        },
        {
          type: 'SHORT',
          difficulty: 5,
          prompt:
            'What day comes three days after the day that comes two days after the day that comes right after the day that comes two days after Monday?',
          acceptedAnswers: ['Tuesday', 'Tue', 'Tues'],
          caseSensitive: false,
          explanation:
            'Work from the inside out: two days after Monday is Wednesday, right after that is Thursday, two days later is Saturday, and three days after Saturday is Tuesday.',
          points: null,
        },
        {
          type: 'SHORT',
          difficulty: 1,
          prompt: 'What comes next?\n\n1, 11, 21, 1211, 111221, ?',
          acceptedAnswers: ['312211'],
          caseSensitive: false,
          explanation:
            'Each term describes the previous one aloud: 111221 is "three 1s, two 2s, one 1" → 312211.',
          points: null,
        },
      ],
    },
  },
];
