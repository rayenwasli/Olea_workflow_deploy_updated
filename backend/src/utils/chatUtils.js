const { ChatMessageType } = require('./constants');

function conversationKey(a, b) {
  const min = Math.min(Number(a), Number(b));
  const max = Math.max(Number(a), Number(b));
  return `${min}_${max}`;
}

function toMsgDto(m) {
  return {
    id: m.id,
    senderId: m.sender_id,
    recipientId: m.recipient_id,
    content: m.content,
    type: m.type,
    mediaUrl: m.media_url,
    mimeType: m.mime_type,
    fileName: m.file_name,
    fileSize: m.file_size,
    durationMs: m.duration_ms,
    sentAt: m.sent_at,
    deliveredAt: m.delivered_at ?? null,
    seenAt: m.seen_at ?? null,
    clientMessageId: null,
  };
}

function parseType(raw) {
  if (!raw || String(raw).trim() === '') return ChatMessageType.TEXT;
  const v = String(raw).trim().toUpperCase();
  return ChatMessageType[v] ? v : ChatMessageType.TEXT;
}

module.exports = { conversationKey, toMsgDto, parseType };
