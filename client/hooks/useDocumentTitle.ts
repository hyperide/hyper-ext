import { useEffect } from "react";

const baseTitle = "HyperIDE";

/**
 * Updates document title based on current context
 */
export function useDocumentTitle(title: string | null) {
  useEffect(() => {
    if (title) {
      document.title = `${title} - ${baseTitle}`;
    } else {
      document.title = baseTitle;
    }
  }, [title]);
}
