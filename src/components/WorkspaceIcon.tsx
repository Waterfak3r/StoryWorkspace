"use client";

import { Archive, ArrowLeft, Books, PencilLine } from "@phosphor-icons/react";

type WorkspaceIconName = "archive" | "back" | "books" | "pencil";

export function WorkspaceIcon({ name, size = 18, className }: { name: WorkspaceIconName; size?: number; className?: string }) {
  const Icon = {
    archive: Archive,
    back: ArrowLeft,
    books: Books,
    pencil: PencilLine,
  }[name];

  return <Icon size={size} weight="regular" className={className} />;
}
