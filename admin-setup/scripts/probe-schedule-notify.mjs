async function probe(base) {
  const r = await fetch(base);
  const html = await r.text();
  const m = html.match(/assets\/(index-[^"]+\.js)/);
  if (!m) return { base, err: 'no bundle' };
  const js = await (await fetch(`${base.replace(/\/$/, '')}/assets/${m[1]}`)).text();
  const hasNotify = js.includes('Schedule updated') && js.includes('schedule_change');
  const csvCallsNotify = /bulk_added/.test(js) && /notifyScheduleChange\(/.test(js);
  // After fix: bulk_added may exist in lib but Schedule should not call notify on import
  const importNotifies = js.includes('bulk_added,{bulkCount:added}') || js.includes('bulk_added", { bulkCount: added');
  return {
    base,
    bundle: m[1],
    hasScheduleUpdatedCopy: js.includes('Schedule updated'),
    hasScheduleChangeType: js.includes('schedule_change'),
    hasSendAnnouncementPush: js.includes('send-announcement-push'),
    importStillNotifies: importNotifies,
    deleteAllStillNotifies: js.includes('cleared", { bulkCount') || js.includes("cleared', { bulkCount"),
    editCallsUpdated: js.includes('updated", {') || js.includes("updated', {") || js.includes('updated",{'),
  };
}

console.log(JSON.stringify(await probe('https://cadmin.kbmcollective.org'), null, 2));
