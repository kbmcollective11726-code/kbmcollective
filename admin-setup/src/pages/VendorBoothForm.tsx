import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { postgrestErrorMessage } from '../lib/postgrestErrorMessage';
import { uploadEventImage } from '../lib/uploadEventImage';
import { LOGO_FILE_ACCEPT, VENDOR_BOOTH_LOGO_HINT } from '../lib/logoUploadHints';
import type { VendorBooth } from '../lib/types';
import styles from './VendorBoothForm.module.css';

type MemberOption = { user_id: string; full_name: string };

export default function VendorBoothForm() {
  const { eventId, boothId } = useParams<{ eventId: string; boothId: string }>();
  const navigate = useNavigate();
  const isNew = boothId === 'new';

  const [vendorName, setVendorName] = useState('');
  const [description, setDescription] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [boothLocation, setBoothLocation] = useState('');
  const [website, setWebsite] = useState('');
  const [contactUserId, setContactUserId] = useState<string>('');
  const [repUserIds, setRepUserIds] = useState<string[]>([]);
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [contactSearch, setContactSearch] = useState('');
  const [repSearch, setRepSearch] = useState('');

  const membersSorted = useMemo(
    () => [...members].sort((a, b) => a.full_name.localeCompare(b.full_name, undefined, { sensitivity: 'base' })),
    [members]
  );

  const filteredForContact = useMemo(() => {
    const q = contactSearch.trim().toLowerCase();
    if (!q) return membersSorted;
    return membersSorted.filter(
      (m) => m.full_name.toLowerCase().includes(q) || (contactUserId && m.user_id === contactUserId)
    );
  }, [membersSorted, contactSearch, contactUserId]);

  const filteredForReps = useMemo(() => {
    const q = repSearch.trim().toLowerCase();
    if (!q) return membersSorted;
    return membersSorted.filter(
      (m) => m.full_name.toLowerCase().includes(q) || repUserIds.includes(m.user_id)
    );
  }, [membersSorted, repSearch, repUserIds]);

  const loadMembers = useCallback(async () => {
    if (!eventId) return;
    const { data, error } = await supabase
      .from('event_members')
      .select('user_id, users(full_name)')
      .eq('event_id', eventId);
    if (error) return;
    type Row = { user_id: string; users: { full_name: string | null } | { full_name: string | null }[] | null };
    const list = (data ?? []).map((r: Row) => {
      const u = Array.isArray(r.users) ? r.users[0] : r.users;
      return { user_id: r.user_id, full_name: u?.full_name ?? 'Unknown' };
    });
    setMembers(list);
  }, [eventId]);

  const loadBooth = useCallback(async () => {
    if (!boothId || isNew || !eventId) return;
    setLoading(true);
    setFormError('');
    try {
      const { data, error } = await supabase.from('vendor_booths').select('*').eq('id', boothId).maybeSingle();
      if (error) throw error;
      const b = data as VendorBooth | null;
      if (!b || b.event_id !== eventId) {
        setFormError('Booth not found.');
        return;
      }
      setVendorName(b.vendor_name ?? '');
      setDescription(b.description ?? '');
      setLogoUrl(b.logo_url ?? '');
      setBoothLocation(b.booth_location ?? '');
      setWebsite(b.website ?? '');
      setContactUserId(b.contact_user_id ?? '');
      const repsRes = await supabase.from('vendor_booth_reps').select('user_id').eq('booth_id', boothId);
      if (!repsRes.error) {
        setRepUserIds((repsRes.data ?? []).map((r: { user_id: string }) => r.user_id));
      } else {
        setRepUserIds(b.contact_user_id ? [b.contact_user_id] : []);
      }
    } catch (e) {
      setFormError(postgrestErrorMessage(e) || 'Failed to load booth');
    } finally {
      setLoading(false);
    }
  }, [boothId, eventId, isNew]);

  const syncBoothReps = useCallback(async (targetBoothId: string) => {
    // Primary representative (`contact_user_id`) must always appear in `vendor_booth_reps`
    // so mobile/admin B2B flows that query reps (not only the booth row) still work.
    const uniqueRepIds = [...new Set([...repUserIds.filter(Boolean), ...(contactUserId ? [contactUserId] : [])])];
    const { error: delErr } = await supabase.from('vendor_booth_reps').delete().eq('booth_id', targetBoothId);
    if (delErr) throw delErr;
    if (uniqueRepIds.length > 0) {
      const rows = uniqueRepIds.map((uid) => ({ booth_id: targetBoothId, user_id: uid }));
      const { error: insErr } = await supabase.from('vendor_booth_reps').insert(rows);
      if (insErr) throw insErr;
    }
  }, [repUserIds, contactUserId]);

  useEffect(() => {
    loadMembers();
  }, [loadMembers]);

  useEffect(() => {
    if (isNew) {
      setLoading(false);
      return;
    }
    loadBooth();
  }, [isNew, loadBooth]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!eventId || !vendorName.trim()) {
      setFormError('Vendor name is required.');
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      const basePayload = {
        vendor_name: vendorName.trim(),
        description: description.trim() || null,
        logo_url: logoUrl.trim() || null,
        booth_location: boothLocation.trim() || null,
        website: website.trim() || null,
        contact_user_id: contactUserId || null,
      };

      if (isNew) {
        const payload = {
          event_id: eventId,
          ...basePayload,
          is_active: true,
        };

        const { data: created, error } = await supabase.from('vendor_booths').insert(payload).select('id').single();
        if (error) throw error;
        const newId = created?.id;
        if (newId) {
          try {
            await syncBoothReps(newId);
          } catch (repErr) {
            const repMsg = postgrestErrorMessage(repErr);
            navigate(`/events/${eventId}/vendor-booths`, {
              state: {
                vendorBoothFlash:
                  `Booth was created, but saving representatives failed: ${repMsg}. Run migrations 20260326090000_vendor_booth_multi_reps.sql and 20260327130000_vendor_booths_rls_fix.sql in Supabase if needed, then edit the booth to set reps again.`,
              },
            });
            return;
          }
        }
        navigate(`/events/${eventId}/vendor-booths`);
        return;
      }

      if (!boothId) return;
      const { error } = await supabase.from('vendor_booths').update(basePayload).eq('id', boothId);
      if (error) throw error;
      try {
        await syncBoothReps(boothId);
      } catch (repErr) {
        const repMsg = postgrestErrorMessage(repErr);
        setFormError(
          `Booth details saved, but representatives failed to sync: ${repMsg}. Check Supabase RLS and migrations for vendor_booth_reps.`
        );
        return;
      }
      navigate(`/events/${eventId}/vendor-booths`);
    } catch (err) {
      const msg = postgrestErrorMessage(err) || 'Save failed';
      const hint =
        /row-level security|policy|permission|403|42501|PGRST/i.test(msg)
          ? ' You must be an event admin or platform admin. In Supabase SQL Editor, run migration 20260327130000_vendor_booths_rls_fix.sql.'
          : /vendor_booth_reps|42P01|does not exist/i.test(msg)
            ? ' Apply migration 20260326090000_vendor_booth_multi_reps.sql in Supabase SQL Editor.'
            : '';
      setFormError(msg + hint);
    } finally {
      setSaving(false);
    }
  };

  const persistLogo = async (url: string | null) => {
    if (!boothId || isNew) return;
    await supabase.from('vendor_booths').update({ logo_url: url }).eq('id', boothId);
  };

  const onLogoFile = async (ev: React.ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    ev.target.value = '';
    if (!file || !eventId) return;
    setFormError('');
    setUploadingLogo(true);
    try {
      const url = await uploadEventImage(file, eventId, 'vendor-logos');
      setLogoUrl(url);
      await persistLogo(url);
    } catch (err) {
      setFormError(postgrestErrorMessage(err) || 'Logo upload failed');
    } finally {
      setUploadingLogo(false);
    }
  };

  const clearLogo = async () => {
    setLogoUrl('');
    if (!isNew && boothId) {
      await persistLogo(null);
    }
  };

  const handleDelete = async () => {
    if (!boothId || isNew) return;
    if (!confirm('Delete this vendor booth? This removes the booth and its meeting slots. This cannot be undone.')) return;
    setSaving(true);
    setFormError('');
    try {
      const { error } = await supabase.from('vendor_booths').delete().eq('id', boothId);
      if (error) throw error;
      navigate(`/events/${eventId}/vendor-booths`);
    } catch (err) {
      setFormError(postgrestErrorMessage(err) || 'Delete failed');
    } finally {
      setSaving(false);
    }
  };

  if (!eventId) return <div className={styles.error}>Missing event</div>;
  if (loading) return <div className={styles.loading}>Loading…</div>;

  return (
    <div className={styles.page}>
        <Link to={`/events/${eventId}/vendor-booths`} className={styles.back}>
          ← Solution Providers
        </Link>
      <h1>{isNew ? 'Add booth' : 'Edit booth'}</h1>

      {formError ? <div className={styles.error}>{formError}</div> : null}

      <form className={styles.form} onSubmit={handleSave}>
        <label htmlFor="vb-name">Vendor name *</label>
        <input
          id="vb-name"
          value={vendorName}
          onChange={(ev) => setVendorName(ev.target.value)}
          placeholder="e.g. Acme Corp"
          required
        />

        <label htmlFor="vb-desc">Description</label>
        <textarea id="vb-desc" value={description} onChange={(ev) => setDescription(ev.target.value)} placeholder="Short description" />

        <label htmlFor="vb-loc">Booth location</label>
        <input
          id="vb-loc"
          value={boothLocation}
          onChange={(ev) => setBoothLocation(ev.target.value)}
          placeholder="e.g. Hall A, Room 101"
        />

        <label htmlFor="vb-web">Website (optional)</label>
        <input
          id="vb-web"
          type="text"
          inputMode="url"
          autoComplete="url"
          value={website}
          onChange={(ev) => setWebsite(ev.target.value)}
          placeholder="https://…"
        />

        <span className={styles.labelRow}>Booth logo (optional)</span>
        <p className={styles.fieldHint}>{VENDOR_BOOTH_LOGO_HINT}</p>
        <input
          ref={logoInputRef}
          type="file"
          accept={LOGO_FILE_ACCEPT}
          className={styles.hiddenFile}
          onChange={onLogoFile}
          aria-hidden
        />
        <div className={styles.mediaBlock}>
          <div className={styles.logoPreviewWrap}>
            {logoUrl ? (
              <img src={logoUrl} alt="Logo preview" className={styles.logoPreview} />
            ) : (
              <div className={styles.mediaPlaceholder}>{uploadingLogo ? 'Uploading…' : 'No logo'}</div>
            )}
          </div>
          <div className={styles.mediaActions}>
            <button
              type="button"
              className={styles.uploadBtn}
              disabled={uploadingLogo || !eventId}
              onClick={() => logoInputRef.current?.click()}
            >
              {uploadingLogo ? 'Uploading…' : logoUrl ? 'Change logo' : 'Upload logo'}
            </button>
            {logoUrl ? (
              <button type="button" className={styles.clearBtn} disabled={uploadingLogo} onClick={clearLogo}>
                Remove
              </button>
            ) : null}
          </div>
        </div>

        <label htmlFor="vb-contact-filter">Primary representative (event member)</label>
        <p className={styles.fieldHint}>Type to filter names, then choose one row below (same idea as a searchable list — no separate dropdown).</p>
        <input
          id="vb-contact-filter"
          type="search"
          className={styles.memberSearch}
          value={contactSearch}
          onChange={(ev) => setContactSearch(ev.target.value)}
          placeholder="Filter names…"
          autoComplete="off"
          aria-label="Filter primary representative list"
        />
        <div className={styles.contactList} role="radiogroup" aria-label="Primary representative">
          <label className={styles.contactRow}>
            <input
              type="radio"
              name="vb-primary-rep"
              checked={contactUserId === ''}
              onChange={() => setContactUserId('')}
            />
            <span>— None —</span>
          </label>
          {filteredForContact.map((m) => (
            <label key={m.user_id} className={styles.contactRow}>
              <input
                type="radio"
                name="vb-primary-rep"
                checked={contactUserId === m.user_id}
                onChange={() => setContactUserId(m.user_id)}
              />
              <span>{m.full_name}</span>
            </label>
          ))}
        </div>
        {contactSearch.trim() && filteredForContact.length === 0 ? (
          <p className={styles.searchEmpty}>No names match this filter. Clear the box to see everyone.</p>
        ) : null}

        <label htmlFor="vb-reps-search">Additional representatives</label>
        <input
          id="vb-reps-search"
          type="search"
          className={styles.memberSearch}
          value={repSearch}
          onChange={(ev) => setRepSearch(ev.target.value)}
          placeholder="Search by name…"
          autoComplete="off"
          aria-label="Filter additional representatives list"
        />
        <div className={styles.repList}>
          {filteredForReps.map((m) => {
            const checked = repUserIds.includes(m.user_id);
            return (
              <label key={m.user_id} className={styles.repRow}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(ev) => {
                    setRepUserIds((prev) => {
                      if (ev.target.checked) return [...new Set([...prev, m.user_id])];
                      return prev.filter((id) => id !== m.user_id);
                    });
                  }}
                />
                <span>{m.full_name}</span>
              </label>
            );
          })}
          {members.length === 0 ? <p className={styles.fieldHint}>No event members found.</p> : null}
          {members.length > 0 && filteredForReps.length === 0 ? (
            <p className={styles.searchEmpty}>No names match this search.</p>
          ) : null}
        </div>

        <div className={styles.actions}>
          <button type="submit" className={styles.saveBtn} disabled={saving}>
            {saving ? 'Saving…' : isNew ? 'Create booth' : 'Save changes'}
          </button>
          {!isNew ? (
            <button type="button" className={styles.deleteBtn} onClick={handleDelete} disabled={saving}>
              Delete booth
            </button>
          ) : null}
        </div>
      </form>
    </div>
  );
}
