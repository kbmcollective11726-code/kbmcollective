import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { isCurrentUserPlatformAdmin } from '../lib/fetchAdminEvents';
import { supabase } from '../lib/supabase';
import styles from './TestGuide.module.css';

const GUIDE_SLUG = 'main-app-regression';

const DEFAULT_TEST_GUIDE = `# CollectiveLive QA Master Test Guide (App-first)

Use this guide for every release. Priority order: P0 smoke -> P1 core flows -> P2 role/event-specific flows.

## 0) Pre-test setup
- [ ] Confirm build version, release date, and environment (prod/staging)
- [ ] Confirm test event(s) exist with schedule, booths, sponsors, announcements, photos
- [ ] Confirm test users are ready: attendee, speaker, vendor, event admin, platform admin
- [ ] Confirm push notifications are enabled on at least one iOS and one Android device
- [ ] Confirm internet quality scenarios available: good wifi, weak mobile data

## 1) P0 App smoke tests (run first on every build)
- [ ] Launch app from cold start (no crash, no white screen)
- [ ] Login with existing user
- [ ] Home tab loads
- [ ] Schedule tab loads sessions
- [ ] Feed tab loads posts/comments
- [ ] Expo/solution providers tab loads list and detail
- [ ] Photo book tab loads
- [ ] Leaderboard tab loads
- [ ] Profile tab loads user data
- [ ] Logout and login again works

## 2) P1 Auth and account
### Login and session
- [ ] Invalid password shows clear error
- [ ] Valid login lands on expected default screen
- [ ] Session persists after app restart
- [ ] Session refresh works without forced sign-out

### Password flows
- [ ] Forgot/reset password email link opens correct reset screen
- [ ] Reset password succeeds and can login with new password
- [ ] Change password in profile succeeds

### Profile and account state
- [ ] Edit profile fields save and display correctly
- [ ] Avatar/photo upload works
- [ ] Notifications settings persist
- [ ] Delete account flow behaves correctly (if enabled)

## 3) P1 Core app engagement flows
### Feed and social
- [ ] Create text-only post
- [ ] Create post with photo
- [ ] View post list sorted correctly
- [ ] Like and unlike post
- [ ] Add comment
- [ ] Delete own comment
- [ ] Open another user profile from feed

### Event navigation and content
- [ ] Event switcher/join flow works
- [ ] Event detail content renders correctly
- [ ] Announcements banner/list displays current announcements
- [ ] Info pages and links open correctly

### Schedule and sessions
- [ ] Sessions list loads by day/track (as configured)
- [ ] Session detail opens and shows speaker/time/location
- [ ] Session feedback/rating submit works (if enabled)

### Notifications
- [ ] In-app notification appears when expected
- [ ] Push notification received on locked device
- [ ] Tapping push opens correct destination screen

## 4) P1 Event commerce/networking flows
### Expo / booths / solution providers
- [ ] Booth list loads
- [ ] Booth detail page loads all fields
- [ ] Contact links/buttons function correctly

### Matchmaking / meetings (if enabled per event)
- [ ] Availability or preferences can be saved
- [ ] Meeting request/create flow works
- [ ] Meeting list reflects updates
- [ ] Meeting reminder behavior works (timing + content)
- [ ] Meeting feedback submission works

### Badges / scans (if enabled)
- [ ] Badge generation/visibility works for target role
- [ ] Scan valid badge succeeds
- [ ] Invalid or duplicate scan handling is correct
- [ ] Scan result data appears in relevant admin/report views

## 5) P1 Role-based access checks
### Attendee
- [ ] Cannot access admin-only routes/tools
- [ ] Can access attendee features for current event

### Speaker
- [ ] Speaker-specific visibility/flows work (sessions/profile context)

### Vendor
- [ ] Vendor booth and relevant networking flows work

### Event admin
- [ ] Can access event admin features for authorized events
- [ ] Cannot modify platform-level settings unless platform admin

### Platform admin
- [ ] Can access all platform pages (including Test Guide and user management)

## 6) P1 Admin web checks (supporting app behavior)
### Event lifecycle
- [ ] Event list loads; event detail opens
- [ ] Create/edit event saves correctly
- [ ] Event visibility/status toggles behave correctly

### Schedule management
- [ ] Add/edit/delete session works
- [ ] Speaker/title/time/location changes reflect in app

### Members and roles
- [ ] Add/import users works
- [ ] Update event role works
- [ ] Platform user management updates persist

### Announcements
- [ ] Create immediate announcement works
- [ ] Scheduled announcement works
- [ ] Targeting by role/users works (if configured)
- [ ] Announcement appears in app and push behavior is correct

### Media/content areas
- [ ] Event photos upload/list/delete works
- [ ] Sponsors CRUD works
- [ ] Solution Providers (booths) CRUD works
- [ ] Matchmaking settings pages load/save
- [ ] Badges pages load and actions succeed

## 7) P2 Reliability and edge cases
- [ ] Slow network: loading states visible, no crash
- [ ] Offline/airplane: graceful error messages, recover on reconnect
- [ ] Large image upload handles compression and completion
- [ ] Duplicate taps do not create duplicate records
- [ ] Expired session prompts recovery/re-login correctly
- [ ] Empty-state UI appears for brand new event/user

## 8) Device matrix (minimum each release)
- [ ] iOS latest major version
- [ ] Android latest major version
- [ ] At least one older/slower device sanity pass
- [ ] Portrait layout sanity across tested devices

## 9) Deep links and navigation integrity
- [ ] Open app from push deep link to post/comment/chat/session
- [ ] Back navigation works from deep-linked screens
- [ ] No broken routes or dead-end screens

## 10) Release regression gate (must pass before publish)
- [ ] No P0/P1 failures open
- [ ] No blocker crash in smoke run
- [ ] Push notifications verified on both platforms
- [ ] Critical admin workflows verified
- [ ] Final sign-off recorded by tester + owner

## 11) Bug report template (required fields)
- Build/version:
- Environment (prod/staging):
- User role:
- Test account email:
- Device + OS version:
- Network condition:
- Feature area:
- Steps to reproduce:
- Expected result:
- Actual result:
- Frequency (always/intermittent):
- Severity (blocker/high/medium/low):
- Screenshots/video:
- Console/log references:

## 12) Per-release addendum
For each release, add a section here called "Release YYYY-MM-DD custom tests" and list all new/changed features with explicit test steps and expected results.
`;

type GuideRow = {
  content: string | null;
  updated_at: string | null;
};

export default function TestGuide() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [content, setContent] = useState(DEFAULT_TEST_GUIDE);
  const [savedContent, setSavedContent] = useState(DEFAULT_TEST_GUIDE);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ok = await isCurrentUserPlatformAdmin();
      if (cancelled) return;
      setAllowed(ok);
      if (!ok) {
        setLoading(false);
        return;
      }

      const { data, error: readErr } = await supabase
        .from('platform_test_guides')
        .select('content, updated_at')
        .eq('slug', GUIDE_SLUG)
        .maybeSingle();
      if (cancelled) return;

      if (readErr) {
        setError(readErr.message);
      } else {
        const row = (data as GuideRow | null) ?? null;
        const loadedContent = row?.content?.trim() ? row.content : DEFAULT_TEST_GUIDE;
        setContent(loadedContent);
        setSavedContent(loadedContent);
        setUpdatedAt(row?.updated_at ?? null);
      }
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const isDirty = useMemo(() => content.trim() !== savedContent.trim(), [content, savedContent]);

  const handleSave = async () => {
    if (!content.trim()) {
      setError('Guide content cannot be empty.');
      return;
    }
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const { data: authData } = await supabase.auth.getUser();
      const userId = authData.user?.id ?? null;
      const { data, error: upsertErr } = await supabase
        .from('platform_test_guides')
        .upsert(
          {
            slug: GUIDE_SLUG,
            title: 'Main app regression test guide',
            content: content.trim(),
            updated_by: userId,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'slug' }
        )
        .select('content, updated_at')
        .single();
      if (upsertErr) throw upsertErr;
      const row = data as GuideRow;
      setSavedContent(row.content?.trim() ? row.content : content.trim());
      setContent(row.content?.trim() ? row.content : content.trim());
      setUpdatedAt(row.updated_at ?? null);
      setNotice('Test guide saved.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save test guide.');
    } finally {
      setSaving(false);
    }
  };

  if (allowed === false) return <Navigate to="/" replace />;
  if (allowed === null || loading) return <div className={styles.loading}>Loading…</div>;

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <Link to="/" className={styles.back}>
          ← All events
        </Link>
        <h1>Test guide</h1>
        <p className={styles.hint}>
          Platform admin only. Keep one shared checklist here so testers always know exactly what to validate in the app
          (plus supporting admin checks).
        </p>
        {updatedAt ? <p className={styles.meta}>Last saved: {new Date(updatedAt).toLocaleString()}</p> : null}
      </div>

      {error ? <div className={styles.error}>{error}</div> : null}
      {notice ? <div className={styles.notice}>{notice}</div> : null}

      <label htmlFor="test-guide-content" className={styles.label}>
        Guide content (Markdown-friendly)
      </label>
      <textarea
        id="test-guide-content"
        className={styles.editor}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        spellCheck={false}
      />

      <div className={styles.actions}>
        <button type="button" className={styles.saveBtn} disabled={!isDirty || saving} onClick={handleSave}>
          {saving ? 'Saving…' : isDirty ? 'Save test guide' : 'Saved'}
        </button>
      </div>
    </div>
  );
}
