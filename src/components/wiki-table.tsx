import type { ComponentPropsWithoutRef } from "react";
import type { ExtraProps } from "react-markdown";

export function WikiTable({
  node,
  ...props
}: ComponentPropsWithoutRef<"table"> & ExtraProps) {
  void node;

  return (
    <div className="wiki-table-scroll" role="region" aria-label="Scrollable table" tabIndex={0}>
      <table {...props} />
    </div>
  );
}
