// Groups raw /api/sends rows (one row per recipient) into broadcasts —
// one entry per actual "Send" action, with all its recipients nested inside.
const TERMINAL_DELIVERY = ['delivered', 'undelivered', 'failed', 'completed', 'busy', 'no-answer', 'canceled'];

function computeOverallStatus(b) {
  const total = b.total;
  const scheduledCount = b.counts.scheduled || 0;
  const canceledCount = b.counts.canceled || 0;

  if (scheduledCount === total && total > 0) return 'scheduled';
  if (canceledCount === total && total > 0) return 'canceled';

  const allResolved = b.recipients.every((r) => {
    if (r.status === 'scheduled') return false;
    if (r.status === 'canceled') return true;
    if (r.status === 'failed') return true;
    return r.delivery_status ? TERMINAL_DELIVERY.includes(r.delivery_status) : false;
  });

  return allResolved ? 'completed' : 'active';
}


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
        messageHasImage: s.message_has_image,
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
    b.totalCost = b.recipients.reduce((sum, r) => sum + (r.cost ? parseFloat(r.cost) : 0), 0);
    b.costUnit = b.recipients.find((r) => r.cost_unit)?.cost_unit || 'USD';

    b.methodCounts = b.recipients.reduce((acc, r) => {
      acc[r.effective_method] = (acc[r.effective_method] || 0) + 1;
      return acc;
    }, {});
    const distinctMethods = Object.keys(b.methodCounts);
    b.singleMethod = distinctMethods.length === 1 ? distinctMethods[0] : null;
    b.overallStatus = computeOverallStatus(b);
  }

  broadcasts.sort((a, b) => new Date(b.sortTime) - new Date(a.sortTime));
  return broadcasts;
}
