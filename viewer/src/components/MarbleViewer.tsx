import type { SceneData } from "../types.js";

interface Props {
  marbleUrl: string;
  sceneData: SceneData;
}

// Renders the Marble world in a full-screen iframe.
// The iframe src is the world_marble_url returned by MarbleProvider.
// Pointer events on the iframe are passed through normally; overlay children
// are positioned on top via CSS z-index.
export function MarbleViewer({ marbleUrl }: Props) {
  return (
    <iframe
      src={marbleUrl}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        border: "none",
        display: "block",
      }}
      allow="fullscreen"
      title="Marble 3D World"
    />
  );
}
