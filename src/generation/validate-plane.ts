import { InvalidSettingError, REFERENCE_TAGS, findModel, parseSettings, promptRequired, providerOf } from "./catalog";
import type { GenerationPlane, MediaItem, MediaRole, ReferenceTag } from "./catalog/types";
import { GenerationError, MESSAGES } from "./errors";
import { mediaUrlProblem } from "./media-rules";

export const PROMPT_MAX = 10_000;
const ROLES: readonly MediaRole[] = ["start", "end", "reference", "video", "audio"];

/** Server-side reading of a generate request. Everything arriving at a server
    action is untrusted input — the browser's copy of the catalog can be stale
    and its payload can be anything — so the plane is rebuilt from the catalog
    here, and every problem becomes a GenerationError with a message the studio
    can show as is. */
export function validatePlane(
  data: unknown,
  options: { allowPrivateMedia?: boolean } = {},
): GenerationPlane {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new GenerationError("invalid_request", "Invalid generation request.");
  }
  const raw = data as Record<string, unknown>;

  const model = findModel(raw.model);
  if (!model) throw new GenerationError("invalid_model", MESSAGES.invalidModel);

  const promptRecord = raw.prompt as { text?: unknown } | undefined;
  const text = typeof promptRecord?.text === "string" ? promptRecord.text.trim() : "";
  if (text.length > PROMPT_MAX) {
    throw new GenerationError("invalid_request", `The prompt is too long (max ${PROMPT_MAX} characters).`);
  }

  let settings: Record<string, unknown>;
  try {
    settings = parseSettings(model, (raw.settings as Record<string, unknown>) ?? {}, "strict");
  } catch (caught) {
    if (caught instanceof InvalidSettingError) {
      throw new GenerationError(
        "unsupported_settings",
        `Unsupported settings — ${model.label}: ${caught.message}.`,
        { status: 400 },
      );
    }
    throw caught;
  }

  /* The WanGP bridge runs on the owner's own machine or network, so it can
     fetch private addresses, and it can reuse its own earlier outputs. */
  const wangp = providerOf(model) === "wangp";
  const allowPrivate = options.allowPrivateMedia || wangp;
  const media: GenerationPlane["media"] = {};
  const rawMedia = raw.media && typeof raw.media === "object" ? (raw.media as Record<string, unknown>) : {};
  for (const [role, list] of Object.entries(rawMedia)) {
    if (!ROLES.includes(role as MediaRole)) {
      throw new GenerationError("invalid_request", `Unknown media role: ${role.slice(0, 32)}.`);
    }
    if (!Array.isArray(list) || list.length === 0) continue;
    const cap = model.roles[role as MediaRole] ?? 0;
    if (cap === 0) {
      throw new GenerationError(
        "unsupported_settings",
        `Unsupported settings — ${model.label} does not take ${role} inputs. Remove them or pick another model.`,
      );
    }
    if (list.length > cap) {
      throw new GenerationError(
        "unsupported_settings",
        `Unsupported settings — ${model.label} takes at most ${cap} ${role} input${cap === 1 ? "" : "s"}.`,
      );
    }
    media[role as MediaRole] = list.map((entry, index): MediaItem => {
      const item = entry as Partial<MediaItem> | null;
      const url = typeof item?.url === "string" ? item.url : "";
      const ownOutput = wangp && /^\/api\/wangp\/files\/[A-Za-z0-9._-]+$/.test(url);
      const problem = ownOutput ? null : mediaUrlProblem(url, allowPrivate);
      if (problem) throw new GenerationError("upload_failed", problem);
      const tag =
        role === "reference" && REFERENCE_TAGS.includes(item?.tag as ReferenceTag) ? (item!.tag as ReferenceTag) : undefined;
      return {
        id: typeof item?.id === "string" ? item.id : `${role}-${index}`,
        url,
        role: role as MediaRole,
        ...(tag ? { tag } : {}),
      };
    });
  }

  if (!text && promptRequired(model, media, settings)) {
    throw new GenerationError("invalid_request", "Write a prompt first.");
  }

  return { model: model.id, prompt: { text }, media, settings };
}
