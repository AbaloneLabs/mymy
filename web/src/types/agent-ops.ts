


export interface CronJob {
  id: string;
  name?: string;
  schedule: string;
  prompt?: string;
  deliver?: string;
  repeat?: string;
  skill?: string;
  script?: string;
  workdir?: string;
  nextRun?: string;
  paused: boolean;
}


export interface CronStatus {
  schedulerRunning: boolean;
  activeJobs: number;
  nextRun?: string;
  message?: string;
}


export interface CronResponse {
  jobs: CronJob[];
  status: CronStatus;
}

export interface CronResult {
  id: string;
  jobId: string;
  jobTitle: string;
  mode: string;
  status: "success" | "error" | "silent";
  output: string;
  outputPath?: string | null;
  createdAt: string;
}

export interface CronResultsResponse {
  results: CronResult[];
}
