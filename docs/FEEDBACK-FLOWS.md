# Meeting & Session Feedback — Native App → Admin Web

This doc confirms how users leave feedback and where admins see it.

---

## 1. B2B meeting feedback (vendor meeting)

**User (native app)**  
- **Where:** B2B tab → open a booth where they have a meeting → after the meeting time has passed, a **“Rate this meeting”** button appears.  
- **What they submit:** 1–5 stars, optional comment, “Would you meet again?” (Yes/No), “Would you recommend this vendor?” (Yes/No), “Work-with likelihood” 1–5.  
- **Saved to:** `b2b_meeting_feedback` (one row per booking per user; upsert on `booking_id, user_id`).

**Admin (admin web)**  
- **Where:** Events → [Event] → **B2B meeting feedback**.  
- **What they see:** List of all B2B feedback (vendor, attendee, slot, rating, meet again, recommend). **Detail** modal shows full comment and work-with likelihood. Summary cards show feedback count and average rating per vendor.  
- **Data source:** RPC `get_event_b2b_feedback(p_event_id)` and `get_b2b_vendor_performance(p_event_id, p_booth_id)`.

**Tables / RLS**  
- `b2b_meeting_feedback`: attendee can INSERT/UPDATE own row for their booking; event admins can SELECT all for their event (via RPC or RLS).  
- Migrations: `supabase/migrations/20260313010000_b2b_meeting_feedback_and_nudge.sql`, `20260315000000_admin_get_event_b2b_feedback.sql`.

---

## 2. Session feedback (schedule session)

**User (native app)**  
- **Where:** Agenda/Schedule tab → tap a session → session detail modal has **rating (1–5 stars)** and **optional comment** → **Save rating**.  
- **Saved to:** `session_ratings` (one row per session per user; upsert on `session_id, user_id`).

**Admin (admin web)**  
- **Where:** Events → [Event] → **Session feedback**.  
- **What they see:** Table of all session ratings: Session, User, Rating (1–5), Comment (truncated in table), Date.  
- **Data source:** Direct select from `session_ratings` with joins to `schedule_sessions(title)` and `users(full_name, email)`.

**Tables / RLS**  
- `session_ratings`: event members can INSERT own rating; users can UPDATE own rating; event admins can SELECT all for their event.  
- Migration: `supabase/migrations/20260305000000_session_ratings.sql`.

---

## Quick checklist

| Flow              | User can leave feedback? | Saved to              | Admin sees it?        |
|------------------|---------------------------|------------------------|------------------------|
| B2B meeting      | Yes — “Rate this meeting” | `b2b_meeting_feedback` | Yes — B2B meeting feedback |
| Session          | Yes — stars + comment in session modal | `session_ratings`      | Yes — Session feedback    |

Both flows are wired end-to-end in code and RLS. Ensure migrations are applied (e.g. `RUN-B2B-AND-FEEDBACK-MIGRATIONS.sql` and session_ratings migration) so the tables and RPCs exist.
