const { SignalHouseSDK } = require('@signalhousellc/sdk');

const sdk = new SignalHouseSDK({
  apiKey: process.env.SIGNALHOUSE_API_KEY,
  baseUrl: process.env.SIGNALHOUSE_BASE_URL,
});

const SUBGROUP_ID = process.env.SIGNALHOUSE_SUBGROUP_ID;

// Sends an SMS. Returns { status: 'sent' | 'failed', messageId, error_message }
async function sendSMS({ from, to, body, statusCallbackUrl }) {
  const result = await sdk.messages.sendSMS({
    senderPhoneNumber: from,
    recipientPhoneNumbers: to,
    messageBody: body,
    statusCallbackUrl,
  });

  if (!result.success) {
    return { status: 'failed', error_message: result.error || 'Signal House request failed' };
  }

  const data = result.data;
  if (!data.enqueuedCount || data.enqueuedCount === 0) {
    const failedMsg = data.insertedMessages?.[0];
    return { status: 'failed', error_message: failedMsg?.errorCode || 'Message was blocked or not enqueued' };
  }

  const messageId = data.insertedMessages?.[0]?.id || data.insertedMessages?.[0]?._id || null;
  return { status: 'sent', messageId };
}

// Sends an MMS with mediaUrls (array of URLs) — used since we proxy
// audio/image from our own server rather than uploading raw files here.
async function sendMMS({ from, to, body, mediaUrls, statusCallbackUrl }) {
  const result = await sdk.messages.sendMMS({
    senderPhoneNumber: from,
    recipientPhoneNumbers: to,
    messageBody: body,
    mediaUrls,
    statusCallbackUrl,
  });

  if (!result.success) {
    return { status: 'failed', error_message: result.error || 'Signal House request failed' };
  }

  const data = result.data;
  if (!data.enqueuedCount || data.enqueuedCount === 0) {
    const failedMsg = data.insertedMessages?.[0];
    return { status: 'failed', error_message: failedMsg?.errorCode || 'Message was blocked or not enqueued' };
  }

  const messageId = data.insertedMessages?.[0]?.id || data.insertedMessages?.[0]?._id || null;
  return { status: 'sent', messageId };
}

module.exports = { sdk, sendSMS, sendMMS, SUBGROUP_ID };