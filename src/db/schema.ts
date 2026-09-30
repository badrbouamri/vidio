import {
  pgTable,
  text,
  integer,
  real,
  jsonb,
  timestamp,
  uuid,
  pgEnum,
} from "drizzle-orm/pg-core";

export const planEnum = pgEnum("plan", ["free", "pro"]);
export const sourceTypeEnum = pgEnum("source_type", ["upload", "youtube"]);
export const projectStatusEnum = pgEnum("project_status", [
  "created",
  "queued",
  "processing",
  "done",
  "failed",
]);
export const jobStageEnum = pgEnum("job_stage", [
  "ingest",
  "transcribe",
  "detect",
  "render",
  "translate",
  "dub",
]);
export const jobStatusEnum = pgEnum("job_status", [
  "queued",
  "running",
  "done",
  "failed",
]);
export const clipStatusEnum = pgEnum("clip_status", [
  "pending",
  "rendering",
  "ready",
  "failed",
]);
export const audioSourceEnum = pgEnum("audio_source", ["original", "dubbed"]);
export const subtitleLangPrefEnum = pgEnum("subtitle_lang_pref", ["original", "translated"]);

// PRD §8: User (Clerk owns identity; this row mirrors the subset we bill/meter against)
export const users = pgTable("users", {
  id: text("id").primaryKey(), // Clerk userId
  email: text("email").notNull(),
  name: text("name"),
  plan: planEnum("plan").notNull().default("free"),
  minutesUsedPeriod: real("minutes_used_period").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  sourceType: sourceTypeEnum("source_type").notNull(),
  sourceUrl: text("source_url"),
  storageKey: text("storage_key"),
  durationS: real("duration_s"),
  language: text("language"),
  status: projectStatusEnum("status").notNull().default("created"),
  options: jsonb("options").$type<ProjectOptions>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const jobs = pgTable("jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  stage: jobStageEnum("stage").notNull(),
  status: jobStatusEnum("status").notNull().default("queued"),
  progress: integer("progress").notNull().default(0),
  error: text("error"),
  attempts: integer("attempts").notNull().default(0),
  costUsd: real("cost_usd").notNull().default(0),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const transcripts = pgTable("transcripts", {
  projectId: uuid("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  language: text("language").notNull(),
  words: jsonb("words").$type<TranscriptWord[]>().notNull().default([]),
  segments: jsonb("segments").$type<TranscriptSegment[]>().notNull().default([]),
});

export const clips = pgTable("clips", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  startS: real("start_s").notNull(),
  endS: real("end_s").notNull(),
  // FR-30: trim handles are bounded to ±30s of the *original* LLM-detected
  // segment — these stay fixed after creation so that bound has something
  // to measure from, even after repeated trims. See src/lib/trim.ts.
  originalStartS: real("original_start_s").notNull(),
  originalEndS: real("original_end_s").notNull(),
  title: text("title").notNull(),
  hashtags: jsonb("hashtags").$type<string[]>().notNull().default([]),
  score: integer("score").notNull(),
  subScores: jsonb("sub_scores").$type<ClipSubScores>().notNull(),
  reason: text("reason").notNull(),
  status: clipStatusEnum("status").notNull().default("pending"),
  currentVersionId: uuid("current_version_id"),
  // M5.3 per-clip overrides — null falls back to the project-level default
  // (options.subtitleStyle) / the transcript slice, respectively.
  subtitleStyle: text("subtitle_style"),
  subtitleWords: jsonb("subtitle_words").$type<TranscriptWord[] | null>(),
  // M6.1: LLM-translated segments (project.options.targetLanguage), one
  // per original transcript segment within this clip's range, same
  // start/end (FR-25: "timing kept aligned per segment") — see
  // docs/DECISIONS.md for why translated captions are segment-level
  // (static), not word-level karaoke like the original-language ones.
  translatedSegments: jsonb("translated_segments").$type<TranscriptSegment[] | null>(),
  // M6.4: what the *next* re-render should use — toggled in the clip
  // editor, applied by worker/render.py.
  audioPreference: audioSourceEnum("audio_preference").notNull().default("original"),
  subtitleLangPreference: subtitleLangPrefEnum("subtitle_lang_preference")
    .notNull()
    .default("original"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const clipVersions = pgTable("clip_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  clipId: uuid("clip_id")
    .notNull()
    .references(() => clips.id, { onDelete: "cascade" }),
  subtitleStyle: text("subtitle_style").notNull(),
  subtitleLang: text("subtitle_lang").notNull(),
  audio: audioSourceEnum("audio").notNull().default("original"),
  trim: jsonb("trim").$type<{ startS: number; endS: number }>().notNull(),
  videoKey: text("video_key"),
  srtKey: text("srt_key"),
  vttKey: text("vtt_key"),
  thumbnailKey: text("thumbnail_key"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const usageEvents = pgTable("usage_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").references(() => projects.id, {
    onDelete: "set null",
  }),
  type: text("type").notNull(),
  minutes: real("minutes").notNull().default(0),
  credits: real("credits").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// --- Shared JSON shapes (PRD §4 step 3, §5.4, §9) ---

export type ProjectOptions = {
  sourceLanguage?: string; // undefined = auto-detect (FR-9)
  clipLength?: "short" | "medium" | "long"; // 15-30s / 30-60s / 60-90s
  maxClips?: number;
  subtitleStyle?: string;
  targetLanguage?: string;
  dubbingEnabled?: boolean;
  // FR-26 assumption: voice cloning is off by default and gated on
  // explicit consent — see src/lib/dubbing.ts.
  voiceCloningEnabled?: boolean;
  voiceCloningConsent?: boolean;
};

export type TranscriptWord = {
  word: string;
  start: number;
  end: number;
  speaker?: string;
};

export type TranscriptSegment = {
  start: number;
  end: number;
  text: string;
  speaker?: string;
  /** FR-9/edge case §11 (mixed-language speech): flagged by the worker when
   * STT confidence was low — see worker/transcribe.py. */
  lowConfidence?: boolean;
};

export type ClipSubScores = {
  hook: number;
  flow: number;
  value: number;
  trend: number;
};
