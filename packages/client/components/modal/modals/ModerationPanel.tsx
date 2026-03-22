import { For, Show, createEffect, createSignal } from "solid-js";

import { Trans } from "@lingui-solid/solid/macro";
import { styled } from "styled-system/jsx";

import {
  type ModerationBootstrap,
  type ModerationCase,
  type ModeratorRecord,
  applyModerationAction,
  fetchModerationBootstrap,
  fetchModerationCases,
  fetchModerators,
  removeModerator,
  updateModerationCaseStatus,
  upsertModerator,
} from "../../common/lib/moderationApi";

import { useState } from "@revolt/state";
import { Column, Dialog, DialogProps, Row, Text } from "@revolt/ui";

import { useModals } from "..";
import { Modals } from "../types";

const TARGET_TYPES = ["user", "message", "server", "image"] as const;
const ACTION_TYPES = [
  "warn",
  "strike",
  "ban",
  "delete_message",
  "delete_server",
  "delete_image",
  "note",
] as const;

export function ModerationPanelModal(
  props: DialogProps & Modals & { type: "moderation_panel" },
) {
  const state = useState();
  const { showError } = useModals();

  const [bootstrap, setBootstrap] = createSignal<ModerationBootstrap>();
  const [moderators, setModerators] = createSignal<ModeratorRecord[]>([]);
  const [cases, setCases] = createSignal<ModerationCase[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [tab, setTab] = createSignal<
    "overview" | "moderators" | "actions" | "cases"
  >("overview");

  const [moderatorUserId, setModeratorUserId] = createSignal("");
  const [moderatorRole, setModeratorRole] = createSignal<
    "owner" | "admin" | "moderator"
  >("moderator");

  const [caseStatusFilter, setCaseStatusFilter] = createSignal<
    "" | "open" | "investigating" | "resolved" | "dismissed"
  >("");

  const [actionType, setActionType] =
    createSignal<(typeof ACTION_TYPES)[number]>("warn");
  const [targetType, setTargetType] =
    createSignal<(typeof TARGET_TYPES)[number]>("user");
  const [targetId, setTargetId] = createSignal("");
  const [reason, setReason] = createSignal("");
  const [evidence, setEvidence] = createSignal("");

  const session = () => state.auth.getSession();

  async function refresh() {
    const currentSession = session();
    if (!currentSession) return;

    setLoading(true);
    try {
      const [bootstrapPayload, moderatorsPayload, casesPayload] =
        await Promise.all([
          fetchModerationBootstrap(currentSession),
          fetchModerators(currentSession),
          fetchModerationCases(currentSession, {
            status: caseStatusFilter() || undefined,
            targetType: targetType(),
            targetId: targetId().trim() || undefined,
          }),
        ]);

      setBootstrap(bootstrapPayload.item);
      setModerators(moderatorsPayload.items);
      setCases(casesPayload.items);
    } catch (error) {
      showError(error);
    } finally {
      setLoading(false);
    }
  }

  async function addOrUpdateModerator() {
    const currentSession = session();
    const userId = moderatorUserId().trim();
    if (!currentSession || !userId) return;

    setLoading(true);
    try {
      await upsertModerator(currentSession, {
        userId,
        role: moderatorRole(),
      });

      setModeratorUserId("");
      await refresh();
    } catch (error) {
      showError(error);
    } finally {
      setLoading(false);
    }
  }

  async function remove(userId: string) {
    const currentSession = session();
    if (!currentSession) return;

    setLoading(true);
    try {
      await removeModerator(currentSession, userId);
      await refresh();
    } catch (error) {
      showError(error);
    } finally {
      setLoading(false);
    }
  }

  async function applyAction() {
    const currentSession = session();
    if (!currentSession) return;

    const normalizedTargetId = targetId().trim();
    const normalizedReason = reason().trim();
    if (!normalizedTargetId || !normalizedReason) return;

    setLoading(true);
    try {
      await applyModerationAction(currentSession, {
        actionType: actionType(),
        targetType: targetType(),
        targetId: normalizedTargetId,
        reason: normalizedReason,
        evidence: evidence().trim() || undefined,
      });

      setReason("");
      setEvidence("");
      await refresh();
    } catch (error) {
      showError(error);
    } finally {
      setLoading(false);
    }
  }

  async function updateStatus(
    caseId: string,
    status: "open" | "investigating" | "resolved" | "dismissed",
  ) {
    const currentSession = session();
    if (!currentSession) return;

    setLoading(true);
    try {
      await updateModerationCaseStatus(currentSession, caseId, status);
      await refresh();
    } catch (error) {
      showError(error);
    } finally {
      setLoading(false);
    }
  }

  createEffect(() => {
    if (props.show && session()) {
      void refresh();
    }
  });

  createEffect(() => {
    if (!props.show) return;

    if (
      props.targetType === "user" ||
      props.targetType === "message" ||
      props.targetType === "server" ||
      props.targetType === "image"
    ) {
      setTargetType(props.targetType);
    }

    if (typeof props.targetId === "string" && props.targetId.trim()) {
      setTargetId(props.targetId);
    }
  });

  return (
    <Dialog
      show={props.show}
      onClose={props.onClose}
      title={<Trans>Moderation Panel</Trans>}
      minWidth={720}
      actions={[{ text: <Trans>Close</Trans> }]}
      isDisabled={loading()}
    >
      <Show
        when={session()}
        fallback={<Text>Please login to access moderation tools.</Text>}
      >
        <Column gap="md">
          <PanelCard>
            <Row align justifyContent="space-between">
              <Text>
                <strong>Role:</strong> {bootstrap()?.role ?? "none"}
              </Text>
              <Text>
                <strong>Permissions:</strong>{" "}
                {Object.entries(bootstrap()?.scopes ?? {})
                  .filter(([, allowed]) => allowed)
                  .map(([scope]) => scope)
                  .join(", ") || "none"}
              </Text>
            </Row>

            <TabsRow>
              <TabButton
                type="button"
                data-active={tab() === "overview"}
                onClick={() => setTab("overview")}
              >
                Overview
              </TabButton>
              <TabButton
                type="button"
                data-active={tab() === "moderators"}
                onClick={() => setTab("moderators")}
              >
                Moderators
              </TabButton>
              <TabButton
                type="button"
                data-active={tab() === "actions"}
                onClick={() => setTab("actions")}
              >
                Actions
              </TabButton>
              <TabButton
                type="button"
                data-active={tab() === "cases"}
                onClick={() => setTab("cases")}
              >
                Cases
              </TabButton>
            </TabsRow>
          </PanelCard>

          <Show when={tab() === "overview"}>
            <PanelCard>
              <SectionTitle>Quick Status</SectionTitle>
              <SummaryGrid>
                <SummaryTile>
                  <TileLabel>Moderators</TileLabel>
                  <TileValue>{moderators().length}</TileValue>
                </SummaryTile>
                <SummaryTile>
                  <TileLabel>Cases</TileLabel>
                  <TileValue>{cases().length}</TileValue>
                </SummaryTile>
                <SummaryTile>
                  <TileLabel>Open Cases</TileLabel>
                  <TileValue>
                    {cases().filter((entry) => entry.status === "open").length}
                  </TileValue>
                </SummaryTile>
              </SummaryGrid>
            </PanelCard>
          </Show>

          <Show when={tab() === "moderators"}>
            <PanelCard>
              <Show
                when={bootstrap()?.scopes.manageModerators}
                fallback={
                  <Text>You do not have permission to manage moderators.</Text>
                }
              >
                <SectionTitle>Add / Update Moderator</SectionTitle>
                <FormGrid>
                  <label>
                    User ID
                    <Input
                      value={moderatorUserId()}
                      onInput={(event) =>
                        setModeratorUserId(event.currentTarget.value)
                      }
                      placeholder="01XXXXXXXXXXXX"
                    />
                  </label>
                  <label>
                    Role
                    <Select
                      value={moderatorRole()}
                      onInput={(event) =>
                        setModeratorRole(
                          event.currentTarget.value as
                            | "owner"
                            | "admin"
                            | "moderator",
                        )
                      }
                    >
                      <option value="moderator">Moderator</option>
                      <option value="admin">Admin</option>
                      <option value="owner">Owner</option>
                    </Select>
                  </label>
                  <ActionButton
                    type="button"
                    onClick={() => void addOrUpdateModerator()}
                  >
                    Save Moderator
                  </ActionButton>
                </FormGrid>
              </Show>

              <SectionTitle style={{ "margin-top": "var(--gap-md)" }}>
                Current Moderators
              </SectionTitle>
              <For each={moderators()}>
                {(entry) => (
                  <Row align justifyContent="space-between">
                    <Text>
                      {entry.userId} ({entry.role})
                    </Text>
                    <ActionButton
                      type="button"
                      disabled={!bootstrap()?.scopes.manageModerators}
                      onClick={() => void remove(entry.userId)}
                    >
                      Remove
                    </ActionButton>
                  </Row>
                )}
              </For>
            </PanelCard>
          </Show>

          <Show when={tab() === "actions"}>
            <PanelCard>
              <SectionTitle>Moderate Content</SectionTitle>
              <FormGrid>
                <label>
                  Target Type
                  <Select
                    value={targetType()}
                    onInput={(event) =>
                      setTargetType(
                        event.currentTarget
                          .value as (typeof TARGET_TYPES)[number],
                      )
                    }
                  >
                    <For each={TARGET_TYPES}>
                      {(entry) => <option value={entry}>{entry}</option>}
                    </For>
                  </Select>
                </label>
                <label>
                  Target ID
                  <Input
                    value={targetId()}
                    onInput={(event) => setTargetId(event.currentTarget.value)}
                    placeholder="Object ID"
                  />
                </label>
                <label>
                  Action
                  <Select
                    value={actionType()}
                    onInput={(event) =>
                      setActionType(
                        event.currentTarget
                          .value as (typeof ACTION_TYPES)[number],
                      )
                    }
                  >
                    <For each={ACTION_TYPES}>
                      {(entry) => <option value={entry}>{entry}</option>}
                    </For>
                  </Select>
                </label>
                <label>
                  Reason
                  <Input
                    value={reason()}
                    onInput={(event) => setReason(event.currentTarget.value)}
                    placeholder="Policy violation"
                  />
                </label>
                <label>
                  Evidence URL/Note
                  <Input
                    value={evidence()}
                    onInput={(event) => setEvidence(event.currentTarget.value)}
                    placeholder="Optional"
                  />
                </label>
                <ActionButton type="button" onClick={() => void applyAction()}>
                  Apply Action
                </ActionButton>
              </FormGrid>
            </PanelCard>
          </Show>

          <Show when={tab() === "cases"}>
            <PanelCard>
              <Row align justifyContent="space-between">
                <SectionTitle>Cases</SectionTitle>
                <Row align>
                  <Select
                    value={caseStatusFilter()}
                    onInput={(event) =>
                      setCaseStatusFilter(
                        event.currentTarget.value as
                          | ""
                          | "open"
                          | "investigating"
                          | "resolved"
                          | "dismissed",
                      )
                    }
                  >
                    <option value="">All</option>
                    <option value="open">Open</option>
                    <option value="investigating">Investigating</option>
                    <option value="resolved">Resolved</option>
                    <option value="dismissed">Dismissed</option>
                  </Select>
                  <ActionButton type="button" onClick={() => void refresh()}>
                    Refresh
                  </ActionButton>
                </Row>
              </Row>

              <CasesList>
                <For each={cases()}>
                  {(entry) => (
                    <CaseItem>
                      <Text>
                        <strong>{entry.id}</strong> {entry.target.type}:
                        {entry.target.id}
                      </Text>
                      <Text>
                        {entry.status} - {entry.reason}
                      </Text>
                      <Show when={bootstrap()?.scopes.manageCases}>
                        <Row align>
                          <ActionButton
                            type="button"
                            onClick={() =>
                              void updateStatus(entry.id, "investigating")
                            }
                          >
                            Investigating
                          </ActionButton>
                          <ActionButton
                            type="button"
                            onClick={() =>
                              void updateStatus(entry.id, "resolved")
                            }
                          >
                            Resolve
                          </ActionButton>
                          <ActionButton
                            type="button"
                            onClick={() =>
                              void updateStatus(entry.id, "dismissed")
                            }
                          >
                            Dismiss
                          </ActionButton>
                        </Row>
                      </Show>
                    </CaseItem>
                  )}
                </For>
              </CasesList>
            </PanelCard>
          </Show>
        </Column>
      </Show>
    </Dialog>
  );
}

const PanelCard = styled("div", {
  base: {
    borderRadius: "var(--borderRadius-lg)",
    border: "1px solid var(--md-sys-color-outline-variant)",
    padding: "var(--gap-md)",
    background: "var(--md-sys-color-surface-container)",
  },
});

const SectionTitle = styled("h3", {
  base: {
    margin: 0,
    marginBottom: "var(--gap-sm)",
    fontSize: "1rem",
  },
});

const TabsRow = styled("div", {
  base: {
    marginTop: "var(--gap-sm)",
    display: "flex",
    flexWrap: "wrap",
    gap: "8px",
  },
});

const TabButton = styled("button", {
  base: {
    border: "1px solid var(--md-sys-color-outline-variant)",
    borderRadius: "999px",
    padding: "6px 12px",
    cursor: "pointer",
    background: "var(--md-sys-color-surface-container-high)",
    color: "var(--md-sys-color-on-surface)",
    '&[data-active="true"]': {
      background: "var(--md-sys-color-primary-container)",
      color: "var(--md-sys-color-on-primary-container)",
      borderColor: "var(--md-sys-color-primary)",
    },
  },
});

const SummaryGrid = styled("div", {
  base: {
    display: "grid",
    gap: "var(--gap-sm)",
    gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
  },
});

const SummaryTile = styled("div", {
  base: {
    border: "1px solid var(--md-sys-color-outline-variant)",
    borderRadius: "var(--borderRadius-md)",
    background: "var(--md-sys-color-surface-container-high)",
    padding: "10px",
  },
});

const TileLabel = styled("div", {
  base: {
    fontSize: "12px",
    color: "var(--md-sys-color-on-surface-variant)",
  },
});

const TileValue = styled("div", {
  base: {
    fontSize: "22px",
    fontWeight: 700,
    color: "var(--md-sys-color-on-surface)",
  },
});

const FormGrid = styled("div", {
  base: {
    display: "grid",
    gap: "var(--gap-sm)",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  },
});

const Input = styled("input", {
  base: {
    width: "100%",
    border: "1px solid var(--md-sys-color-outline-variant)",
    borderRadius: "var(--borderRadius-md)",
    padding: "8px 10px",
    marginTop: "4px",
    background: "var(--md-sys-color-surface-container-high)",
    color: "var(--md-sys-color-on-surface)",
  },
});

const Select = styled("select", {
  base: {
    width: "100%",
    border: "1px solid var(--md-sys-color-outline-variant)",
    borderRadius: "var(--borderRadius-md)",
    padding: "8px 10px",
    marginTop: "4px",
    background: "var(--md-sys-color-surface-container-high)",
    color: "var(--md-sys-color-on-surface)",
  },
});

const ActionButton = styled("button", {
  base: {
    border: "1px solid var(--md-sys-color-outline-variant)",
    borderRadius: "var(--borderRadius-md)",
    background: "var(--md-sys-color-secondary-container)",
    color: "var(--md-sys-color-on-secondary-container)",
    padding: "8px 10px",
    cursor: "pointer",
  },
});

const CasesList = styled("div", {
  base: {
    display: "flex",
    flexDirection: "column",
    gap: "var(--gap-sm)",
    maxHeight: "280px",
    overflow: "auto",
  },
});

const CaseItem = styled("div", {
  base: {
    border: "1px solid var(--md-sys-color-outline-variant)",
    borderRadius: "var(--borderRadius-md)",
    padding: "var(--gap-sm)",
    background: "var(--md-sys-color-surface-container-high)",
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  },
});
