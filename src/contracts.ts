export type Page = {
  id: string;
  index: number;
  state: string;
  stage: string;
  error: string | null;
  duration_ms: number | null;
  has_result: boolean;
};
export type Job = {
  id: string;
  filename: string;
  state: string;
  created_at: string;
  pages: Page[];
};
