// Groups raw /api/sends rows (one row per recipient) into broadcasts —
// one entry per actual "Send" action, with all its recipients nested inside.
export function groupSendsIntoBroadcasts(sends) {
  const map = new Map();

  for (const s of sends) {
    const key = s.batch_id || `legacy-${s.id}`;
    if (!map.has(key)) {
      map.set(key, {
        batchId: key,
        messageId: s.message_id,
        messageTitle: s.message_title,
        messageType: s.message_type,
        messageText: s.message_text,
        messageAudioUrl: s.message_audio_url,
        messageHasUploadedAudio: s.message_has_uploaded_audio,
        createdAt: s.created_at,
        scheduledAt: s.scheduled_at,
        latestSentAt: s.sent_at,
        recipients: [],
      });
    }
    const broadcast = map.get(key);
    broadcast.recipients.push(s);
    if (s.sent_at && (!broadcast.latestSentAt || new Date(s.sent_at) > new Date(broadcast.latestSentAt))) {
      broadcast.latestSentAt = s.sent_at;
    }
  }

  const broadcasts = [...map.values()];
  for (const b of broadcasts) {
    b.counts = b.recipients.reduce((acc, r) => {
      acc[r.status] = (acc[r.status] || 0) + 1;
      return acc;
    }, {});
    b.total = b.recipients.length;
    b.sortTime = b.scheduledAt || b.latestSentAt || b.createdAt;
  }

  broadcasts.sort((a, b) => new Date(b.sortTime) - new Date(a.sortTime));
  return broadcasts;
}
