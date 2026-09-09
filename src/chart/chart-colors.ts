type Rgb = { readonly r: number; readonly g: number; readonly b: number };

function parseHexColor(color: string): Rgb | null {
  const normalized = color.trim();
  if (!/^#[0-9a-fA-F]{6}$/u.test(normalized)) {
    return null;
  }

  return {
    r: Number.parseInt(normalized.slice(1, 3), 16),
    g: Number.parseInt(normalized.slice(3, 5), 16),
    b: Number.parseInt(normalized.slice(5, 7), 16),
  };
}

function rgbToHex({ r, g, b }: Rgb): string {
  const channel = (value: number): string =>
    Math.round(Math.max(0, Math.min(255, value)))
      .toString(16)
      .padStart(2, '0');
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

function mixRgb(left: Rgb, right: Rgb, rightWeight: number): Rgb {
  const weight = Math.max(0, Math.min(1, rightWeight));
  const leftWeight = 1 - weight;
  return {
    r: left.r * leftWeight + right.r * weight,
    g: left.g * leftWeight + right.g * weight,
    b: left.b * leftWeight + right.b * weight,
  };
}

export function mixHexColors(baseColor: string, targetColor: string, targetWeight: number): string {
  const base = parseHexColor(baseColor);
  const target = parseHexColor(targetColor);
  if (!base || !target) {
    return baseColor;
  }
  return rgbToHex(mixRgb(base, target, targetWeight));
}

/** Larger buckets (rank 0) get darker shades; smaller buckets get lighter shades. */
export function colorForAmountRank(baseColor: string, rank: number, total: number): string {
  if (total <= 1) {
    return baseColor;
  }

  const position = rank / (total - 1);
  const darkenWeight = 0.22 * (1 - position);
  const lightenWeight = 0.45 * position;
  if (darkenWeight >= lightenWeight) {
    return mixHexColors(baseColor, '#000000', darkenWeight);
  }
  return mixHexColors(baseColor, '#ffffff', lightenWeight);
}
