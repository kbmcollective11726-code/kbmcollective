import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase, supabaseUrl, edgeFunctionHeaders } from '../lib/supabase';
import { refreshSupabaseSessionIfNeeded } from '../lib/refreshSupabaseSession';
import type { Event } from '../lib/types';
import styles from './EventPhotos.module.css';

const PAGE_SIZE = 50;
/** Must match Edge Function `admin-zip-event-photos` */
const MAX_BULK_ZIP = 50;
const ALL_IDS_PAGE_SIZE = 1000;

type PhotoPost = {
  id: string;
  image_url: string;
  caption: string | null;
  created_at: string;
  is_approved: boolean;
  is_deleted: boolean;
  user_id: string;
  uploader_name: string;
  uploader_email: string;
};

async function getEdgeFunctionAccessToken(): Promise<string | null> {
  const { data: refreshed } = await supabase.auth.refreshSession();
  if (refreshed.session?.access_token) return refreshed.session.access_token;
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

async function downloadPostViaEdge(postId: string): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await refreshSupabaseSessionIfNeeded();
    const token = await getEdgeFunctionAccessToken();
    if (!token || !supabaseUrl) return { ok: false, message: 'Not signed in or missing Supabase URL.' };
    const res = await fetch(`${supabaseUrl}/functions/v1/admin-download-post-photo`, {
      method: 'POST',
      headers: edgeFunctionHeaders(token),
      body: JSON.stringify({ post_id: postId }),
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      return { ok: false, message: j.error || `Download failed (${res.status})` };
    }
    const blob = await res.blob();
    const cd = res.headers.get('Content-Disposition');
    let filename = `photo-${postId.slice(0, 8)}.jpg`;
    const m = cd?.match(/filename="([^"]+)"/);
    if (m?.[1]) filename = m[1];
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objectUrl);
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'Download failed' };
  }
}

export default function EventPhotos() {
  const { eventId } = useParams<{ eventId: string }>();
  const [event, setEvent] = useState<Event | null>(null);
  const [rows, setRows] = useState<PhotoPost[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [includePending, setIncludePending] = useState(false);
  const [includeRemoved, setIncludeRemoved] = useState(false);
  const [selected, setSelected] = useState<PhotoPost | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [dlNote, setDlNote] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkDownloading, setBulkDownloading] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<string | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [allDownloading, setAllDownloading] = useState(false);
  const [allProgress, setAllProgress] = useState<string | null>(null);
  const [confirmAllOpen, setConfirmAllOpen] = useState(false);
  const [confirmAllCount, setConfirmAllCount] = useState(0);
  const [confirmAllParts, setConfirmAllParts] = useState(0);
  const [allIdsToDownload, setAllIdsToDownload] = useState<string[]>([]);

  const loadPage = useCallback(async () => {
    if (!eventId) return;
    setLoading(true);
    setError(null);
    try {
      let q = supabase
        .from('posts')
        .select(
          'id, image_url, caption, created_at, is_approved, is_deleted, user_id, users(full_name, email)',
          { count: 'exact' }
        )
        .eq('event_id', eventId)
        .not('image_url', 'is', null)
        .order('created_at', { ascending: false });

      if (!includeRemoved) q = q.eq('is_deleted', false);
      if (!includePending) q = q.eq('is_approved', true);

      const from = (page - 1) * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      const { data, error: qErr, count } = await q.range(from, to);
      if (qErr) throw qErr;

      const list: PhotoPost[] = (data ?? []).map((r: Record<string, unknown>) => {
        const u = r.users as { full_name?: string; email?: string } | { full_name?: string; email?: string }[] | null;
        const user = Array.isArray(u) ? u[0] : u;
        return {
          id: r.id as string,
          image_url: r.image_url as string,
          caption: (r.caption as string) ?? null,
          created_at: r.created_at as string,
          is_approved: r.is_approved === true,
          is_deleted: r.is_deleted === true,
          user_id: r.user_id as string,
          uploader_name: user?.full_name ?? '',
          uploader_email: user?.email ?? '',
        };
      });
      setRows(list);
      setTotalCount(count ?? list.length);
    } catch (e) {
      setRows([]);
      setTotalCount(0);
      setError(e instanceof Error ? e.message : 'Failed to load photos.');
    } finally {
      setLoading(false);
    }
  }, [eventId, page, includePending, includeRemoved]);

  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;
    (async () => {
      const { data: eventData } = await supabase.from('events').select('id, name').eq('id', eventId).single();
      if (!cancelled && eventData) setEvent(eventData as Event);
    })();
    return () => { cancelled = true; };
  }, [eventId]);

  useEffect(() => {
    loadPage();
  }, [loadPage]);

  useEffect(() => {
    setPage(1);
  }, [includePending, includeRemoved, eventId]);

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  useEffect(() => {
    setPage((p) => Math.min(Math.max(1, p), totalPages));
  }, [totalPages]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelected(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const toggleSelect = (id: string) => {
    setBulkError(null);
    setSelectedIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const selectAllOnPage = () => {
    setBulkError(null);
    setSelectedIds((prev) => {
      const n = new Set(prev);
      for (const r of rows) n.add(r.id);
      return n;
    });
  };

  const clearSelection = () => {
    setBulkError(null);
    setSelectedIds(new Set());
  };

  const handleDownload = async (p: PhotoPost) => {
    setDlNote(null);
    setDownloading(true);
    const result = await downloadPostViaEdge(p.id);
    setDownloading(false);
    if (!result.ok) setDlNote(result.message);
  };

  const fetchAllFilteredPostIds = useCallback(async (): Promise<string[]> => {
    if (!eventId) return [];
    const ids: string[] = [];
    let from = 0;
    while (true) {
      const to = from + ALL_IDS_PAGE_SIZE - 1;
      let q = supabase
        .from('posts')
        .select('id')
        .eq('event_id', eventId)
        .not('image_url', 'is', null)
        .order('created_at', { ascending: false });
      if (!includeRemoved) q = q.eq('is_deleted', false);
      if (!includePending) q = q.eq('is_approved', true);
      const { data, error: qErr } = await q.range(from, to);
      if (qErr) throw qErr;
      const chunk = (data ?? [])
        .map((r: Record<string, unknown>) => r.id as string)
        .filter((x) => typeof x === 'string' && x.length > 0);
      ids.push(...chunk);
      if (chunk.length < ALL_IDS_PAGE_SIZE) break;
      from += ALL_IDS_PAGE_SIZE;
    }
    return ids;
  }, [eventId, includePending, includeRemoved]);

  const requestZipBlob = useCallback(
    async (postIds: string[]) => {
      if (!eventId) throw new Error('Missing event id');
      await refreshSupabaseSessionIfNeeded();
      const token = await getEdgeFunctionAccessToken();
      if (!token || !supabaseUrl) throw new Error('Not signed in or missing Supabase URL.');
      const res = await fetch(`${supabaseUrl}/functions/v1/admin-zip-event-photos`, {
        method: 'POST',
        headers: edgeFunctionHeaders(token),
        body: JSON.stringify({ event_id: eventId, post_ids: postIds }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error || `ZIP failed (${res.status})`);
      }
      return await res.blob();
    },
    [eventId]
  );

  const triggerBlobDownload = useCallback((blob: Blob, filename: string) => {
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objectUrl);
  }, []);

  const handleBulkZip = async () => {
    if (!eventId || selectedIds.size === 0) return;
    const ids = [...selectedIds];
    setBulkError(null);
    setBulkProgress(null);
    setBulkDownloading(true);
    try {
      const totalParts = Math.ceil(ids.length / MAX_BULK_ZIP);
      for (let i = 0; i < totalParts; i += 1) {
        const partIds = ids.slice(i * MAX_BULK_ZIP, (i + 1) * MAX_BULK_ZIP);
        setBulkProgress(
          totalParts > 1 ? `Building ZIP ${i + 1} of ${totalParts}…` : 'Building ZIP…'
        );
        const blob = await requestZipBlob(partIds);
        const suffix = totalParts > 1 ? `-part-${String(i + 1).padStart(2, '0')}` : '';
        triggerBlobDownload(blob, `event-photos-${eventId.slice(0, 8)}${suffix}.zip`);
      }
      setBulkProgress(
        `Downloaded ${ids.length} photo${ids.length === 1 ? '' : 's'} in ${totalParts} ZIP file${totalParts === 1 ? '' : 's'}.`
      );
    } catch (e) {
      setBulkError(e instanceof Error ? e.message : 'ZIP download failed');
    } finally {
      setBulkDownloading(false);
    }
  };

  const executeDownloadAll = async (allIds: string[]) => {
    if (!eventId) return;
    setBulkError(null);
    setAllProgress(null);
    setAllDownloading(true);
    try {
      const totalParts = Math.ceil(allIds.length / MAX_BULK_ZIP);
      for (let i = 0; i < totalParts; i += 1) {
        const start = i * MAX_BULK_ZIP;
        const end = start + MAX_BULK_ZIP;
        const partIds = allIds.slice(start, end);
        setAllProgress(`Building ZIP ${i + 1} of ${totalParts}...`);
        const blob = await requestZipBlob(partIds);
        const suffix = totalParts > 1 ? `-part-${String(i + 1).padStart(2, '0')}` : '';
        triggerBlobDownload(blob, `event-photos-${eventId.slice(0, 8)}${suffix}.zip`);
      }
      setAllProgress(`Downloaded ${allIds.length} photos in ${totalParts} ZIP file${totalParts === 1 ? '' : 's'}.`);
    } catch (e) {
      setBulkError(e instanceof Error ? e.message : 'Download all failed');
    } finally {
      setAllDownloading(false);
    }
  };

  const handleDownloadAll = async () => {
    if (!eventId) return;
    setBulkError(null);
    setAllProgress(null);
    try {
      const allIds = await fetchAllFilteredPostIds();
      if (allIds.length === 0) {
        setBulkError('No photos found for current filters.');
        return;
      }
      const totalParts = Math.ceil(allIds.length / MAX_BULK_ZIP);
      setConfirmAllCount(allIds.length);
      setConfirmAllParts(totalParts);
      setAllIdsToDownload(allIds);
      setConfirmAllOpen(true);
    } catch (e) {
      setBulkError(e instanceof Error ? e.message : 'Download all failed');
    }
  };

  const confirmDownloadAll = async () => {
    const allIds = allIdsToDownload;
    setConfirmAllOpen(false);
    setAllIdsToDownload([]);
    if (allIds.length === 0) return;
    await executeDownloadAll(allIds);
  };

  const cancelDownloadAll = () => {
    setConfirmAllOpen(false);
    setAllIdsToDownload([]);
  };

  const rangeLabel = useMemo(() => {
    if (totalCount === 0) return '0 photos';
    const start = (page - 1) * PAGE_SIZE + 1;
    const end = Math.min(page * PAGE_SIZE, totalCount);
    return `${start}–${end} of ${totalCount}`;
  }, [page, totalCount]);

  if (!eventId) {
    return (
      <div className={styles.page}>
        <p className={styles.error}>Missing event.</p>
      </div>
    );
  }

  const selectedZipParts = Math.ceil(selectedIds.size / MAX_BULK_ZIP);

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <Link to={`/events/${eventId}`} className={styles.back}>
          ← Event
        </Link>
      </div>
      <h1>Photo book — {event?.name ?? 'Event'}</h1>
      <p className={styles.hint}>
        Downloads go through a secure server so R2/CDN links work in the browser. Select photos with the checkboxes, then{' '}
        <strong>Download ZIP</strong> (up to {MAX_BULK_ZIP} per ZIP; larger selections split into multiple files automatically).
        You can also use <strong>Download all</strong> for every photo matching your filters. Selection is kept when you change
        pages until you clear it.
      </p>

      <div className={styles.toolbar}>
        <label className={styles.checkRow}>
          <input type="checkbox" checked={includePending} onChange={(e) => setIncludePending(e.target.checked)} />
          Include pending approval
        </label>
        <label className={styles.checkRow}>
          <input type="checkbox" checked={includeRemoved} onChange={(e) => setIncludeRemoved(e.target.checked)} />
          Include removed posts
        </label>
        <span className={styles.meta}>{rangeLabel}</span>
      </div>

      {error ? <p className={styles.error}>{error}</p> : null}

      {loading ? (
        <div className={styles.loading}>Loading photos…</div>
      ) : rows.length === 0 ? (
        <p className={styles.empty}>
          No photos match these filters. Try enabling pending or removed, or check that attendees have posted to the feed.
        </p>
      ) : (
        <>
          <div className={styles.bulkBar}>
            <button type="button" className={styles.bulkBtn} onClick={selectAllOnPage}>
              Select all on page
            </button>
            <button type="button" className={styles.bulkBtn} onClick={clearSelection}>
              Clear selection
            </button>
            <span className={styles.bulkMeta}>
              {selectedIds.size} selected
              {selectedZipParts > 1 ? (
                <span className={styles.bulkWarn}> ({selectedZipParts} ZIP files)</span>
              ) : null}
            </span>
            <button
              type="button"
              className={styles.bulkZipBtn}
              disabled={selectedIds.size === 0 || bulkDownloading || allDownloading}
              onClick={handleBulkZip}
            >
              {bulkDownloading ? 'Building ZIP…' : `Download ZIP (${selectedIds.size})`}
            </button>
            <button
              type="button"
              className={styles.bulkZipBtnSecondary}
              disabled={loading || allDownloading || bulkDownloading}
              onClick={handleDownloadAll}
            >
              {allDownloading ? 'Downloading all…' : 'Download all (filtered)'}
            </button>
          </div>
          {bulkError ? <p className={styles.error}>{bulkError}</p> : null}
          {bulkProgress ? <p className={styles.meta}>{bulkProgress}</p> : null}
          {allProgress ? <p className={styles.meta}>{allProgress}</p> : null}

          <div className={styles.grid}>
            {rows.map((p) => (
              <div key={p.id} className={styles.thumbCell}>
                <label className={styles.checkOverlay}>
                  <input
                    type="checkbox"
                    checked={selectedIds.has(p.id)}
                    onChange={() => toggleSelect(p.id)}
                    aria-label={`Select photo ${p.id.slice(0, 8)}`}
                  />
                </label>
                <button
                  type="button"
                  className={styles.thumbBtn}
                  onClick={() => {
                    setDlNote(null);
                    setSelected(p);
                  }}
                  aria-label={`View photo from ${p.uploader_name || p.uploader_email || 'user'}`}
                >
                  <div className={styles.thumbWrap}>
                    {(!p.is_approved || p.is_deleted) && (
                      <span className={styles.badges}>
                        {!p.is_approved ? <span className={`${styles.badge} ${styles.badgeWarn}`}>Pending</span> : null}
                        {p.is_deleted ? <span className={`${styles.badge} ${styles.badgeMuted}`}>Removed</span> : null}
                      </span>
                    )}
                    <img src={p.image_url} alt="" className={styles.thumb} loading="lazy" />
                  </div>
                </button>
              </div>
            ))}
          </div>
          {totalPages > 1 ? (
            <div className={styles.pagination}>
              <button
                type="button"
                className={styles.pageBtn}
                disabled={page <= 1}
                onClick={() => setPage((x) => Math.max(1, x - 1))}
              >
                Previous
              </button>
              <span className={styles.pageInfo}>
                Page {page} of {totalPages}
              </span>
              <button
                type="button"
                className={styles.pageBtn}
                disabled={page >= totalPages}
                onClick={() => setPage((x) => Math.min(totalPages, x + 1))}
              >
                Next
              </button>
            </div>
          ) : null}
        </>
      )}

      {selected ? (
        <div
          className={styles.lightboxBackdrop}
          role="dialog"
          aria-modal="true"
          aria-label="Photo preview"
          onClick={() => setSelected(null)}
        >
          <div className={styles.lightbox} onClick={(e) => e.stopPropagation()}>
            <img src={selected.image_url} alt="" className={styles.lightboxImg} />
            <div className={styles.lightboxMeta}>
              <div>
                <strong>Uploaded by:</strong> {selected.uploader_name || '—'}
                {selected.uploader_email ? ` · ${selected.uploader_email}` : ''}
              </div>
              <div>
                <strong>Date:</strong> {selected.created_at ? new Date(selected.created_at).toLocaleString() : '—'}
              </div>
              {selected.caption ? (
                <div>
                  <strong>Caption:</strong> {selected.caption}
                </div>
              ) : null}
              {!selected.is_approved || selected.is_deleted ? (
                <div>
                  {!selected.is_approved ? <span className={styles.badgeWarn}>Pending approval</span> : null}{' '}
                  {selected.is_deleted ? <span className={styles.badgeMuted}>Removed from feed</span> : null}
                </div>
              ) : null}
            </div>
            {dlNote ? <p className={styles.lightboxNote}>{dlNote}</p> : null}
            <div className={styles.lightboxActions}>
              <button type="button" className={styles.dlBtn} disabled={downloading} onClick={() => handleDownload(selected)}>
                {downloading ? 'Downloading…' : 'Download'}
              </button>
              <button
                type="button"
                className={styles.openTab}
                onClick={() => window.open(selected.image_url, '_blank', 'noopener,noreferrer')}
              >
                Open in new tab
              </button>
              <button type="button" className={styles.closeBtn} onClick={() => setSelected(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {confirmAllOpen ? (
        <div
          className={styles.lightboxBackdrop}
          role="dialog"
          aria-modal="true"
          aria-label="Confirm download all photos"
          onClick={cancelDownloadAll}
        >
          <div className={styles.confirmCard} onClick={(e) => e.stopPropagation()}>
            <h3 className={styles.confirmTitle}>Download all photos?</h3>
            <p className={styles.confirmText}>
              This will download <strong>{confirmAllCount}</strong> photos as <strong>{confirmAllParts}</strong> ZIP
              file{confirmAllParts === 1 ? '' : 's'} (up to {MAX_BULK_ZIP} photos per ZIP).
            </p>
            <div className={styles.confirmActions}>
              <button type="button" className={styles.closeBtn} onClick={cancelDownloadAll}>
                Cancel
              </button>
              <button type="button" className={styles.bulkZipBtn} onClick={confirmDownloadAll}>
                Continue
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
