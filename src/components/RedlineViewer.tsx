import { DocumentViewer } from "react-docxodus-viewer";
import "react-docxodus-viewer/styles.css";

interface Props {
  file: File | null;
}

/**
 * Renders the redlined DOCX with tracked changes, deletions, and moves visible.
 * docxodus WASM assets are served locally from /wasm (see vite.config.ts).
 */
export function RedlineViewer({ file }: Props) {
  if (!file) {
    return <div className="viewer-placeholder">The redline will appear here.</div>;
  }
  return (
    <DocumentViewer
      file={file}
      wasmBasePath="/wasm"
      showRevisionsTab
      defaultSettings={{
        renderTrackedChanges: true,
        showDeletedContent: true,
        renderMoveOperations: true,
      }}
    />
  );
}
