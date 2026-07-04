import { supabase } from './supabase';

/** Sync multi_select answers into event_registration_solution_categories for scoring. */
export async function syncSubmissionSolutionCategories(submissionId: string): Promise<number> {
  const { data, error } = await supabase.rpc('sync_submission_solution_categories', {
    p_submission_id: submissionId,
  });
  if (error) throw error;
  return typeof data === 'number' ? data : 0;
}
