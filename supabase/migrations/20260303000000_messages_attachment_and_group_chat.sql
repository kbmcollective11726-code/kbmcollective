-- Optional image/media attachment on direct messages
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS attachment_url TEXT,
  ADD COLUMN IF NOT EXISTS attachment_type TEXT CHECK (attachment_type IS NULL OR attachment_type = 'image');

COMMENT ON COLUMN public.messages.attachment_url IS 'Optional media URL (e.g. image) for the message.';
COMMENT ON COLUMN public.messages.attachment_type IS 'Type of attachment: image.';

-- Allow empty content when attachment is present (keep NOT NULL for now; use '' for image-only)
-- No change: content remains NOT NULL. Use '' for image-only messages.

-- ==================
-- PRIVATE GROUP CHAT (admin/super_admin only can create)
-- ==================

CREATE TABLE IF NOT EXISTS public.chat_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_by UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_groups_event ON public.chat_groups(event_id);

CREATE TABLE IF NOT EXISTS public.chat_group_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES public.chat_groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  added_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(group_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_group_members_group ON public.chat_group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_chat_group_members_user ON public.chat_group_members(user_id);

CREATE TABLE IF NOT EXISTS public.group_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES public.chat_groups(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  content TEXT NOT NULL DEFAULT '',
  attachment_url TEXT,
  attachment_type TEXT DEFAULT 'image' CHECK (attachment_type IS NULL OR attachment_type = 'image'),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_group_messages_group ON public.group_messages(group_id, created_at);

-- RLS
ALTER TABLE public.chat_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_messages ENABLE ROW LEVEL SECURITY;

-- Chat groups: only event admin or platform admin can create; members can select their groups
DROP POLICY IF EXISTS "Admins can create chat groups" ON public.chat_groups;
CREATE POLICY "Admins can create chat groups" ON public.chat_groups
  FOR INSERT WITH CHECK (
    public.is_event_admin(event_id) OR public.is_platform_admin(auth.uid())
  );

DROP POLICY IF EXISTS "Members can view chat groups they are in" ON public.chat_groups;
CREATE POLICY "Members can view chat groups they are in" ON public.chat_groups
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.chat_group_members cgm
      WHERE cgm.group_id = chat_groups.id AND cgm.user_id = auth.uid()
    )
  );

-- Chat group members: admins manage; members can view their groups
DROP POLICY IF EXISTS "Admins can manage chat group members" ON public.chat_group_members;
CREATE POLICY "Admins can manage chat group members" ON public.chat_group_members
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.chat_groups cg
      WHERE cg.id = chat_group_members.group_id
        AND (public.is_event_admin(cg.event_id) OR public.is_platform_admin(auth.uid()))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.chat_groups cg
      WHERE cg.id = chat_group_members.group_id
        AND (public.is_event_admin(cg.event_id) OR public.is_platform_admin(auth.uid()))
    )
  );

DROP POLICY IF EXISTS "Members can view chat group members" ON public.chat_group_members;
CREATE POLICY "Members can view chat group members" ON public.chat_group_members
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.chat_group_members cgm2
      WHERE cgm2.group_id = chat_group_members.group_id AND cgm2.user_id = auth.uid()
    )
  );

-- Group messages: only members can read/send
DROP POLICY IF EXISTS "Group members can view messages" ON public.group_messages;
CREATE POLICY "Group members can view messages" ON public.group_messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.chat_group_members cgm
      WHERE cgm.group_id = group_messages.group_id AND cgm.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Group members can send messages" ON public.group_messages;
CREATE POLICY "Group members can send messages" ON public.group_messages
  FOR INSERT WITH CHECK (
    auth.uid() = sender_id
    AND EXISTS (
      SELECT 1 FROM public.chat_group_members cgm
      WHERE cgm.group_id = group_messages.group_id AND cgm.user_id = auth.uid()
    )
  );

-- Realtime for group messages (optional; skip if publication doesn't exist)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'group_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.group_messages;
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL; -- ignore if realtime not configured
END $$;
