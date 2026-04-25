const ADMIN_PANEL_BASE = "https://admin.dawn-chat.com/admin";

function buildRecordUrl(resourceId: string, recordId: string) {
  return `${ADMIN_PANEL_BASE}/resources/${encodeURIComponent(resourceId)}/records/${encodeURIComponent(recordId)}/show`;
}

export function openAdminPanelRecord(resourceId: string, recordId?: string | null) {
  if (!recordId) return;
  window.open(buildRecordUrl(resourceId, recordId), "_blank", "noopener,noreferrer");
}

export function openAdminPanelUser(userId?: string | null) {
  openAdminPanelRecord("users", userId);
}

export function openAdminPanelServer(serverId?: string | null) {
  openAdminPanelRecord("servers", serverId);
}

export function openAdminPanelMessage(messageId?: string | null) {
  openAdminPanelRecord("messages", messageId);
}

export function openAdminPanelAttachment(fileId?: string | null) {
  openAdminPanelRecord("attachments", fileId);
}
