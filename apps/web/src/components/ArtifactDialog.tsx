import { useEffect, useRef, useState } from "react";
import { api, sha256Hex } from "../api";
import { Markdown } from "./Markdown";
import { Mono } from "./primitives";

type Artifact = Awaited<ReturnType<typeof api.artifact>>;

/** Native <dialog>: focus is trapped and restored by the browser, Escape closes it. */
export function ArtifactDialog({ artifactId, onClose }: { artifactId: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [verified, setVerified] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    ref.current?.showModal();
    let live = true;
    api
      .artifact(artifactId)
      .then(async (a) => {
        if (!live) return;
        setArtifact(a);
        setVerified((await sha256Hex(a.content)) === a.sha256);
      })
      .catch(() => live && setError("This file could not be loaded."));
    return () => {
      live = false;
    };
  }, [artifactId]);

  return (
    <dialog ref={ref} className="sheet" aria-labelledby="artifact-title" onClose={onClose} onCancel={onClose}>
      <header className="sheet-head">
        <div>
          <h2 id="artifact-title" className="sheet-title">
            {artifact?.name ?? "Loading…"}
          </h2>
          {artifact && (
            <p className="sheet-sub">
              {verified === true && <span className="tone-ok">Digest checked in your browser · </span>}
              {verified === false && <span className="tone-fail">Digest mismatch · </span>}
              <Mono title={artifact.sha256}>sha256 {artifact.sha256.slice(0, 16)}…</Mono>
              {artifact.sourceUrl && (
                <>
                  {" · "}
                  <a href={artifact.sourceUrl} target="_blank" rel="noopener noreferrer nofollow">
                    Open source
                  </a>
                </>
              )}
            </p>
          )}
        </div>
        <button type="button" className="button quiet small" onClick={() => ref.current?.close()}>
          Close
        </button>
      </header>
      <div className="sheet-body">
        {error && <p className="form-error">{error}</p>}
        {artifact && (artifact.mediaType === "text/markdown" ? <Markdown source={artifact.content} /> : <pre className="plain">{artifact.content}</pre>)}
      </div>
    </dialog>
  );
}
