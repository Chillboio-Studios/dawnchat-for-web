import { createResource, createSignal, For, Show } from "solid-js";

import { useNavigate } from "@solidjs/router";
import { Trans } from "@lingui-solid/solid/macro";

import { useClient } from "@revolt/client";
import { Button, CategoryButtonGroup, Column, Row, Text } from "@revolt/ui";

const ADMIN_API =
  import.meta.env.VITE_ADMIN_API_URL || "https://admin.dawn-chat.com/api";

type AdminUser = {
  id: string;
  username: string;
  discriminator: string;
  display_name?: string;
  flags?: number;
  privileged?: boolean;
};

type AdminServer = {
  id: string;
  name: string;
  owner: string;
  description?: string;
};

type AdminFile = {
  id: string;
  filename: string;
  content_type: string;
  size: number;
  uploader_id?: string;
};

type AdminRole = {
  key: string;
  name: string;
  description: string;
  permissions: string[];
};

type AdminIdentity = {
  user: AdminUser;
  roles: string[];
  permissions: string[];
};

type RoleAssignment = {
  user_id: string;
  role_keys: string[];
};

function formatBytes(bytes: number) {
  if (bytes <= 0) return "0 B";
  const sizes = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), sizes.length - 1);
  return `${(bytes / Math.pow(1024, index)).toFixed(1)} ${sizes[index]}`;
}

export function AdminPanel() {
  const client = useClient();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = createSignal<"dashboard" | "users" | "servers" | "files" | "access">("dashboard");
  const [error, setError] = createSignal<string | null>(null);

  const [searchQuery, setSearchQuery] = createSignal("");
  const [users, setUsers] = createSignal<AdminUser[]>([]);
  const [servers, setServers] = createSignal<AdminServer[]>([]);
  const [files, setFiles] = createSignal<AdminFile[]>([]);
  const [selectedUser, setSelectedUser] = createSignal<AdminUser | null>(null);

  const [accessQuery, setAccessQuery] = createSignal("");
  const [accessUsers, setAccessUsers] = createSignal<AdminUser[]>([]);
  const [targetAdminUser, setTargetAdminUser] = createSignal<AdminUser | null>(null);
  const [roles, setRoles] = createSignal<AdminRole[]>([]);
  const [assignedRoleKeys, setAssignedRoleKeys] = createSignal<string[]>([]);
  const [busy, setBusy] = createSignal(false);

  const [me] = createResource(async () => {
    setError(null);
    const [header, token] = client().authenticationHeader;
    if (header !== "X-Session-Token") {
      throw new Error("Admin panel requires a user session.");
    }

    const response = await fetch(`${ADMIN_API}/me`, {
      headers: {
        [header]: token,
      },
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(text || `Admin API error: ${response.status}`);
    }

    return (text ? JSON.parse(text) : {}) as AdminIdentity;
  });

  const hasPermission = (permission: string) => !!me()?.permissions?.includes(permission);

  async function adminFetch<T>(endpoint: string, init?: RequestInit): Promise<T> {
    const [header, token] = client().authenticationHeader;
    if (header !== "X-Session-Token") {
      throw new Error("Admin panel requires a user session.");
    }

    const response = await fetch(`${ADMIN_API}${endpoint}`, {
      ...init,
      headers: {
        ...init?.headers,
        [header]: token,
      },
    });

    const text = await response.text();
    if (!response.ok) {
      try {
        const parsed = JSON.parse(text);
        throw new Error(parsed.error || text || `Admin API error: ${response.status}`);
      } catch {
        throw new Error(text || `Admin API error: ${response.status}`);
      }
    }

    return text ? JSON.parse(text) : ({} as T);
  }

  async function loadRoles() {
    const payload = await adminFetch<{ roles: AdminRole[] }>("/roles");
    setRoles(payload.roles || []);
  }

  async function searchUsers() {
    const query = searchQuery().trim();
    if (query.length < 2) return;

    try {
      setBusy(true);
      const payload = await adminFetch<{ users: AdminUser[] }>(`/users/search?q=${encodeURIComponent(query)}`);
      setUsers(payload.users || []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function searchServers() {
    const query = searchQuery().trim();
    if (query.length < 2) return;

    try {
      setBusy(true);
      const payload = await adminFetch<{ servers: AdminServer[] }>(`/servers/search?q=${encodeURIComponent(query)}`);
      setServers(payload.servers || []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function searchFiles() {
    const query = searchQuery().trim();
    if (query.length < 2) return;

    try {
      setBusy(true);
      const payload = await adminFetch<{ files: AdminFile[] }>(`/files/search?q=${encodeURIComponent(query)}`);
      setFiles(payload.files || []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function refreshUserDetail(id: string) {
    try {
      const user = await adminFetch<AdminUser>(`/users/${id}`);
      setSelectedUser(user);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function warnUser(user: AdminUser) {
    const reason = prompt("Warning reason:");
    if (!reason) return;

    try {
      await adminFetch(`/users/${user.id}/warn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason, send_email: true, send_dm: true }),
      });
      alert("Warning sent.");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function banUser(user: AdminUser) {
    const reason = prompt("Ban reason:");
    if (!reason) return;
    const duration = prompt("Duration in days (blank = permanent):", "");
    const durationDays = duration?.trim() ? Number(duration) : 0;

    try {
      await adminFetch(`/users/${user.id}/ban`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason,
          duration_days: Number.isFinite(durationDays) ? durationDays : 0,
          logout_sessions: true,
          disconnect_voice: true,
          send_email: true,
        }),
      });
      await refreshUserDetail(user.id);
      alert("User banned and sessions revoked.");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function unbanUser(user: AdminUser) {
    try {
      await adminFetch(`/users/${user.id}/unban`, { method: "POST" });
      await refreshUserDetail(user.id);
      alert("User unbanned.");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function logoutUser(user: AdminUser) {
    try {
      await adminFetch(`/users/${user.id}/logout`, { method: "POST" });
      alert("User sessions revoked.");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function deleteServer(server: AdminServer) {
    if (!confirm(`Delete server ${server.name}?`)) return;

    try {
      await adminFetch(`/servers/${server.id}`, { method: "DELETE" });
      setServers((prev) => prev.filter((entry) => entry.id !== server.id));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function deleteFile(file: AdminFile) {
    if (!confirm(`Delete file ${file.filename}?`)) return;

    try {
      await adminFetch(`/files/${file.id}`, { method: "DELETE" });
      setFiles((prev) => prev.filter((entry) => entry.id !== file.id));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function searchAdminUsers() {
    const query = accessQuery().trim();
    if (query.length < 2) return;

    try {
      setBusy(true);
      const payload = await adminFetch<{ users: AdminUser[] }>(`/admin-users/search?q=${encodeURIComponent(query)}`);
      setAccessUsers(payload.users || []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function selectAdminUser(user: AdminUser) {
    setTargetAdminUser(user);
    try {
      const payload = await adminFetch<{ assignment: RoleAssignment }>(`/admin-users/${user.id}/roles`);
      setAssignedRoleKeys(payload.assignment?.role_keys || []);
    } catch (e) {
      setError((e as Error).message);
      setAssignedRoleKeys([]);
    }
  }

  async function saveRoleAssignment() {
    const user = targetAdminUser();
    if (!user) return;

    try {
      await adminFetch(`/admin-users/${user.id}/roles`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role_keys: assignedRoleKeys() }),
      });
      alert("Admin role assignment saved.");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function toggleRole(roleKey: string) {
    setAssignedRoleKeys((prev) =>
      prev.includes(roleKey) ? prev.filter((key) => key !== roleKey) : [...prev, roleKey],
    );
  }

  if (me.loading) {
    return (
      <Column gap="lg" style={{ padding: "var(--gap-lg)" }}>
        <Text>Loading admin panel...</Text>
      </Column>
    );
  }

  if (me.error || !me() || !client().user?.privileged) {
    return (
      <Column gap="lg" style={{ padding: "var(--gap-lg)" }}>
        <Text>Access denied</Text>
        <Text>
          {me.error
            ? String(me.error)
            : "You are not allowed to use the admin panel."}
        </Text>
        <Button onPress={() => navigate("/app")}>Back to App</Button>
      </Column>
    );
  }

  return (
    <Column gap="lg" style={{ padding: "var(--gap-lg)" }}>
      <CategoryButtonGroup>
        <Text>DawnChat Admin</Text>
      </CategoryButtonGroup>

      <Row gap="sm" style={{ "flex-wrap": "wrap" }}>
        <Button variant="tonal" onPress={() => setActiveTab("dashboard")}>
          Dashboard
        </Button>
        <Button variant="tonal" onPress={() => setActiveTab("users")}>
          Users
        </Button>
        <Button variant="tonal" onPress={() => setActiveTab("servers")}>
          Servers
        </Button>
        <Button variant="tonal" onPress={() => setActiveTab("files")}>
          Files
        </Button>
        <Button
          variant="tonal"
          onPress={() => {
            setActiveTab("access");
            loadRoles();
          }}
        >
          Access
        </Button>
      </Row>

      <Show when={error()}>
        <div style={{ color: "var(--md-sys-color-error)" }}>{error()}</div>
      </Show>

      <Show when={activeTab() === "dashboard"}>
        <Column gap="sm">
          <Text>
            Signed in as: {me()!.user.username}#{me()!.user.discriminator}
          </Text>
          <Text>Roles: {(me()!.roles || []).join(", ") || "none"}</Text>
          <Text>
            Permissions: {(me()!.permissions || []).join(", ") || "none"}
          </Text>
        </Column>
      </Show>

      <Show when={activeTab() === "users"}>
        <Column gap="md">
          <Row gap="sm">
            <input
              type="text"
              placeholder="Search users"
              value={searchQuery()}
              onInput={(event) => setSearchQuery(event.currentTarget.value)}
              onKeyDown={(event) => event.key === "Enter" && searchUsers()}
              style={{
                flex: 1,
                padding: "var(--gap-sm)",
                border: "1px solid var(--md-sys-color-outline)",
                "border-radius": "var(--borderRadius-sm)",
                background: "transparent",
                color: "var(--md-sys-color-on-surface)",
              }}
            />
            <Button isDisabled={busy()} onPress={searchUsers}>
              Search
            </Button>
          </Row>

          <For each={users()}>
            {(user) => (
              <Row
                gap="sm"
                style={{
                  padding: "var(--gap-sm)",
                  background: "var(--md-sys-color-surface-container)",
                  "border-radius": "var(--borderRadius-sm)",
                }}
              >
                <Column style={{ flex: 1 }}>
                  <Text>
                    {user.username}#{user.discriminator}
                  </Text>
                  <div style={{ "font-size": "0.8em" }}>{user.id}</div>
                </Column>
                <Button onPress={() => setSelectedUser(user)}>Manage</Button>
              </Row>
            )}
          </For>

          <Show when={selectedUser()}>
            <Column
              gap="sm"
              style={{
                padding: "var(--gap-md)",
                background: "var(--md-sys-color-surface-container-high)",
                "border-radius": "var(--borderRadius-md)",
              }}
            >
              <Text>
                Managing {selectedUser()!.username}#{selectedUser()!.discriminator}
              </Text>
              <Row gap="sm" style={{ "flex-wrap": "wrap" }}>
                <Show when={hasPermission("users.warn")}>
                  <Button onPress={() => warnUser(selectedUser()!)}>
                    Warn
                  </Button>
                </Show>
                <Show when={hasPermission("users.ban")}>
                  <Button onPress={() => banUser(selectedUser()!)}>Ban</Button>
                </Show>
                <Show when={hasPermission("users.unban")}>
                  <Button onPress={() => unbanUser(selectedUser()!)}>
                    Unban
                  </Button>
                </Show>
                <Show when={hasPermission("users.logout")}>
                  <Button onPress={() => logoutUser(selectedUser()!)}>
                    Force Logout
                  </Button>
                </Show>
              </Row>
            </Column>
          </Show>
        </Column>
      </Show>

      <Show when={activeTab() === "servers"}>
        <Column gap="md">
          <Row gap="sm">
            <input
              type="text"
              placeholder="Search servers"
              value={searchQuery()}
              onInput={(event) => setSearchQuery(event.currentTarget.value)}
              onKeyDown={(event) => event.key === "Enter" && searchServers()}
              style={{
                flex: 1,
                padding: "var(--gap-sm)",
                border: "1px solid var(--md-sys-color-outline)",
                "border-radius": "var(--borderRadius-sm)",
                background: "transparent",
                color: "var(--md-sys-color-on-surface)",
              }}
            />
            <Button isDisabled={busy()} onPress={searchServers}>
              Search
            </Button>
          </Row>

          <For each={servers()}>
            {(server) => (
              <Row
                gap="sm"
                style={{
                  padding: "var(--gap-sm)",
                  background: "var(--md-sys-color-surface-container)",
                  "border-radius": "var(--borderRadius-sm)",
                }}
              >
                <Column style={{ flex: 1 }}>
                  <Text>{server.name}</Text>
                  <div style={{ "font-size": "0.8em" }}>ID: {server.id}</div>
                </Column>
                <Show when={hasPermission("servers.delete")}>
                  <Button onPress={() => deleteServer(server)}>Delete</Button>
                </Show>
              </Row>
            )}
          </For>
        </Column>
      </Show>

      <Show when={activeTab() === "files"}>
        <Column gap="md">
          <Row gap="sm">
            <input
              type="text"
              placeholder="Search files"
              value={searchQuery()}
              onInput={(event) => setSearchQuery(event.currentTarget.value)}
              onKeyDown={(event) => event.key === "Enter" && searchFiles()}
              style={{
                flex: 1,
                padding: "var(--gap-sm)",
                border: "1px solid var(--md-sys-color-outline)",
                "border-radius": "var(--borderRadius-sm)",
                background: "transparent",
                color: "var(--md-sys-color-on-surface)",
              }}
            />
            <Button isDisabled={busy()} onPress={searchFiles}>
              Search
            </Button>
          </Row>

          <For each={files()}>
            {(file) => (
              <Row
                gap="sm"
                style={{
                  padding: "var(--gap-sm)",
                  background: "var(--md-sys-color-surface-container)",
                  "border-radius": "var(--borderRadius-sm)",
                }}
              >
                <Column style={{ flex: 1 }}>
                  <Text>{file.filename}</Text>
                  <div style={{ "font-size": "0.8em" }}>
                    {file.content_type} • {formatBytes(file.size)}
                  </div>
                </Column>
                <Show when={hasPermission("files.delete")}>
                  <Button onPress={() => deleteFile(file)}>Delete</Button>
                </Show>
              </Row>
            )}
          </For>
        </Column>
      </Show>

      <Show when={activeTab() === "access"}>
        <Column gap="md">
          <Text>Assign admin roles to platform users</Text>
          <Row gap="sm">
            <input
              type="text"
              placeholder="Search user for admin access"
              value={accessQuery()}
              onInput={(event) => setAccessQuery(event.currentTarget.value)}
              onKeyDown={(event) => event.key === "Enter" && searchAdminUsers()}
              style={{
                flex: 1,
                padding: "var(--gap-sm)",
                border: "1px solid var(--md-sys-color-outline)",
                "border-radius": "var(--borderRadius-sm)",
                background: "transparent",
                color: "var(--md-sys-color-on-surface)",
              }}
            />
            <Button isDisabled={busy()} onPress={searchAdminUsers}>
              Search
            </Button>
          </Row>

          <For each={accessUsers()}>
            {(user) => (
              <Row
                gap="sm"
                style={{
                  padding: "var(--gap-sm)",
                  background: "var(--md-sys-color-surface-container)",
                  "border-radius": "var(--borderRadius-sm)",
                }}
              >
                <Column style={{ flex: 1 }}>
                  <Text>
                    {user.username}#{user.discriminator}
                  </Text>
                  <div style={{ "font-size": "0.8em" }}>{user.id}</div>
                </Column>
                <Button onPress={() => selectAdminUser(user)}>Assign Roles</Button>
              </Row>
            )}
          </For>

          <Show when={targetAdminUser()}>
            <Column
              gap="sm"
              style={{
                padding: "var(--gap-md)",
                background: "var(--md-sys-color-surface-container-high)",
                "border-radius": "var(--borderRadius-md)",
              }}
            >
              <Text>
                Assigning roles to {targetAdminUser()!.username}#{targetAdminUser()!.discriminator}
              </Text>

              <For each={roles()}>
                {(role) => (
                  <label
                    style={{
                      display: "flex",
                      gap: "var(--gap-sm)",
                      "align-items": "flex-start",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={assignedRoleKeys().includes(role.key)}
                      onChange={() => toggleRole(role.key)}
                    />
                    <Column gap="none">
                      <Text>
                        {role.name} ({role.key})
                      </Text>
                      <Show when={role.description}>
                        <div style={{ "font-size": "0.8em" }}>{role.description}</div>
                      </Show>
                    </Column>
                  </label>
                )}
              </For>

              <Button onPress={saveRoleAssignment}>Save Role Assignment</Button>
            </Column>
          </Show>
        </Column>
      </Show>
    </Column>
  );
}
