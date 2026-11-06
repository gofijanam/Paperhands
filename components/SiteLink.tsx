import type { ComponentProps } from "react";

// Document navigation avoids the production RSC router failure.
// Native anchors preserve keyboard, modifier-click and hash behavior.
export default function SiteLink(props: ComponentProps<"a">) {
  return <a {...props} />;
}
