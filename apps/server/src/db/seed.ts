import { and, eq, inArray } from 'drizzle-orm';
import { ACTIVE_GAME_STATUSES, questionSetInputSchema } from '@sliver/shared';
import { loadEnv } from '../env.js';
import { isMain } from '../isMain.js';
import { createDatabase, type Db } from './client.js';
import { games, questionSets, questions } from './schema.js';
import { BUILTIN_SETS } from './seedData.js';

/**
 * Idempotent: upserts the built-in sets by fixed id and replaces their
 * questions. A built-in set that a running game is using is left untouched
 * (the same lock rule hosts get).
 */
export async function seedBuiltinSets(db: Db): Promise<{ seeded: string[]; skipped: string[] }> {
  const seeded: string[] = [];
  const skipped: string[] = [];

  for (const { id, set } of BUILTIN_SETS) {
    const input = questionSetInputSchema.parse(set);
    await db.transaction(async (tx) => {
      await tx
        .insert(questionSets)
        .values({ id, ownerId: null, isBuiltin: true, name: input.name, description: input.description })
        .onConflictDoNothing({ target: questionSets.id });
      await tx.select({ id: questionSets.id }).from(questionSets).where(eq(questionSets.id, id)).for('update');

      const [active] = await tx
        .select({ id: games.id })
        .from(games)
        .where(and(eq(games.questionSetId, id), inArray(games.status, [...ACTIVE_GAME_STATUSES])))
        .limit(1);
      if (active) {
        skipped.push(input.name);
        return;
      }

      await tx
        .update(questionSets)
        .set({ name: input.name, description: input.description, isBuiltin: true, ownerId: null })
        .where(eq(questionSets.id, id));
      await tx.delete(questions).where(eq(questions.questionSetId, id));
      await tx.insert(questions).values(
        input.questions.map((q, position) => ({
          questionSetId: id,
          position,
          type: q.type,
          difficulty: q.difficulty,
          prompt: q.prompt,
          options: q.type === 'MCQ' ? q.options : [],
          correctOption: q.type === 'MCQ' ? q.correctOption : null,
          acceptedAnswers: q.type === 'SHORT' ? q.acceptedAnswers : [],
          caseSensitive: q.type === 'SHORT' ? q.caseSensitive : false,
          explanation: q.explanation,
          points: q.points,
        })),
      );
      seeded.push(input.name);
    });
  }
  return { seeded, skipped };
}

if (isMain(import.meta.url)) {
  loadEnv();
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set (see apps/server/.env.example).');
    process.exit(1);
  }
  const { db, pool } = createDatabase(url, 1);
  seedBuiltinSets(db)
    .then(({ seeded, skipped }) => {
      console.log(`Seeded built-in sets: ${seeded.join(', ') || '(none)'}`);
      if (skipped.length) console.log(`Skipped (in use by a running game): ${skipped.join(', ')}`);
    })
    .catch((err: unknown) => {
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
    })
    .finally(() => void pool.end());
}
