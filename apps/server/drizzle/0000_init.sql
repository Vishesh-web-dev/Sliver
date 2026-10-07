CREATE TABLE "answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"game_question_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"option_index" integer,
	"text_answer" text,
	"submitted_at" timestamp with time zone NOT NULL,
	"is_correct" boolean,
	"points_earned" integer,
	CONSTRAINT "answers_one_kind_check" CHECK ((option_index IS NULL) <> (text_answer IS NULL))
);
--> statement-breakpoint
CREATE TABLE "game_players" (
	"game_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"correct_count" integer DEFAULT 0 NOT NULL,
	"incorrect_count" integer DEFAULT 0 NOT NULL,
	"unanswered_count" integer DEFAULT 0 NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "game_players_game_id_player_id_pk" PRIMARY KEY("game_id","player_id")
);
--> statement-breakpoint
CREATE TABLE "game_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"source_question_id" uuid,
	"position" integer NOT NULL,
	"type" text NOT NULL,
	"difficulty" smallint NOT NULL,
	"prompt" text NOT NULL,
	"options" jsonb NOT NULL,
	"correct_option" integer,
	"accepted_answers" jsonb NOT NULL,
	"case_sensitive" boolean NOT NULL,
	"explanation" text,
	"points" integer NOT NULL,
	CONSTRAINT "game_questions_type_check" CHECK (type IN ('MCQ', 'SHORT')),
	CONSTRAINT "game_questions_difficulty_check" CHECK (difficulty IN (90, 80, 70, 60, 50, 40, 30, 20, 15, 10, 5, 1))
);
--> statement-breakpoint
CREATE TABLE "games" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"question_set_id" uuid,
	"status" text NOT NULL,
	"current_index" integer DEFAULT -1 NOT NULL,
	"question_count" integer NOT NULL,
	"questions_played" integer DEFAULT 0 NOT NULL,
	"settings" jsonb NOT NULL,
	"phase_started_at" timestamp with time zone NOT NULL,
	"phase_ends_at" timestamp with time zone,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"end_reason" text,
	CONSTRAINT "games_status_check" CHECK (status IN ('STARTING', 'QUESTION_ACTIVE', 'RESULTS', 'GAME_COMPLETE'))
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"is_connected" boolean DEFAULT false NOT NULL,
	"last_seen_at" timestamp with time zone,
	"disconnected_at" timestamp with time zone,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "question_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid,
	"name" text NOT NULL,
	"description" text,
	"is_builtin" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question_set_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"type" text NOT NULL,
	"difficulty" smallint NOT NULL,
	"prompt" text NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"correct_option" integer,
	"accepted_answers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"case_sensitive" boolean DEFAULT false NOT NULL,
	"explanation" text,
	"points" integer,
	CONSTRAINT "questions_type_check" CHECK (type IN ('MCQ', 'SHORT')),
	CONSTRAINT "questions_difficulty_check" CHECK (difficulty IN (90, 80, 70, 60, 50, 40, 30, 20, 15, 10, 5, 1))
);
--> statement-breakpoint
CREATE TABLE "rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"host_player_id" uuid,
	"question_set_id" uuid,
	"settings" jsonb NOT NULL,
	"current_game_id" uuid,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rooms_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"display_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "answers" ADD CONSTRAINT "answers_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answers" ADD CONSTRAINT "answers_game_question_id_game_questions_id_fk" FOREIGN KEY ("game_question_id") REFERENCES "public"."game_questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answers" ADD CONSTRAINT "answers_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_players" ADD CONSTRAINT "game_players_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_players" ADD CONSTRAINT "game_players_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_questions" ADD CONSTRAINT "game_questions_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_question_set_id_question_sets_id_fk" FOREIGN KEY ("question_set_id") REFERENCES "public"."question_sets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_sets" ADD CONSTRAINT "question_sets_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_question_set_id_question_sets_id_fk" FOREIGN KEY ("question_set_id") REFERENCES "public"."question_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_host_player_id_players_id_fk" FOREIGN KEY ("host_player_id") REFERENCES "public"."players"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_question_set_id_question_sets_id_fk" FOREIGN KEY ("question_set_id") REFERENCES "public"."question_sets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_current_game_id_games_id_fk" FOREIGN KEY ("current_game_id") REFERENCES "public"."games"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "answers_question_player_uq" ON "answers" USING btree ("game_question_id","player_id");--> statement-breakpoint
CREATE INDEX "answers_game_idx" ON "answers" USING btree ("game_id");--> statement-breakpoint
CREATE UNIQUE INDEX "game_questions_game_position_uq" ON "game_questions" USING btree ("game_id","position");--> statement-breakpoint
CREATE INDEX "games_room_idx" ON "games" USING btree ("room_id");--> statement-breakpoint
CREATE INDEX "games_active_set_idx" ON "games" USING btree ("question_set_id") WHERE status <> 'GAME_COMPLETE';--> statement-breakpoint
CREATE UNIQUE INDEX "players_room_user_uq" ON "players" USING btree ("room_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "players_room_name_uq" ON "players" USING btree ("room_id",lower("display_name"));--> statement-breakpoint
CREATE INDEX "question_sets_owner_idx" ON "question_sets" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "questions_set_position_idx" ON "questions" USING btree ("question_set_id","position");