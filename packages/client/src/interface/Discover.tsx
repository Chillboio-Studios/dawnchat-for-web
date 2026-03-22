import { styled } from "styled-system/jsx";

import { Trans } from "@lingui-solid/solid/macro";
import { useNavigate } from "@revolt/routing";
import { Button } from "@revolt/ui";

/**
 * Discover placeholder
 */
export function Discover() {
  const navigate = useNavigate();

  return (
    <Base>
      <Card>
        <Title>
          <Trans>We are working on Discover</Trans>
        </Title>
        <Description>
          <Trans>
            This section is not available yet. Please check back soon.
          </Trans>
        </Description>
        <Button onPress={() => navigate("/")}>
          <Trans>Back to Home</Trans>
        </Button>
      </Card>
    </Base>
  );
}

const Base = styled("div", {
  base: {
    width: "100%",
    minHeight: "100%",
    flexGrow: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "24px",
  },
});

const Card = styled("div", {
  base: {
    width: "100%",
    maxWidth: "560px",
    padding: "28px",
    borderRadius: "var(--borderRadius-lg)",
    background: "var(--md-sys-color-surface-container)",
    border: "1px solid var(--md-sys-color-outline-variant)",
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    alignItems: "flex-start",
  },
});

const Title = styled("h1", {
  base: {
    margin: 0,
    fontSize: "24px",
    lineHeight: 1.2,
    color: "var(--md-sys-color-on-surface)",
  },
});

const Description = styled("p", {
  base: {
    margin: 0,
    color: "var(--md-sys-color-on-surface-variant)",
    lineHeight: 1.5,
  },
});
