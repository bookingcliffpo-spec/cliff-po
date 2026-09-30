/** The Director's Panel: cinematography choices compiled into prompt language
    any video model understands. Pure data plus one function, shared by the
    composer (live preview) and the tests. Every field is optional; an unset
    field adds nothing to the prompt. */

export type Option = { id: string; label: string; phrase: string };

const o = (id: string, label: string, phrase: string): Option => ({ id, label, phrase });

export const GENRES: readonly Option[] = [
  o("general", "General", "cinematic film"),
  o("action", "Action", "high-octane action film, kinetic energy, impactful moments"),
  o("epic", "Epic", "sweeping epic, grand scale, awe-inspiring vistas"),
  o("drama", "Drama", "intimate character drama, emotionally grounded"),
  o("comedy", "Comedy", "light comedic tone, playful timing, bright mood"),
  o("horror", "Horror", "unsettling horror atmosphere, dread, deep shadows"),
  o("noir", "Noir", "film noir mood, moral ambiguity, hard shadows, venetian-blind light"),
];

export const ERAS: readonly Option[] = [
  o("1960s", "1960s", "1960s period look, Technicolor saturation, soft vintage glow"),
  o("1970s", "1970s", "1970s New Hollywood look, warm halation, visible film grain, zoom-lens framing"),
  o("1980s", "1980s", "1980s look, neon highlights, haze, bold primary colors"),
  o("1990s", "1990s", "1990s look, bleach-bypass contrast, gritty texture"),
  o("2000s", "2000s", "2000s look, desaturated teal-and-orange grade, digital intermediate"),
  o("2010s", "2010s", "2010s look, clean digital cinema, shallow depth of field"),
  o("2020s", "2020s", "contemporary 2020s look, pristine large-format digital, natural color science"),
];

export const TEMPOS: readonly Option[] = [
  o("single", "Single Shot", "one continuous unbroken take, no cuts"),
  o("slow", "Slow", "slow contemplative pacing with long takes"),
  o("measured", "Measured", "measured classical pacing with motivated cuts"),
  o("dynamic", "Dynamic", "dynamic pacing with quick cuts on action"),
  o("frenetic", "Frenetic", "frenetic rapid-fire editing, jump cuts, chaotic energy"),
];

export const CAMERAS: readonly Option[] = [
  o("35mm", "35mm Film", "shot on 35mm film, organic grain, rich highlight roll-off"),
  o("16mm", "16mm Film", "shot on 16mm film, pronounced grain, documentary intimacy"),
  o("8mm", "8mm Film", "shot on Super 8 film, heavy grain, light leaks, gate weave, home-movie texture"),
  o("dv", "DV Camcorder", "shot on a 2000s DV camcorder, interlaced video texture, blown highlights, handheld immediacy"),
  o("vhs", "VHS", "VHS tape aesthetic, tracking noise, color bleed, soft resolution"),
  o("digital", "Digital Cinema", "shot on a large-format digital cinema camera, clean detail, wide dynamic range"),
  o("imax", "IMAX 65mm", "shot on IMAX 65mm, immense resolution, towering scale"),
  o("phone", "Smartphone", "shot on a smartphone, vertical-video immediacy, computational HDR look"),
];

export const LENSES: readonly Option[] = [
  o("14mm", "14mm Ultra-wide", "14mm ultra-wide lens, exaggerated perspective"),
  o("24mm", "24mm Wide", "24mm wide lens, environmental framing"),
  o("35mm", "35mm", "35mm lens, natural storytelling perspective"),
  o("50mm", "50mm Normal", "50mm lens, human-eye perspective"),
  o("85mm", "85mm Portrait", "85mm portrait lens, flattering compression"),
  o("135mm", "135mm Telephoto", "135mm telephoto lens, compressed background, isolation"),
  o("anamorphic", "Anamorphic", "anamorphic lens, oval bokeh, horizontal lens flares, 2.39:1 feel"),
  o("macro", "Macro", "macro lens, extreme close detail"),
  o("fisheye", "Fisheye", "fisheye lens, curved distortion"),
  o("tiltshift", "Tilt-shift", "tilt-shift lens, miniature-like selective focus"),
];

export const APERTURES: readonly Option[] = [
  o("f1.4", "f/1.4", "f/1.4, razor-thin depth of field, creamy bokeh"),
  o("f2", "f/2", "f/2, shallow depth of field"),
  o("f2.8", "f/2.8", "f/2.8, soft background separation"),
  o("f4", "f/4", "f/4, moderate depth of field"),
  o("f5.6", "f/5.6", "f/5.6, balanced focus"),
  o("f8", "f/8", "f/8, deep focus"),
  o("f11", "f/11", "f/11, deep focus, crisp throughout"),
  o("f16", "f/16", "f/16, everything sharp from foreground to horizon"),
];

export const MOVES: readonly Option[] = [
  o("static", "Static", "locked-off static camera"),
  o("dolly-in", "Dolly In", "slow dolly in"),
  o("dolly-out", "Dolly Out", "dolly out revealing the scene"),
  o("push-in", "Slow Push-in", "imperceptibly slow push-in building tension"),
  o("pan-left", "Pan Left", "smooth pan left"),
  o("pan-right", "Pan Right", "smooth pan right"),
  o("tilt-up", "Tilt Up", "tilt up"),
  o("tilt-down", "Tilt Down", "tilt down"),
  o("tracking", "Tracking", "lateral tracking shot following the subject"),
  o("orbit", "Orbit", "360-degree orbit around the subject"),
  o("crane-up", "Crane Up", "crane up rising above the scene"),
  o("crane-down", "Crane Down", "crane down descending into the scene"),
  o("handheld", "Handheld", "handheld camera, subtle organic shake"),
  o("steadicam", "Steadicam", "gliding Steadicam follow"),
  o("pov", "POV", "first-person POV shot through the character's eyes"),
  o("robot-arm", "Robot Arm", "high-speed robotic camera arm move, precise whip-fast motion control"),
  o("helicopter", "Helicopter Shot", "aerial helicopter shot sweeping over the landscape"),
  o("drone-fpv", "FPV Drone", "FPV drone dive, fast agile flight through the space"),
  o("whip-pan", "Whip Pan", "whip pan transition"),
  o("crash-zoom", "Crash Zoom", "sudden crash zoom"),
  o("dolly-zoom", "Dolly Zoom", "vertigo dolly zoom"),
  o("bullet-time", "Bullet Time", "frozen-moment bullet-time orbit"),
  o("top-down", "Top-down", "overhead top-down shot"),
  o("low-angle", "Low Angle", "heroic low-angle shot"),
];

/** 52 named grades. Phrases describe the look, not a trademark. */
export const PALETTES: readonly Option[] = [
  o("teal-orange", "Teal & Orange", "teal-and-orange blockbuster grade"),
  o("bleach-bypass", "Bleach Bypass", "bleach-bypass grade, silvery desaturated contrast"),
  o("kodachrome", "Kodachrome", "Kodachrome color, saturated reds and deep blues"),
  o("technicolor", "Technicolor", "three-strip Technicolor saturation"),
  o("noir-bw", "Noir B&W", "high-contrast black and white"),
  o("silver-bw", "Silver B&W", "soft silver-gelatin black and white"),
  o("sepia", "Sepia", "warm sepia monochrome"),
  o("cyberpunk", "Cyberpunk Neon", "magenta and cyan neon palette"),
  o("synthwave", "Synthwave", "purple-pink synthwave sunset palette"),
  o("pastel", "Pastel Dream", "soft pastel palette, symmetrical storybook color"),
  o("candy", "Candy Pop", "candy-colored pop palette"),
  o("matrix", "Code Green", "sickly green digital tint"),
  o("golden", "Golden Warmth", "honeyed golden warmth"),
  o("arctic", "Arctic Blue", "icy arctic blues and whites"),
  o("desert", "Desert Ochre", "sun-baked ochre and sand tones"),
  o("jungle", "Jungle Emerald", "lush emerald and jade greens"),
  o("autumn", "Autumn", "burnt orange and russet autumn tones"),
  o("winter", "Winter Steel", "cold steel-blue winter palette"),
  o("spring", "Spring Bloom", "fresh blossom pinks and greens"),
  o("summer", "Summer Haze", "hazy sun-bleached summer color"),
  o("moody-blue", "Moody Blue", "moody deep blue shadows"),
  o("crimson", "Crimson Night", "blood-red crimson accents in darkness"),
  o("amber-night", "Amber Streetlight", "sodium-vapor amber night palette"),
  o("mint-rose", "Mint & Rose", "mint green and dusty rose"),
  o("earth", "Earth Tones", "natural earth tones, browns and olives"),
  o("monochrome-red", "Red Monochrome", "red monochrome"),
  o("monochrome-blue", "Blue Monochrome", "cyanotype blue monochrome"),
  o("duotone", "Duotone", "graphic duotone of indigo and tangerine"),
  o("vintage-fade", "Vintage Fade", "faded vintage print, lifted blacks"),
  o("polaroid", "Instant Film", "instant-film color, creamy highlights, green shadows"),
  o("cross-process", "Cross-processed", "cross-processed film, shifted greens and yellows"),
  o("infrared", "Infrared", "false-color infrared foliage"),
  o("thermal", "Thermal", "thermal-camera heat palette"),
  o("sunset", "Sunset Blaze", "blazing sunset oranges and violets"),
  o("dawn", "Dawn Pastels", "delicate dawn pinks and lavender"),
  o("underwater", "Underwater", "aquatic blue-green caustic palette"),
  o("toxic", "Toxic Glow", "radioactive acid-green glow"),
  o("royal", "Royal Velvet", "royal purple and gold"),
  o("luxury", "Luxury Noir", "black, gold and champagne luxury palette"),
  o("clean-white", "Clean Minimal", "clean minimal whites and soft greys"),
  o("industrial", "Industrial", "rust, concrete and steel"),
  o("wes-symmetry", "Storybook", "storybook palette of mustard, pink and teal"),
  o("giallo", "Giallo", "lurid giallo reds, greens and blues"),
  o("western", "Western Dust", "dusty western browns and faded blue sky"),
  o("space", "Deep Space", "deep space blacks with nebula violets"),
  o("fantasy", "High Fantasy", "enchanted jewel tones"),
  o("horror-green", "Horror Green", "sickly green-grey horror grade"),
  o("documentary", "Documentary Natural", "true-to-life documentary color"),
  o("music-video", "Music Video Pop", "punchy saturated music-video grade"),
  o("anime", "Anime Vivid", "vivid anime color, clean cel shading"),
  o("dreamy-haze", "Dreamy Haze", "soft dreamy haze with bloom"),
  o("film-print", "Film Print", "warm 2383 film-print emulation"),
];

export const LIGHTING: readonly Option[] = [
  o("daylight", "Natural Daylight", "natural daylight"),
  o("golden-hour", "Golden Hour", "low golden-hour sun, long shadows"),
  o("blue-hour", "Blue Hour", "blue-hour twilight, cool ambient glow"),
  o("neon-night", "Neon Night", "neon-lit night, colored practical lights"),
  o("low-key", "Low-key Noir", "low-key chiaroscuro lighting, deep shadows"),
  o("high-key", "High-key Studio", "bright high-key studio lighting, minimal shadows"),
];

export const LIGHT_ANGLES: readonly Option[] = [
  o("front", "Front", "front light"),
  o("key-45", "45° Key", "45-degree key light"),
  o("side", "Side", "hard side light"),
  o("back", "Back / Rim", "backlight with a glowing rim"),
  o("top", "Top", "overhead top light"),
  o("under", "Under", "eerie under-lighting"),
];

export type Direction = {
  genre?: string;
  era?: string;
  tempo?: string;
  camera?: string;
  lens?: string;
  aperture?: string;
  move?: string;
  palette?: string;
  lighting?: string;
  lightAngle?: string;
  /** #rrggbb */
  lightColor?: string;
  /** -2 (very dark) … 2 (very bright); 0 is neutral. */
  brightness?: number;
  /** 0 (hard light) … 100 (fully diffused). */
  diffusion?: number;
  /** 0 (restrained) … 100 (intense). */
  emotion?: number;
};

const phraseOf = (list: readonly Option[], id: string | undefined) =>
  id ? list.find((option) => option.id === id)?.phrase : undefined;

const BRIGHTNESS = ["very dark exposure", "dim exposure", "", "bright exposure", "very bright, airy exposure"];

function colorName(hex: string): string | undefined {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return undefined;
  const n = Number.parseInt(match[1]!, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max - min < 24) return max > 200 ? "white" : max < 60 ? "dim neutral" : "neutral";
  const hue = (() => {
    const d = max - min;
    let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
    return h < 0 ? h + 360 : h;
  })();
  const names: Array<[number, string]> = [
    [15, "red"],
    [40, "orange"],
    [65, "amber"],
    [90, "yellow-green"],
    [160, "green"],
    [200, "cyan"],
    [250, "blue"],
    [290, "violet"],
    [335, "magenta"],
    [360, "red"],
  ];
  return names.find(([limit]) => hue <= limit)![1];
}

/** Whether any field is set — an empty panel leaves the prompt untouched. */
export function hasDirection(direction: Direction | null | undefined): boolean {
  if (!direction) return false;
  return Object.entries(direction).some(([key, value]) => {
    if (value === undefined || value === "" || value === null) return false;
    if (key === "brightness") return value !== 0;
    return true;
  });
}

/** The director's notes as prompt text, or "" when nothing is set. */
export function directionText(direction: Direction | null | undefined): string {
  if (!direction || !hasDirection(direction)) return "";
  const d = direction;
  const parts: string[] = [];

  const style = [phraseOf(GENRES, d.genre), phraseOf(ERAS, d.era)].filter(Boolean).join(", ");
  if (style) parts.push(`Style: ${style}.`);
  const tempo = phraseOf(TEMPOS, d.tempo);
  if (tempo) parts.push(`Editing: ${tempo}.`);

  const optics = [phraseOf(CAMERAS, d.camera), phraseOf(LENSES, d.lens), phraseOf(APERTURES, d.aperture)]
    .filter(Boolean)
    .join(", ");
  if (optics) parts.push(`Camera: ${optics}.`);
  const move = phraseOf(MOVES, d.move);
  if (move) parts.push(`Camera movement: ${move}.`);

  const palette = phraseOf(PALETTES, d.palette);
  if (palette) parts.push(`Color: ${palette}.`);

  const light: string[] = [];
  const preset = phraseOf(LIGHTING, d.lighting);
  if (preset) light.push(preset);
  const color = d.lightColor ? colorName(d.lightColor) : undefined;
  const angle = phraseOf(LIGHT_ANGLES, d.lightAngle);
  if (color || angle) light.push([color ? `${color}-tinted` : "", angle ?? "light"].filter(Boolean).join(" "));
  if (typeof d.brightness === "number" && d.brightness !== 0) {
    light.push(BRIGHTNESS[Math.max(-2, Math.min(2, Math.round(d.brightness))) + 2]!);
  }
  if (typeof d.diffusion === "number") {
    light.push(
      d.diffusion < 25 ? "hard crisp shadows" : d.diffusion < 60 ? "softly diffused light" : "heavily diffused, glowing soft light",
    );
  }
  if (light.length) parts.push(`Lighting: ${light.join(", ")}.`);

  if (typeof d.emotion === "number") {
    parts.push(
      `Performance: ${
        d.emotion < 25
          ? "restrained, subtle emotion"
          : d.emotion < 60
            ? "natural, readable emotion"
            : d.emotion < 85
              ? "strong, expressive emotion"
              : "intense, overwhelming emotion"
      }.`,
    );
  }
  return parts.join(" ");
}

/** The prompt a model receives: the visitor's words first, then the notes. */
export function buildCinematicPrompt(prompt: string, direction: Direction | null | undefined): string {
  const base = prompt.trim();
  const notes = directionText(direction);
  if (!notes) return base;
  return base ? `${base}\n\n${notes}` : notes;
}

/** Keeps only known ids and in-range numbers, so a stale or hand-edited saved
    direction cannot inject arbitrary text. */
export function sanitizeDirection(raw: unknown): Direction {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const pick = (list: readonly Option[], value: unknown) =>
    typeof value === "string" && list.some((option) => option.id === value) ? value : undefined;
  const num = (value: unknown, min: number, max: number) =>
    typeof value === "number" && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : undefined;
  const out: Direction = {
    genre: pick(GENRES, r.genre),
    era: pick(ERAS, r.era),
    tempo: pick(TEMPOS, r.tempo),
    camera: pick(CAMERAS, r.camera),
    lens: pick(LENSES, r.lens),
    aperture: pick(APERTURES, r.aperture),
    move: pick(MOVES, r.move),
    palette: pick(PALETTES, r.palette),
    lighting: pick(LIGHTING, r.lighting),
    lightAngle: pick(LIGHT_ANGLES, r.lightAngle),
    lightColor: typeof r.lightColor === "string" && /^#[0-9a-f]{6}$/i.test(r.lightColor) ? r.lightColor : undefined,
    brightness: num(r.brightness, -2, 2),
    diffusion: num(r.diffusion, 0, 100),
    emotion: num(r.emotion, 0, 100),
  };
  for (const key of Object.keys(out) as Array<keyof Direction>) if (out[key] === undefined) delete out[key];
  return out;
}
