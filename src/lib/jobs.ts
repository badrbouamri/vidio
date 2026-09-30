import { jobStageEnum } from "@/db/schema";

export type JobStage = (typeof jobStageEnum.enumValues)[number];

/**
 * FR-38: on retry, resume from the stage that failed instead of restarting
 * the whole pipeline (and re-uploading). `jobs` is append-only — one row per
 * stage attempt — so pass in the most recent job row's stage for the
 * project, if any.
 */
export function resumeStageFor(
  projectStatus: string,
  lastJobStage: JobStage | undefined,
): JobStage {
  if (projectStatus === "failed" && lastJobStage) return lastJobStage;
  return "ingest";
}
