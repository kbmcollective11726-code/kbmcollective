-- These predicates are referenced by policies on tables that anonymous
-- clients inspect. Without auth claims they return false; EXECUTE is needed so
-- PostgreSQL can evaluate the surrounding public policy safely.
GRANT EXECUTE ON FUNCTION public.can_manage_chat_group_members(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.is_member_of_chat_group(uuid, uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.registration_submission_owned_by_auth(uuid) TO anon;
