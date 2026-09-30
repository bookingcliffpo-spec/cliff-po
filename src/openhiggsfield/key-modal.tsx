"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import { clearPlatformCredentials, savePlatformCredentials } from "@/generation/actions";
import { callAction } from "@/generation/result";

import { CloseIcon } from "./icons";

export function KeyModal({
  configured,
  source = null,
  freeMode = false,
  onClose,
  onSaved,
  onCleared,
}: {
  configured: boolean;
  source?: "server" | "browser" | null;
  freeMode?: boolean;
  onClose: () => void;
  onSaved: () => void;
  onCleared: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    /* StrictMode runs this twice; showModal on an open dialog throws in older
       engines, so it is only called on a closed one. */
    if (dialog && !dialog.open) dialog.showModal();
    panelRef.current?.focus();
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await callAction(() => savePlatformCredentials({ api_key: apiKey }));
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setApiKey("");
    onSaved();
  }

  async function onClear() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await callAction(clearPlatformCredentials);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setApiKey("");
    onCleared();
  }

  const serverKey = source === "server";

  return (
    <dialog
      ref={ref}
      aria-labelledby="ohf-keys-title"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
    >
      <div ref={panelRef} tabIndex={-1} className="ohf-dialog-panel ohf-keys-panel">
        <div className="ohf-keys-head">
          <div>
            <div id="ohf-keys-title" className="ohf-keys-title">
              API key
            </div>
            <p className="ohf-keys-copy">
              {serverKey
                ? "This studio uses the server's HF_API_KEY. It is never sent to the browser; change it in the server environment."
                : configured
                  ? "A key is saved in this browser. Enter a new id:secret pair to replace it."
                  : freeMode
                    ? "You're in free mode: the free image models work with no key. To unlock the paid image and video models, paste a platform key as id:secret — it stays in an httpOnly cookie."
                  : "Paste your platform key as id:secret. It stays in an httpOnly cookie and is sent as Authorization: Key id:secret. To use a server key instead, set HF_API_KEY."}
            </p>
          </div>
          <button type="button" className="ohf-icon-btn" aria-label="Close" onClick={onClose}>
            <CloseIcon size={13} />
          </button>
        </div>

        {!serverKey && (
          <form className="ohf-keys-form" onSubmit={(event) => void onSubmit(event)}>
            <label className="ohf-field">
              <div className="ohf-field-label">API key</div>
              <input
                className="ohf-input ohf-input--mono"
                name="api_key"
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
              />
            </label>

            {error && (
              <div className="ohf-alert" role="alert">
                <span className="ohf-alert-text">{error}</span>
              </div>
            )}

            <div className="ohf-keys-actions">
              {configured && (
                <button type="button" className="ohf-btn-quiet" disabled={busy} onClick={() => void onClear()}>
                  Remove key
                </button>
              )}
              <button type="submit" className="ohf-keys-save" disabled={busy || !apiKey.trim()}>
                {busy ? "Saving…" : configured ? "Replace key" : "Save key"}
              </button>
            </div>
          </form>
        )}
      </div>
    </dialog>
  );
}