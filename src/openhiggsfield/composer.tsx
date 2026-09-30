"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { CSSProperties, ReactNode } from "react";

import { parseSettings } from "@/generation/catalog";
import type { ModelEntry, Surface } from "@/generation/catalog";
import type { StorageDriver } from "@/generation/storage/config";
import { MAX_BATCH, useActive } from "@/generation/stores/active";
import { useImagePrompt, useVideoPrompt } from "@/generation/stores/prompt";
import { useSettings } from "@/generation/stores/settings";

import { swatchFor } from "./artwork";
import { AssetPicker } from "./asset-picker";
import { PROMPT_PLACEHOLDERS, countSetting } from "./data";
import type { RunRecord } from "./history";
import { ArrowUpIcon, CaretDownIcon, CloseIcon, MinusIcon, PlusIcon, WarningIcon } from "./icons";
import { MediaStrip, useMediaTray } from "./media-tray";
import { ModelIcon, modelIconSrc } from "./model-icon";
import { ModelPicker } from "./model-picker";
import { SettingPill, SettingPopover } from "./settings";

/* Overlay ids: the two fixed panels, or one setting addressed by its catalog
   key — the rail renders whatever the model declares, so the ids cannot be a
   closed union. */
const PICKER = "picker";
const ASSETS = "assets";
const SETTING = "setting:";

const PROMPT_MAX_HEIGHT = 168;

/* What the studio itself can deliver for a model that carries no count of its
   own: one platform request per result. */
const STUDIO_COUNTS = Array.from({ length: MAX_BATCH }, (_, index) => index + 1);

/** Breathing room between a popover and the control it opened from. */
const POPOVER_GAP = 8;

/** Declared widths keep an opening popover inside the composer's own column. */
function popoverWidth(id: string, model: ModelEntry): number {
  if (id === PICKER || id === ASSETS) return 560;
  /* A list of an enum's values is the narrow panel; a slider needs its travel. */
  if (id.startsWith(SETTING) && model.settings[id.slice(SETTING.length)]?.type === "enum") {
    return 216;
  }
  return 268;
}

/* The modifier is the visitor's, not the server's: the server snapshot is
   null, so hydration renders no hint and the client fills it in after. */
const noSubscribe = () => () => {};
function readShortcut(): string {
  return /Mac|iP(hone|ad|od)/.test(navigator.userAgent) ? "⌘↵" : "Ctrl↵";
}

export function Composer({
  surface,
  model,
  generating,
  storage = null,
  isAvailable,
  error,
  focusNonce,
  history,
  notice,
  selection,
  selecting,
  onError,
  onGenerate,
}: {
  surface: Surface;
  model: ModelEntry;
  generating: boolean;
  /** Which upload driver the server has configured, or null for none. */
  storage?: StorageDriver | null;
  /** Which models the server can run; the picker offers only those. */
  isAvailable?: (model: ModelEntry) => boolean;
  error: string | null;
  focusNonce: number;
  /* Finished runs are attachable inputs, so the asset picker reads the same
     log the gallery renders. */
  history: RunRecord[];
  /* Transient receipts from the gallery share the composer's banner strip
     rather than adding a floating layer of their own. */
  notice?: ReactNode;
  /* The bulk toolbar takes the composer's slot while runs are picked; it is
     always mounted so it can animate away, and states its own presence. */
  selection: ReactNode;
  selecting: boolean;
  onError: (message: string | null) => void;
  onGenerate: () => void;
}) {
  const setModel = useActive((state) => state.setModel);
  const batch = useActive((state) => state.batch);
  const setBatch = useActive((state) => state.setBatch);
  const imagePrompt = useImagePrompt();
  const videoPrompt = useVideoPrompt();
  const prompt = surface === "image" ? imagePrompt : videoPrompt;
  const settings = useSettings();
  const values = parseSettings(model, settings.byModel[model.id] ?? {}, "lenient");
  const tray = useMediaTray(model, onError, storage);

  const [openOverlay, setOverlay] = useState<string | null>(null);
  /* A panel anchored to a control the visitor can no longer see is a stray
     plate — the selection toolbar's swap puts whatever was open away. */
  const overlay = selecting ? null : openOverlay;
  const [anchor, setAnchor] = useState({ x: 0, y: 0 });
  const shortcut = useSyncExternalStore(noSubscribe, readShortcut, () => null);
  const dockRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  /* A run in flight is not a lock: it holds its own tile in the grid, so the
     only thing that can stop a press is having nothing to say. */
  const disabled = prompt.text.trim().length === 0;

  /* One batch control, two mechanisms. A model that declares its own
     results-per-request gets that setting written; the rest are submitted once
     per result by the studio. Either way the control means "results per press",
     so the model's own count key never also appears as a settings pill. */
  const native = countSetting(model);
  const counts = native ? native.counts : STUDIO_COUNTS;
  const batchValue = native ? Number(values[native.key]) || counts[0]! : batch;
  const settingKeys = Object.keys(model.settings).filter((key) => key !== native?.key);

  function setBatchValue(next: number) {
    if (!native) {
      setBatch(next);
      return;
    }
    settings.set(model.id, { [native.key]: native.kind === "enum" ? String(next) : next });
  }

  /* The dock floats over the gallery, so the gallery cannot reserve its height
     from layout. It reads it from here instead, and the last row keeps clearing
     a composer that grew — a long prompt, a media strip, the undo receipt. */
  useEffect(() => {
    const dock = dockRef.current;
    if (!dock) return;
    const observer = new ResizeObserver(() => {
      dock.parentElement?.style.setProperty("--ohf-dock-h", `${dock.offsetHeight}px`);
    });
    observer.observe(dock);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!overlay) return;
    const onPointerDown = (event: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOverlay(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOverlay(null);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [overlay]);

  /* Auto-grow the prompt, including when text is set programmatically — and
     again when the column narrows, because the field shares its line with the
     attachment now and the same text rewraps onto more of them. Only a width
     change re-measures: reacting to the height we just set would loop. */
  useEffect(() => {
    const el = promptRef.current;
    if (!el) return;
    const grow = () => {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, PROMPT_MAX_HEIGHT)}px`;
    };
    grow();
    let width = el.clientWidth;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === width) return;
      width = el.clientWidth;
      grow();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [prompt.text]);

  useEffect(() => {
    if (focusNonce > 0) promptRef.current?.focus();
  }, [focusNonce]);


  /* Popovers are positioned by the composer so the wide ones stay inside its
     column, but they open off the control that summoned them: the anchor
     travels to the trigger's left edge, clamped to the column, and rises from
     just above the trigger's own top rather than from the whole dock.
     One thing outranks the trigger: the attachments. A panel laid over the
     frames already on the plane makes the visitor choose blind, so where the
     strip is present every panel clears it. */
  function toggle(next: string, trigger: HTMLElement) {
    if (overlay === next) {
      setOverlay(null);
      return;
    }
    const wrap = wrapRef.current;
    if (!wrap) return;
    const wrapBox = wrap.getBoundingClientRect();
    const triggerBox = trigger.getBoundingClientRect();
    const strip = wrap.querySelector(".ohf-strip");
    const ceiling = strip
      ? Math.min(triggerBox.top, strip.getBoundingClientRect().top)
      : triggerBox.top;
    const available = wrap.clientWidth;
    const width = Math.min(popoverWidth(next, model), available);
    setAnchor({
      x: Math.round(Math.max(0, Math.min(triggerBox.left - wrapBox.left, available - width))),
      y: Math.round(wrapBox.bottom - ceiling + POPOVER_GAP),
    });
    setOverlay(next);
  }

  const attachLabel = tray.allFull ? "Change the inputs" : "Add an input";
  const settingKey = overlay?.startsWith(SETTING) ? overlay.slice(SETTING.length) : null;
  const generateLabel = batchValue > 1 ? `Generate ${batchValue} results` : "Generate";
  const generateTip = disabled ? "Write a prompt first" : `${generateLabel} · ${shortcut ?? "⌘↵"}`;

  return (
    <div className="ohf-dock" ref={dockRef} data-selecting={selecting}>
      <div
        className="ohf-composer-wrap ohf-enter-2"
        ref={wrapRef}
        style={
          {
            "--ohf-pop-x": `${anchor.x}px`,
            "--ohf-pop-y": `${anchor.y}px`,
          } as CSSProperties
        }
      >
        {notice}

        {error && (
          <div className="ohf-alert" role="alert">
            <span className="ohf-alert-ic">
              <WarningIcon />
            </span>
            <span className="ohf-alert-text">{error}</span>
            <button
              type="button"
              className="ohf-icon-btn ohf-icon-btn--ghost"
              aria-label="Dismiss error"
              title="Dismiss error"
              onClick={() => onError(null)}
            >
              <CloseIcon size={12} />
            </button>
          </div>
        )}

        {settingKey && <SettingPopover model={model} settingKey={settingKey} values={values} />}
        {overlay === ASSETS && (
          <AssetPicker
            model={model}
            items={tray.items}
            uploads={tray.uploads}
            history={history}
            staged={tray.staged}
            uploading={tray.uploading}
            progress={tray.progress}
            onUpload={tray.begin}
            onApply={tray.apply}
            onClose={() => setOverlay(null)}
          />
        )}
        {overlay === PICKER && (
          <ModelPicker
            selectedId={model.id}
            surface={surface}
            isAvailable={isAvailable}
            onPick={(next) => {
              setModel(next.id);
              setOverlay(null);
            }}
            onClose={() => setOverlay(null)}
          />
        )}

        {/* One slot, two instruments. Both are laid on the same cell and
            aligned to the same bottom edge, so the dock never changes height
            and the toolbar rises exactly where the composer's rail was. */}
        <div className="ohf-swap">
          <div className="ohf-composer">
            <MediaStrip model={model} />

            {/* The attachment sits beside the words it belongs to, on the same
                left rail the control row starts from. */}
            <div className="ohf-composer-head">
              {tray.roles.length > 0 && (
                <>
                  {tray.input}
                  <button
                    type="button"
                    className="ohf-attach ohf-tip ohf-tip--start"
                    data-tip={attachLabel}
                    disabled={tray.allFull}
                    aria-label={
                      tray.uploading
                        ? `Uploading ${Math.round((tray.progress ?? 0) * 100)}%`
                        : attachLabel
                    }
                    aria-expanded={overlay === ASSETS}
                    aria-haspopup="dialog"
                    onClick={(event) => toggle(ASSETS, event.currentTarget)}
                  >
                    {tray.uploading ? (
                      <UploadProgress value={tray.progress ?? 0} />
                    ) : (
                      <PlusIcon size={16} />
                    )}
                  </button>
                </>
              )}

              {/* The prompt lives inside the wrap the outside-pointer rule
                  guards, so it has to dismiss for itself: reaching for the words
                  puts the open control away. Pointer and focus both, because a
                  button click does not move focus on every platform — the field
                  can still hold it while a popover stands open. */}
              <textarea
                ref={promptRef}
                className="ohf-prompt"
                rows={1}
                value={prompt.text}
                placeholder={PROMPT_PLACEHOLDERS[surface]}
                aria-label="Prompt"
                onPointerDown={() => setOverlay(null)}
                onFocus={() => setOverlay(null)}
                onChange={(event) => prompt.setText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault();
                    /* A held shortcut auto-repeats; only the first press is a
                       request for a run. */
                    if (!disabled && !event.repeat) onGenerate();
                  }
                }}
              />
            </div>

            <div className="ohf-composer-row">
              <div className="ohf-controls">
                <button
                  type="button"
                  className="ohf-ctl ohf-ctl--model ohf-tip"
                  data-tip="Change model"
                  aria-expanded={overlay === PICKER}
                  aria-haspopup="dialog"
                  onClick={(event) => toggle(PICKER, event.currentTarget)}
                >
                  {modelIconSrc(model.id) ? (
                    <ModelIcon modelId={model.id} />
                  ) : (
                    <span className="ohf-model-swatch" style={{ background: swatchFor(surface, model.id) }} />
                  )}
                  <span className="ohf-ctl-name">{model.label}</span>
                  <span className="ohf-caret">
                    <CaretDownIcon />
                  </span>
                </button>

                {settingKeys.map((key) => (
                  <SettingPill
                    key={key}
                    model={model}
                    settingKey={key}
                    values={values}
                    open={overlay === `${SETTING}${key}`}
                    onOpen={(trigger) => toggle(`${SETTING}${key}`, trigger)}
                  />
                ))}

                <BatchStepper value={batchValue} counts={counts} onChange={setBatchValue} />
              </div>

              <span className="ohf-generate-slot ohf-tip ohf-tip--end" data-tip={generateTip}>
                <button
                  type="button"
                  className="ohf-generate"
                  disabled={disabled}
                  data-busy={generating}
                  aria-label={generateLabel}
                  onClick={onGenerate}
                >
                  {/* The sheen is the only thing a run in flight changes here:
                      the label still names what pressing does, because pressing
                      is still allowed. Progress is the grid's to report. */}
                  {generating && <span className="ohf-generate-sheen" aria-hidden />}
                  <span className="ohf-generate-glyph" aria-hidden>
                    <ArrowUpIcon size={15} />
                  </span>
                  <span className="ohf-generate-label">Generate</span>
                  {shortcut && <kbd className="ohf-kbd">{shortcut}</kbd>}
                </button>
              </span>
            </div>
          </div>

          {selection}
        </div>
      </div>
    </div>
  );
}

/* Results per press. Every unit is a real generation, so the number is a
   spinbutton the keyboard can drive rather than two anonymous arrows, and the
   ceiling stays in view beside it. The arrows walk the counts the model
   actually allows — Soul offers 1 or 4, and there is no 2 to land on. */
function BatchStepper({
  value,
  counts,
  onChange,
}: {
  value: number;
  counts: number[];
  onChange: (next: number) => void;
}) {
  const index = Math.max(0, counts.indexOf(value));
  const last = counts.length - 1;
  const max = counts[last]!;
  const label = `Batch size — ${value} result${value > 1 ? "s" : ""} per press`;

  const step = (delta: number) => {
    const next = counts[Math.min(last, Math.max(0, index + delta))]!;
    if (next !== value) onChange(next);
  };

  return (
    <div className="ohf-batch ohf-tip" data-tip={label}>
      <button
        type="button"
        className="ohf-batch-step"
        aria-label="Fewer results"
        disabled={index <= 0}
        onClick={() => step(-1)}
      >
        <MinusIcon size={12} />
      </button>
      <span
        className="ohf-batch-value"
        role="spinbutton"
        tabIndex={0}
        aria-label="Batch size"
        aria-valuemin={counts[0]}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={`${value} of ${max}`}
        onKeyDown={(event) => {
          const delta =
            event.key === "ArrowUp" || event.key === "ArrowRight"
              ? 1
              : event.key === "ArrowDown" || event.key === "ArrowLeft"
                ? -1
                : 0;
          if (delta !== 0) {
            event.preventDefault();
            step(delta);
            return;
          }
          if (event.key === "Home") {
            event.preventDefault();
            onChange(counts[0]!);
          }
          if (event.key === "End") {
            event.preventDefault();
            onChange(max);
          }
        }}
      >
        {value}
        <span className="ohf-batch-max" aria-hidden>
          /{max}
        </span>
      </span>
      <button
        type="button"
        className="ohf-batch-step"
        aria-label="More results"
        disabled={index >= last}
        onClick={() => step(1)}
      >
        <PlusIcon size={12} />
      </button>
    </div>
  );
}

/* A ring that fills as the file goes up, with the percentage for anyone who
   cannot read an arc. Indeterminate (the spinner) until the first byte counts. */
function UploadProgress({ value }: { value: number }) {
  if (value <= 0) return <span className="ohf-spinner" aria-hidden />;
  const radius = 7;
  const circumference = 2 * Math.PI * radius;
  return (
    <span className="ohf-upload-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)} aria-label="Upload progress">
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
        <circle cx="9" cy="9" r={radius} fill="none" stroke="var(--line-2)" strokeWidth="1.5" />
        <circle
          cx="9"
          cy="9"
          r={radius}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - value)}
          transform="rotate(-90 9 9)"
        />
      </svg>
    </span>
  );
}
