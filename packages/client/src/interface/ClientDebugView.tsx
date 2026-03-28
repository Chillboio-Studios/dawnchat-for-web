import { useUser } from "@revolt/client";
import { useVoice } from "@revolt/rtc";
import { Button, Column, Row, Text } from "@revolt/ui";
import {
  For,
  Show,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";

import {
  type ClientDebugEvent,
  clearClientDebugEvents,
  enableClientDebugInstrumentation,
  getClientDebugSnapshot,
  subscribeClientDebugEvents,
} from "../debug/clientDebug";

const categories = [
  "all",
  "api",
  "voice",
  "error",
  "console",
  "system",
] as const;
type FilterCategory = (typeof categories)[number];

function formatTime(epochMs: number) {
  return new Date(epochMs).toLocaleTimeString();
}

export function ClientDebugView() {
  const user = useUser();
  const voice = useVoice();

  const [events, setEvents] = createSignal<ClientDebugEvent[]>(
    getClientDebugSnapshot(),
  );
  const [filter, setFilter] = createSignal<FilterCategory>("all");

  onMount(() => {
    enableClientDebugInstrumentation();

    const dispose = subscribeClientDebugEvents(setEvents);
    onCleanup(dispose);
  });

  const filteredEvents = createMemo(() => {
    const selected = filter();
    const source = events();
    if (selected === "all") return source;
    return source.filter((event) => event.category === selected);
  });

  const errorCount = createMemo(
    () => events().filter((event) => event.level === "error").length,
  );

  const voiceChannelId = createMemo(() => voice.channel()?.id || "(none)");

  return (
    <Column style={{ padding: "20px", gap: "12px", height: "100%" }}>
      <Row align style={{ "justify-content": "space-between", gap: "8px" }}>
        <Column style={{ gap: "4px" }}>
          <h1 style={{ margin: 0, "font-size": "20px" }}>Client Debug View</h1>
          <Text>
            User: {user()?.username}#{user()?.discriminator}
          </Text>
        </Column>
        <Row align style={{ gap: "8px" }}>
          <Button variant="outlined" onPress={() => clearClientDebugEvents()}>
            Clear Logs
          </Button>
          <Button
            variant="filled"
            onPress={() => {
              const payload = JSON.stringify(events(), null, 2);
              const blob = new Blob([payload], {
                type: "application/json",
              });
              const url = URL.createObjectURL(blob);
              const anchor = document.createElement("a");
              anchor.href = url;
              anchor.download = `client-debug-${Date.now()}.json`;
              anchor.click();
              URL.revokeObjectURL(url);
            }}
          >
            Export JSON
          </Button>
        </Row>
      </Row>

      <Row align style={{ gap: "14px", "flex-wrap": "wrap" }}>
        <Text>Total events: {events().length}</Text>
        <Text>Error events: {errorCount()}</Text>
        <Text>Voice channel: {voiceChannelId()}</Text>
      </Row>

      <Row align style={{ gap: "8px", "flex-wrap": "wrap" }}>
        <For each={categories}>
          {(category) => (
            <Button
              variant={filter() === category ? "filled" : "outlined"}
              onPress={() => setFilter(category)}
            >
              {category}
            </Button>
          )}
        </For>
      </Row>

      <Column
        style={{
          overflow: "auto",
          border: "1px solid var(--md-sys-color-outline-variant)",
          "border-radius": "12px",
          "background-color": "var(--md-sys-color-surface-container-lowest)",
        }}
      >
        <Show
          when={filteredEvents().length > 0}
          fallback={<div style={{ padding: "12px" }}>No events yet.</div>}
        >
          <For each={[...filteredEvents()].reverse()}>
            {(event) => (
              <Column
                style={{
                  padding: "10px 12px",
                  "border-bottom":
                    "1px solid var(--md-sys-color-outline-variant)",
                  gap: "4px",
                }}
              >
                <Row
                  align
                  style={{ "justify-content": "space-between", gap: "8px" }}
                >
                  <div style={{ "font-weight": 600 }}>
                    [{event.level.toUpperCase()}] {event.category}
                  </div>
                  <div style={{ opacity: 0.8 }}>{formatTime(event.at)}</div>
                </Row>
                <Text>{event.title}</Text>
                <Show when={event.details}>
                  <div style={{ opacity: 0.85 }}>{event.details}</div>
                </Show>
                <Show when={event.data}>
                  <pre
                    style={{
                      margin: 0,
                      padding: "8px",
                      overflow: "auto",
                      "font-size": "11px",
                      "border-radius": "8px",
                      "background-color":
                        "var(--md-sys-color-surface-container)",
                    }}
                  >
                    {JSON.stringify(event.data, null, 2)}
                  </pre>
                </Show>
              </Column>
            )}
          </For>
        </Show>
      </Column>
    </Column>
  );
}
