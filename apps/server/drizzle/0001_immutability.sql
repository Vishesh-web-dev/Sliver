-- Defence in depth for the two rules the whole game depends on. The
-- application already enforces both inside locked transactions; these triggers
-- make them hold even for a future code path (or a manual SQL session) that
-- forgets to.
--
--   1. A game's question snapshot is immutable once the game is running.
--   2. A submitted answer can never be changed, and nothing can be inserted
--      after the server-side deadline.
--
-- Custom SQLSTATEs let the server map violations to API errors:
--   SL001  snapshot is immutable        SL002  answer window closed
--   SL003  answer is immutable

CREATE OR REPLACE FUNCTION sliver_game_questions_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  g_status text;
  g_index integer;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'game_questions is an immutable snapshot' USING ERRCODE = 'SL001';
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT status, current_index INTO g_status, g_index FROM games WHERE id = NEW.game_id;
    IF g_status IS DISTINCT FROM 'STARTING' OR g_index <> -1 THEN
      RAISE EXCEPTION 'questions can only be snapshotted while a game is starting'
        USING ERRCODE = 'SL001';
    END IF;
    RETURN NEW;
  END IF;

  -- DELETE: only allowed once the game is over (or when the game row itself
  -- is being deleted, in which case it is no longer visible here).
  SELECT status INTO g_status FROM games WHERE id = OLD.game_id;
  IF g_status IS NOT NULL AND g_status <> 'GAME_COMPLETE' THEN
    RAISE EXCEPTION 'cannot delete questions from a running game' USING ERRCODE = 'SL001';
  END IF;
  RETURN OLD;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER game_questions_guard
  BEFORE INSERT OR UPDATE OR DELETE ON game_questions
  FOR EACH ROW EXECUTE FUNCTION sliver_game_questions_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION sliver_answers_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  g_status text;
  g_index integer;
  g_ends timestamptz;
  q_position integer;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT g.status, g.current_index, g.phase_ends_at, gq.position
      INTO g_status, g_index, g_ends, q_position
      FROM games g
      JOIN game_questions gq ON gq.id = NEW.game_question_id AND gq.game_id = g.id
     WHERE g.id = NEW.game_id;

    IF g_status IS DISTINCT FROM 'QUESTION_ACTIVE'
       OR q_position IS DISTINCT FROM g_index
       OR NEW.submitted_at >= g_ends
       -- submitted_at is the instant the server accepted the answer; it may
       -- not be back-dated more than a moment before this insert runs.
       OR NEW.submitted_at < clock_timestamp() - interval '5 seconds'
       OR NEW.submitted_at > clock_timestamp() THEN
      RAISE EXCEPTION 'answer window is closed' USING ERRCODE = 'SL002';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE: only the server's one-time scoring may touch an answer.
  IF NEW.game_id IS DISTINCT FROM OLD.game_id
     OR NEW.game_question_id IS DISTINCT FROM OLD.game_question_id
     OR NEW.player_id IS DISTINCT FROM OLD.player_id
     OR NEW.option_index IS DISTINCT FROM OLD.option_index
     OR NEW.text_answer IS DISTINCT FROM OLD.text_answer
     OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at
     OR OLD.is_correct IS NOT NULL THEN
    RAISE EXCEPTION 'a submitted answer cannot be changed' USING ERRCODE = 'SL003';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER answers_guard
  BEFORE INSERT OR UPDATE ON answers
  FOR EACH ROW EXECUTE FUNCTION sliver_answers_guard();
