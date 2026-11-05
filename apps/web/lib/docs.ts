import { filesApi, type Doc } from "@/lib/api";
import { showToast } from "@/lib/toast";

/** "Coding › Apps › Pharmacy" — where a doc lives, as far as it goes. */
export function docPlace(d: Pick<Doc, "spaceName" | "folderName" | "listName">): string {
  return [d.spaceName, d.folderName, d.listName].filter(Boolean).join(" › ");
}

/** Tell open views (the sidebar tree) that docs changed. */
export function docsChanged(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event("stackup:docs-changed"));
}

/** Open an uploaded document: PDFs/images view in a new tab, else download. */
export async function openUploadedDoc(d: Doc): Promise<void> {
  if (!d.fileId) return;
  try {
    const url = await filesApi.blobUrl(d.fileId);
    const m = (d.fileMime ?? "").toLowerCase();
    if (m === "application/pdf" || m.startsWith("image/")) {
      window.open(url, "_blank", "noopener");
    } else {
      const a = document.createElement("a");
      a.href = url;
      a.download = d.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    }
  } catch {
    showToast("Couldn't open the document.");
  }
}
