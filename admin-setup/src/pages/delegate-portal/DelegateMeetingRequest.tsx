import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { postgrestErrorMessage } from '../../lib/postgrestErrorMessage';
import type { DelegatePortalContext } from './DelegatePortalLayout';
import styles from './DelegatePortal.module.css';

export default function DelegateMeetingRequest() {
  const { event, submission, settings } = useOutletContext<DelegatePortalContext>();
  const [company, setCompany] = useState('');
  const [person, setPerson] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  if (!settings.meeting_requests_open) {
    return (
      <div className={styles.card}>
        <h1>Request Meeting</h1>
        <p className={styles.hint}>Meeting requests are not open yet. Your event organizer will enable this when matching begins.</p>
      </div>
    );
  }

  const submit = async () => {
    if (!company.trim() && !person.trim()) {
      setError('Enter a company or person name.');
      return;
    }
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const { data: existing, error: countErr } = await supabase
        .from('event_meeting_interest_requests')
        .select('priority')
        .eq('submission_id', submission.id)
        .order('priority', { ascending: false })
        .limit(1);
      if (countErr) throw countErr;
      const nextPriority = ((existing?.[0] as { priority?: number } | undefined)?.priority ?? -1) + 1;

      const { error: insErr } = await supabase.from('event_meeting_interest_requests').insert({
        event_id: event.id,
        submission_id: submission.id,
        target_company_name: company.trim() || null,
        target_person_name: person.trim() || null,
        reason: reason.trim() || null,
        priority: nextPriority,
      });
      if (insErr) throw insErr;

      setCompany('');
      setPerson('');
      setReason('');
      setSuccess('Meeting request submitted.');
    } catch (e) {
      setError(postgrestErrorMessage(e) || 'Could not submit request');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.card}>
      <h1>Request Meeting</h1>
      <p className={styles.hint}>Tell us who you would like to meet at {event.name}.</p>
      {error ? <p className={styles.error}>{error}</p> : null}
      {success ? <p className={styles.success}>{success}</p> : null}
      <div className={styles.grid2}>
        <label>
          Company
          <input value={company} onChange={(e) => setCompany(e.target.value)} />
        </label>
        <label>
          Person
          <input value={person} onChange={(e) => setPerson(e.target.value)} />
        </label>
        <label style={{ gridColumn: '1 / -1' }}>
          Reason / notes
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={4} />
        </label>
      </div>
      <button type="button" className={styles.primaryBtn} disabled={saving} onClick={() => void submit()}>
        {saving ? 'Submitting…' : 'Submit request'}
      </button>
    </div>
  );
}
