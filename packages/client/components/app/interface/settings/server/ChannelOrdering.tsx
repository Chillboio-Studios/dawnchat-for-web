import { BiRegularListUl } from "solid-icons/bi";
import { Accessor, Setter, Show, createSignal } from "solid-js";

import { Trans } from "@lingui-solid/solid/macro";
import { useModals } from "@revolt/modal";
import type { API } from "stoat.js";
import { styled } from "styled-system/jsx";

import {
  Button,
  CategoryButton,
  Column,
  Draggable,
  Row,
  Text,
  iconSize,
} from "@revolt/ui";
import { createDragHandle } from "@revolt/ui/components/utils/Draggable";

import { ServerSettingsProps } from "../ServerSettings";

type CategoryData = Omit<API.Category, "channels"> & {
  channels: { id: string; name?: string }[];
};

type OrderingEvent =
  | {
      type: "categories";
      ids: string[];
    }
  | {
      type: "category";
      id: string;
      channelIds: string[];
      moved: boolean;
    };

export default function ChannelOrdering(props: ServerSettingsProps) {
  const canManageChannel = () => props.server.havePermission("ManageChannel");
  const { openModal } = useModals();

  function createChannel() {
    openModal({
      type: "create_channel",
      server: props.server,
    });
  }

  function createCategory() {
    openModal({
      type: "create_category",
      server: props.server,
    });
  }

  let heldEvent: (OrderingEvent & { type: "category" }) | undefined;

  function handleOrdering(event: OrderingEvent) {
    const normalisedCategories = props.server.orderedChannels.map(
      (category) => ({
        ...category,
        channels: category.channels.map((channel) => channel.id),
      }),
    );

    if (event.type === "category" && event.moved && !heldEvent) {
      heldEvent = event;
      return;
    }

    if (event.type === "categories") {
      void props.server.edit({
        categories: event.ids
          .map((id) => normalisedCategories.find((cat) => cat.id === id)!)
          .filter(Boolean),
      });
      return;
    }

    void props.server.edit({
      categories: normalisedCategories.map((category) => {
        if (heldEvent && category.id === heldEvent.id) {
          return {
            ...category,
            channels: heldEvent.channelIds,
          };
        }

        if (category.id === event.id) {
          return {
            ...category,
            channels: event.channelIds,
          };
        }

        return category;
      }),
    });

    heldEvent = undefined;
  }

  return (
    <Column gap="lg">
      <Text>
        <Trans>
          Move categories and channels here. Reordering is disabled in the
          channel bar on small screens so scrolling stays smooth.
        </Trans>
      </Text>

      <Row align wrap>
        <Button onPress={createChannel} isDisabled={!canManageChannel()}>
          <Trans>Create channel</Trans>
        </Button>
        <Button onPress={createCategory} isDisabled={!canManageChannel()}>
          <Trans>Create category</Trans>
        </Button>
      </Row>

      <Show
        when={canManageChannel()}
        fallback={
          <Text>
            <Trans>
              You need ManageChannel permission to reorder channels.
            </Trans>
          </Text>
        }
      >
        <Text>
          <Trans>Categories</Trans>
        </Text>

        <Draggable
          dragHandles
          type="category"
          items={props.server.orderedChannels as CategoryData[]}
          onChange={(ids) => handleOrdering({ type: "categories", ids })}
        >
          {(entry) => (
            <ChannelCategory
              category={entry.item}
              dragDisabled={entry.dragDisabled}
              setDragDisabled={entry.setDragDisabled}
              handleOrdering={handleOrdering}
            />
          )}
        </Draggable>
      </Show>
    </Column>
  );
}

function ChannelCategory(props: {
  category: CategoryData;
  dragDisabled: Accessor<boolean>;
  setDragDisabled: Setter<boolean>;
  handleOrdering: (event: OrderingEvent) => void;
}) {
  const [open, setOpen] = createSignal(true);

  return (
    <CategoryShell>
      <Show when={props.category.id !== "default"}>
        <CategoryButton
          icon={<BiRegularListUl {...iconSize(20)} />}
          {...createDragHandle(props.dragDisabled, props.setDragDisabled)}
          onClick={() => setOpen((value) => !value)}
        >
          <Row align justifyContent="space-between" grow>
            <span>{props.category.title}</span>
            <span>{open() ? "-" : "+"}</span>
          </Row>
        </CategoryButton>
      </Show>

      <Show when={open()}>
        <Draggable
          type="channels"
          items={props.category.channels}
          onChange={(channelIds) => {
            const current = props.category.channels;
            props.handleOrdering({
              type: "category",
              id: props.category.id,
              channelIds,
              moved: channelIds.length !== current.length,
            });
          }}
          minimumDropAreaHeight="32px"
        >
          {(entry) => (
            <CategoryButton icon={<BiRegularListUl {...iconSize(20)} />}>
              {entry.item.name || entry.item.id}
            </CategoryButton>
          )}
        </Draggable>
      </Show>
    </CategoryShell>
  );
}

const CategoryShell = styled("div", {
  base: {
    display: "flex",
    flexDirection: "column",
    gap: "var(--gap-sm)",
    padding: "var(--gap-sm)",
    borderRadius: "var(--borderRadius-md)",
    background: "var(--md-sys-color-surface-container-low)",
  },
});
